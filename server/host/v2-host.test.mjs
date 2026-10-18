import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

test('gated V2 HTTP routes pin exact locks and transact membership, projections, grants, commands and retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-v2-host-'));
  const databasePath = join(directory, 'host.sqlite');
  let host;
  let baseUrl;
  const launch = async () => {
    host = createHost({ databasePath, campaignId: 'campaign-v2-http', enableV2Api: true });
    const address = await host.listen(0);
    baseUrl = `http://127.0.0.1:${address.port}`;
  };
  const request = (path, token = 'local-gm', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  const jsonRequest = (path, body, token = 'local-gm', method = 'POST', extraHeaders = {}) => request(path, token, { method, body: JSON.stringify(body), headers: extraHeaders });
  try {
    await launch();
    const disabled = createHost({ databasePath: join(directory, 'disabled.sqlite') });
    const disabledAddress = await disabled.listen(0);
    const disabledResponse = await fetch(`http://127.0.0.1:${disabledAddress.port}/api/v2/campaign/lock`, { headers: { authorization: 'Bearer local-gm' } });
    assert.equal(disabledResponse.status, 404, 'V2 API must remain off unless explicitly enabled');
    disabled.close();

    const enrolledAResponse = await jsonRequest('/api/members/enroll', { displayName: 'Player A' });
    const enrolledBResponse = await jsonRequest('/api/members/enroll', { displayName: 'Player B' });
    assert.equal(enrolledAResponse.status, 201);
    assert.equal(enrolledBResponse.status, 201);
    const playerA = await enrolledAResponse.json();
    const playerB = await enrolledBResponse.json();

    assert.equal((await jsonRequest('/api/v2/campaign/lock', {}, 'local-gm', 'PUT')).status, 201);
    const lockResponse = await request('/api/v2/campaign/lock', playerA.credential);
    assert.equal(lockResponse.status, 200);
    const { digest } = await lockResponse.json();
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal((await jsonRequest('/api/v2/campaign/lock', {}, 'local-gm', 'PUT')).status, 200, 'same lock pin is idempotent');
    assert.throws(() => host.db.prepare('UPDATE v2_campaign_locks SET lock_version=2 WHERE campaign_id=?').run('campaign-v2-http'), /immutable/);

    const data = { power: 40, safe: false, allocations: { propulsion: 0, lifeSupport: 0 }, engineeringLog: ['GM-only diagnostic detail'] };
    const entityResponse = await jsonRequest('/api/v2/entities', {
      operationId: 'create-reactor-http', entityId: 'reactor-http', typeId: 'example.starship.reactor',
      visibility: 'owner', ownerPrincipalId: playerA.memberId, data
    }, 'local-gm', 'POST', { 'x-v2-lock-digest': digest });
    assert.equal(entityResponse.status, 201, await entityResponse.text());

    const ownerViewResponse = await request('/api/v2/entities/reactor-http', playerA.credential, { headers: { 'x-v2-lock-digest': digest } });
    assert.equal(ownerViewResponse.status, 200);
    const ownerView = await ownerViewResponse.json();
    assert.equal(ownerView.ownerPrincipalId, playerA.memberId);
    assert.equal('engineeringLog' in ownerView.data, false, 'private module field is removed before player projection');
    const gmView = await request('/api/v2/entities/reactor-http', 'local-gm', { headers: { 'x-v2-lock-digest': digest } });
    assert.deepEqual((await gmView.json()).data.engineeringLog, data.engineeringLog, 'GM projection retains the private field');
    assert.equal((await request('/api/v2/entities/reactor-http', playerB.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 404);
    assert.equal((await request('/api/v2/entities/reactor-http', playerA.credential, { headers: { 'x-v2-lock-digest': `sha256:${'0'.repeat(64)}` } })).status, 409);
    assert.equal((await jsonRequest('/api/v2/entities', {
      operationId: 'spoof-entity', entityId: 'spoof', typeId: 'example.starship.reactor', visibility: 'owner',
      ownerPrincipalId: playerA.memberId, principalId: playerB.memberId, data
    }, 'local-gm', 'POST', { 'x-v2-lock-digest': digest })).status, 400);

    assert.equal((await jsonRequest('/api/v2/entities/reactor-http/grants', { memberId: playerB.memberId, permissions: ['read'] })).status, 201);
    const grantedView = await request('/api/v2/entities/reactor-http', playerB.credential, { headers: { 'x-v2-lock-digest': digest } });
    assert.equal(grantedView.status, 200);
    assert.equal('engineeringLog' in (await grantedView.json()).data, false);

    const command = { operationId: 'allocate-http', commandId: 'example.starship.reactor.allocate-power', entityId: 'reactor-http', expectedRevision: 1, input: { subsystem: 'propulsion', amount: 12 } };
    const headers = { 'x-v2-lock-digest': digest };
    assert.equal((await jsonRequest('/api/v2/commands', { ...command, principalId: playerA.memberId }, 'local-gm', 'POST', headers)).status, 400, 'client principal identity is rejected');
    assert.equal((await jsonRequest('/api/v2/commands', { ...command, campaignId: 'another-campaign' }, 'local-gm', 'POST', headers)).status, 400, 'client campaign identity is rejected');
    const appliedResponse = await jsonRequest('/api/v2/commands', command, 'local-gm', 'POST', headers);
    assert.equal(appliedResponse.status, 200, await appliedResponse.clone().text());
    const applied = await appliedResponse.json();
    assert.equal(applied.status, 'applied');
    assert.equal(applied.revision, 2);
    assert.equal(applied.outcomes.length, 1, 'GM receives the declared GM-visible outcome');
    assert.deepEqual(await (await jsonRequest('/api/v2/commands', command, 'local-gm', 'POST', headers)).json(), applied, 'exact HTTP retry returns same committed result');
    assert.equal((await jsonRequest('/api/v2/commands', { ...command, input: { subsystem: 'propulsion', amount: 13 } }, 'local-gm', 'POST', headers)).status, 409, 'changed payload is rejected');
    assert.equal((await jsonRequest('/api/v2/commands', { ...command, operationId: 'player-command', expectedRevision: 2 }, playerB.credential, 'POST', headers)).status, 403, 'read grant cannot elevate a GM-only command');
    assert.equal((await jsonRequest('/api/v2/commands', command, playerB.credential, 'POST', headers)).status, 403, 'another principal cannot use the original command receipt');
    assert.equal((await jsonRequest('/api/v2/commands', { ...command, operationId: 'stale-command' }, 'local-gm', 'POST', headers)).status, 409, 'stale entity revision is rejected');
    assert.equal(host.db.prepare('SELECT revision,data FROM v2_effect_entities WHERE campaign_id=? AND entity_id=?').get('campaign-v2-http', 'reactor-http').revision, 2);
    const audit = host.db.prepare('SELECT kind,visibility,payload FROM v2_extension_events WHERE operation_id=?').get(command.operationId);
    assert.equal(audit.kind, 'command.applied');
    assert.equal(audit.visibility, 'private');
    assert.deepEqual(JSON.parse(audit.payload), { commandId: command.commandId, revision: 2 });
    assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('player-command').count, 0, 'rejected attempts produce no receipt');

    assert.equal((await jsonRequest(`/api/v2/entities/reactor-http/grants/${playerB.memberId}`, {}, 'local-gm', 'DELETE')).status, 200);
    assert.equal((await request('/api/v2/entities/reactor-http', playerB.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 404, 'permission revocation takes effect for the next request');
    const rotated = await jsonRequest(`/api/members/${playerB.memberId}/rotate`, {});
    assert.equal(rotated.status, 200);
    const rotatedCredential = (await rotated.json()).credential;
    assert.equal((await request('/api/v2/campaign/lock', playerB.credential)).status, 401, 'rotated credentials are revalidated rather than accepted from the earlier HTTP auth check');
    assert.equal((await request('/api/v2/campaign/lock', rotatedCredential)).status, 200);
    assert.equal((await request('/api/v2/entities/reactor-http', 'local-player', { headers: { 'x-v2-lock-digest': digest } })).status, 403, 'legacy shared fixture token has no V2 principal authority');

    host.close();
    await launch();
    const restoredLock = await request('/api/v2/campaign/lock', playerA.credential);
    assert.equal(restoredLock.status, 200);
    assert.equal((await restoredLock.json()).digest, digest);
    const restoredEntity = await request('/api/v2/entities/reactor-http', playerA.credential, { headers: { 'x-v2-lock-digest': digest } });
    assert.equal(restoredEntity.status, 200);
    assert.equal((await restoredEntity.json()).data.allocations.propulsion, 12);
    assert.deepEqual(await (await jsonRequest('/api/v2/commands', command, 'local-gm', 'POST', headers)).json(), applied, 'receipt remains valid across host restart');

    assert.equal((await request(`/api/members/${playerA.memberId}`, 'local-gm', { method: 'DELETE' })).status, 200);
    const rejectedRetry = await jsonRequest('/api/v2/commands', command, playerA.credential, 'POST', headers);
    assert.equal(rejectedRetry.status, 401, 'revoked membership cannot use an old command receipt');
    assert.equal(host.db.prepare('SELECT revision FROM v2_effect_entities WHERE campaign_id=? AND entity_id=?').get('campaign-v2-http', 'reactor-http').revision, 2);
  } finally {
    host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
