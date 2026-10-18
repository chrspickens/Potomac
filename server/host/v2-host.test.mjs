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
    host.close();
    await launch();
    assert.equal((await request('/api/v2/entities/reactor-http', playerB.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 200, 'the existing actor grant persists through host restart');

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
    assert.deepEqual(JSON.parse(audit.payload), { commandId: command.commandId, revision: 2, outcomes: [], transcriptDigest: applied.resolutionTranscript.digest, randomness: [], decisions: [] });
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
    assert.equal((await request('/api/v2/entities/reactor-http', rotatedCredential, { headers: { 'x-v2-lock-digest': digest } })).status, 404, 'revoked entity grants remain revoked after restart');
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

test('Revised 5e HTTP encounter authenticates actor ownership, audits host rolls, and recovers receipts and combat state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-v2-5e-'));
  const databasePath = join(directory, 'host.sqlite');
  const draws = [20, 1, 1, 20, 4, 3];
  let drawCount = 0, host, baseUrl;
  const launch = async () => {
    host = createHost({ databasePath, campaignId: 'campaign-v2-5e', enableV2Api: true, v2RandomInt: (min, max) => {
      assert.equal(min, 1); assert.ok(max >= 2);
      const draw = draws[drawCount++]; assert.ok(draw >= min && draw < max, `unexpected requested die: ${draw} for 1..${max - 1}`);
      return draw;
    } });
    const address = await host.listen(0); baseUrl = `http://127.0.0.1:${address.port}`;
  };
  const request = (path, token = 'local-gm', options = {}) => fetch(`${baseUrl}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const send = (path, body, token = 'local-gm', method = 'POST', headers = {}) => request(path, token, { method, body: JSON.stringify(body), headers });
  const proof = () => ({ 'x-v2-lock-digest': lockDigest });
  let lockDigest;
  try {
    await launch();
    const playerA = await (await send('/api/members/enroll', { displayName: 'Mira' })).json();
    const playerB = await (await send('/api/members/enroll', { displayName: 'Oren' })).json();
    const pin = await send('/api/v2/campaign/lock', { moduleId: 'example.revised5e' }, 'local-gm', 'PUT');
    assert.equal(pin.status, 201, await pin.clone().text()); lockDigest = (await pin.json()).digest;
    const actors = [
      { id: 'player-a', name: 'Mira Vale', kind: 'player', ownerPrincipalId: playerA.memberId, abilityModifiers: { strength: 3, dexterity: 1 }, proficiencyBonus: 2, armorClass: 14, maximumHitPoints: 12, currentHitPoints: 12, initiativeModifier: 1, weapon: { name: 'Shortsword', damageDie: 6, damageType: 'piercing', attackAbility: 'strength', proficient: true } },
      { id: 'player-b', name: 'Oren Pike', kind: 'player', ownerPrincipalId: playerB.memberId, abilityModifiers: { strength: 1, dexterity: 2 }, proficiencyBonus: 2, armorClass: 15, maximumHitPoints: 10, currentHitPoints: 10, initiativeModifier: 2, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } },
      { id: 'enemy', name: 'Mire Warden', kind: 'enemy', ownerPrincipalId: 'gm', abilityModifiers: { strength: 2, dexterity: 0 }, proficiencyBonus: 2, armorClass: 12, maximumHitPoints: 22, currentHitPoints: 22, initiativeModifier: 0, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } }
    ];
    const encounterId = 'encounter';
    const created = await send('/api/v2/entities', { operationId: 'create-encounter', entityId: encounterId, typeId: 'example.revised5e.encounter', visibility: 'public', data: { title: 'Mire Crossing', status: 'setup', actors, initiativeOrder: [], initiativeRolls: [], currentTurnIndex: 0, round: 0, actionsUsed: [], combatLog: [] } }, 'local-gm', 'POST', proof());
    assert.equal(created.status, 201, await created.clone().text());
    for (const member of [playerA, playerB]) assert.equal((await send(`/api/v2/entities/${encounterId}/grants`, { memberId: member.memberId, permissions: ['act'] }, 'local-gm', 'POST', proof())).status, 201);
    const init = await send('/api/v2/commands', { operationId: 'roll-initiative', commandId: 'example.revised5e.initialize', entityId: encounterId, expectedRevision: 1, input: {} }, 'local-gm', 'POST', proof());
    assert.equal(init.status, 200, await init.clone().text());
    assert.equal(drawCount, 3);
    const attack = { operationId: 'mira-attack-1', commandId: 'example.revised5e.attack', entityId: encounterId, expectedRevision: 2, input: { actorId: 'player-a', targetId: 'enemy' } };
    const denied = await send('/api/v2/commands', { ...attack, operationId: 'cross-player', input: { actorId: 'player-a', targetId: 'enemy' } }, playerB.credential, 'POST', proof());
    assert.equal(denied.status, 403, 'Player B cannot act for Player A'); assert.equal(drawCount, 3, 'unauthorized command consumes no randomness');
    const accepted = await send('/api/v2/commands', attack, playerA.credential, 'POST', proof());
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const receipt = await accepted.json();
    assert.equal(receipt.revision, 3);
    assert.equal(receipt.outcomes[0].kind, 'revised5e.attack.critical');
    assert.equal(receipt.outcomes[0].data.damage, 10);
    assert.equal(drawCount, 6);
    const playerViewResponse = await request(`/api/v2/entities/${encounterId}`, playerB.credential, { headers: proof() });
    assert.equal(playerViewResponse.status, 200); const playerView = await playerViewResponse.json();
    assert.equal(playerView.data.actors.find(actor => actor.id === 'enemy').currentHitPoints, 12);
    assert.equal('ownerPrincipalId' in playerView.data.actors[0], false, 'player projection hides ownership identities');
    const eventsResponse = await request('/api/v2/events', playerB.credential, { headers: proof() });
    assert.equal(eventsResponse.status, 200); const publicEvents = await eventsResponse.json();
    const attackEvent = publicEvents.find(event => event.operationId === attack.operationId);
    assert.ok(attackEvent); assert.deepEqual(attackEvent.payload.randomness.map(item => item.values), [[20], [4, 3]]);
    assert.equal(attackEvent.payload.resolutionTranscript, undefined, 'public audit exposes rolls but not internal transcript state');
    assert.deepEqual(await (await send('/api/v2/commands', attack, playerA.credential, 'POST', proof())).json(), receipt, 'exact retry is exactly-once');
    assert.equal((await send('/api/v2/commands', { ...attack, expectedRevision: 1 }, playerA.credential, 'POST', proof())).status, 409, 'altered retry payload rejected');
    assert.equal((await send('/api/v2/commands', { ...attack, operationId: 'stale-revision', expectedRevision: 1 }, playerA.credential, 'POST', proof())).status, 409, 'stale revision rejected');
    assert.equal((await send('/api/v2/commands', { ...attack, operationId: 'client-rolls', randomness: [{ values: [20] }] }, playerA.credential, 'POST', proof())).status, 400, 'client-supplied rolls rejected');
    const wrongTurn = await send('/api/v2/commands', { ...attack, operationId: 'wrong-turn', expectedRevision: 3 }, playerA.credential, 'POST', proof());
    assert.equal(wrongTurn.status, 409, 'actor cannot attack after turn advanced'); assert.equal(drawCount, 6, 'illegal turns consume no random draws');
    host.close(); await launch();
    const restored = await (await request(`/api/v2/entities/${encounterId}`, playerB.credential, { headers: proof() })).json();
    assert.equal(restored.revision, 3); assert.equal(restored.data.actors.find(actor => actor.id === 'enemy').currentHitPoints, 12);
    assert.equal(restored.data.initiativeOrder[restored.data.currentTurnIndex], 'player-b');
    assert.deepEqual(await (await send('/api/v2/commands', attack, playerA.credential, 'POST', proof())).json(), receipt, 'receipt remains exact across host restart');
    assert.equal(drawCount, 6, 'retry after restart does not reroll');
  } finally { host?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('authenticated HTTP reaction routes recover, authorize and resume a generic interruption exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-v2-reaction-http-'));
  const databasePath = join(directory, 'host.sqlite'); let host, baseUrl, draws = 0;
  const launch = async () => { host = createHost({ databasePath, campaignId: 'campaign-v2-reaction-http', enableV2Api: true, v2RandomInt: min => { draws++; return min; } }); const address = await host.listen(0); baseUrl = `http://127.0.0.1:${address.port}`; };
  const request = (path, token = 'local-gm', options = {}) => fetch(`${baseUrl}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const send = (path, body, token = 'local-gm', headers = {}) => request(path, token, { method: 'POST', body: JSON.stringify(body), headers });
  let playerA, playerB, digest, pending, decisionBody;
  try {
    await launch();
    playerA = await (await send('/api/members/enroll', { displayName: 'Interrupt initiator' })).json();
    playerB = await (await send('/api/members/enroll', { displayName: 'Eligible responder' })).json();
    const pinned = await request('/api/v2/campaign/lock', 'local-gm', { method: 'PUT', body: JSON.stringify({ moduleId: 'example.interruption' }), headers: { 'content-type': 'application/json' } });
    assert.equal(pinned.status, 201, await pinned.clone().text()); digest = (await pinned.json()).digest; const lock = { 'x-v2-lock-digest': digest };
    const created = await send('/api/v2/entities', { operationId: 'create-interrupt-record', entityId: 'interrupt-record', typeId: 'example.interruption.record', visibility: 'owner', ownerPrincipalId: playerB.memberId, data: { title: 'Signal from the old station', status: 'ready', lastChoice: 'none', gmNote: '' } }, 'local-gm', lock);
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal((await send('/api/v2/entities/interrupt-record/grants', { memberId: playerA.memberId, permissions: ['act'] }, 'local-gm', lock)).status, 201);
    const command = { operationId: 'initiate-interruption', commandId: 'example.interruption.request', entityId: 'interrupt-record', expectedRevision: 1, input: {} };
    const started = await send('/api/v2/commands', command, playerA.credential, lock); assert.equal(started.status, 200, await started.clone().text()); pending = await started.json(); assert.equal(pending.status, 'pending');
    assert.equal(draws, 1, 'host draws and records the private suspension randomness');
    assert.equal((await (await request('/api/v2/reactions', playerA.credential, { headers: lock })).json()).length, 0, 'initiator does not see GM-private responder window');
    const visible = await (await request('/api/v2/reactions', playerB.credential, { headers: lock })).json(); assert.equal(visible.length, 1); assert.equal(visible[0].permissions.submit, true);
    const detail = await (await request(`/api/v2/reactions/${pending.windowId}`, playerB.credential, { headers: lock })).json();
    assert.equal(detail.availableActions[0].actionId, 'example.interruption.choose'); assert.equal(JSON.stringify(detail).includes('hidden table prompt'), false);
    assert.equal((await send(`/api/v2/reactions/${pending.windowId}/decisions`, { operationId: 'spoof', actionId: 'example.interruption.choose', input: { choice: 'accept' }, decision: 'accept', principalId: playerA.memberId }, playerB.credential, lock)).status, 400, 'caller cannot select principal identity');
    host.close(); await launch();
    decisionBody = { operationId: 'player-b-choice', actionId: 'example.interruption.choose', input: { choice: 'accept' }, decision: 'accept' };
    const resolved = await send(`/api/v2/reactions/${pending.windowId}/decisions`, decisionBody, playerB.credential, lock); assert.equal(resolved.status, 200, await resolved.clone().text()); assert.equal((await resolved.json()).status, 'resolved');
    assert.equal(draws, 2, 'resume draw is host generated after restart');
    const exact = await Promise.all([send(`/api/v2/reactions/${pending.windowId}/decisions`, decisionBody, playerB.credential, lock), send(`/api/v2/reactions/${pending.windowId}/decisions`, decisionBody, playerB.credential, lock)]); assert.deepEqual(exact.map(response => response.status), [200, 200], 'concurrent exact retries return authorized existing projections');
    assert.equal((await send(`/api/v2/reactions/${pending.windowId}/decisions`, { ...decisionBody, input: { choice: 'decline' } }, playerB.credential, lock)).status, 409, 'altered retry payload conflicts');
    assert.equal((await send(`/api/v2/reactions/${pending.windowId}/decisions`, { ...decisionBody, operationId: 'competing-choice' }, playerB.credential, lock)).status, 409, 'concurrent duplicate responder choice cannot apply twice');
    const playerEntity = await (await request('/api/v2/entities/interrupt-record', playerB.credential, { headers: lock })).json(); assert.equal(playerEntity.data.status, 'accepted', JSON.stringify(host.db.prepare('SELECT status,response FROM v2_extension_pending_commands WHERE operation_id=?').get(command.operationId))); assert.equal('gmNote' in playerEntity.data, false);
    const gmEntity = await (await request('/api/v2/entities/interrupt-record', 'local-gm', { headers: lock })).json(); assert.match(gmEntity.data.gmNote, /hidden table prompt/);
    const publicEvents = await (await request('/api/v2/events', playerB.credential, { headers: lock })).json();
    assert.ok(publicEvents.some(event => event.kind === 'command.resumed' && event.payload.outcomes.some(outcome => outcome.kind === 'interruption.completed')));
    assert.equal(JSON.stringify(publicEvents).includes('hidden table prompt'), false); assert.equal(JSON.stringify(publicEvents).includes('suspension-audit-draw'), false);
    const pendingRow = host.db.prepare('SELECT status,suspension_transcript FROM v2_extension_pending_commands WHERE operation_id=?').get(command.operationId);
    assert.equal(pendingRow.status, 'completed'); assert.equal(JSON.parse(pendingRow.suspension_transcript).randomness[0].visibility, 'gm');
    assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_receipts WHERE operation_id=?').get(command.operationId).count, 1);
    assert.deepEqual(await (await send('/api/v2/commands', command, playerA.credential, lock)).json().then(result => result.status), 'applied', 'completed parent retry does not remain pending');
    assert.equal(draws, 2); assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_receipts WHERE operation_id=?').get(command.operationId).count, 1);
    const secondEntity = await send('/api/v2/entities', { operationId: 'create-revocation-record', entityId: 'revocation-record', typeId: 'example.interruption.record', visibility: 'owner', ownerPrincipalId: playerB.memberId, data: { title: 'Revocation check', status: 'ready', lastChoice: 'none', gmNote: '' } }, 'local-gm', lock); assert.equal(secondEntity.status, 201);
    assert.equal((await send('/api/v2/entities/revocation-record/grants', { memberId: playerA.memberId, permissions: ['act'] }, 'local-gm', lock)).status, 201);
    const revokedCommand = { operationId: 'revocation-interruption', commandId: 'example.interruption.request', entityId: 'revocation-record', expectedRevision: 1, input: {} };
    const revokedPending = await send('/api/v2/commands', revokedCommand, playerA.credential, lock); assert.equal((await revokedPending.json()).status, 'pending');
    const revokedWindowId = (await host.db.prepare('SELECT window_id FROM v2_extension_pending_commands WHERE operation_id=?').get(revokedCommand.operationId)).window_id;
    assert.equal((await send(`/api/v2/reactions/${revokedWindowId}/expire`, {}, playerB.credential, lock)).status, 403, 'player cannot force host expiry');
    assert.equal((await request(`/api/members/${playerB.memberId}`, 'local-gm', { method: 'DELETE' })).status, 200, 'GM can revoke the responder membership');
    assert.equal((await send(`/api/v2/reactions/${revokedWindowId}/decisions`, { operationId: 'revoked-responder-choice', actionId: 'example.interruption.choose', input: { choice: 'accept' }, decision: 'accept' }, playerB.credential, lock)).status, 401, 'revoked responder cannot use a previously eligible reaction');
    assert.equal((await send(`/api/v2/reactions/${revokedWindowId}/adjudicate`, { decision: 'accept' }, 'local-gm', lock)).status, 200, 'authorized GM adjudication resumes after responder revocation');
    assert.equal(host.db.prepare('SELECT status FROM v2_extension_pending_commands WHERE operation_id=?').get(revokedCommand.operationId).status, 'completed');
  } finally { host?.close(); rmSync(directory, { recursive: true, force: true }); }
});
