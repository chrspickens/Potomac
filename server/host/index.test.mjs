import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function withHost(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-host-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath });
  let address = await host.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'gm', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${role === 'gm' || role === 'player' ? `local-${role}` : role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  try {
    await run({ get host() { return host; }, request, restart: async () => {
      host.close();
      host = createHost({ databasePath });
      address = await host.listen(0);
      baseUrl = `http://127.0.0.1:${address.port}`;
    } });
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
}

const postJson = (request, path, body, role = 'gm') => request(path, role, { method: 'POST', body: JSON.stringify(body) });

test('state retains its fields and exposes stable encounter fixtures with normalized context', async () => {
  await withHost(async ({ host, request }) => {
    host.db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify({ activeEncounter: 'The Glass Bridge', legacyField: 'ignored' }), 'foundation-demo');
    const response = await request('/api/state', 'player');
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.campaignId, 'foundation-demo');
    assert.equal(state.role, 'player');
    assert.ok(Number.isInteger(state.revision));
    assert.ok(Array.isArray(state.modules));
    assert.ok(Array.isArray(state.actors));
    assert.ok(Array.isArray(state.events));
    assert.deepEqual(state.context, { activeEncounter: 'encounter-a' });
    assert.deepEqual(state.encounters.map(({ id }) => id), ['encounter-a', 'encounter-b']);
  });
});

test('context update is GM-only, validates IDs and publishes the selected stable ID', async () => {
  await withHost(async ({ request }) => {
    const denied = await postJson(request, '/api/context', { context: { activeEncounter: 'encounter-b' } }, 'player');
    assert.equal(denied.status, 403);
    for (const body of [
      {},
      { context: {} },
      { context: { activeEncounter: 'unknown' } },
      { context: { activeEncounter: 3 } },
      { context: { activeEncounter: null, extra: true } },
      { context: { activeEncounter: 'encounter-a' }, actorId: 'spoofed' }
    ]) {
      const invalid = await postJson(request, '/api/context', body);
      assert.equal(invalid.status, 400);
    }
    const updated = await postJson(request, '/api/context', { context: { activeEncounter: 'encounter-b' } });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).context, { activeEncounter: 'encounter-b' });
    const state = await (await request('/api/state')).json();
    assert.deepEqual(state.context, { activeEncounter: 'encounter-b' });
    assert.equal(state.events.at(-1).kind, 'context.changed');
    assert.deepEqual(state.events.at(-1).payload, { activeEncounter: 'encounter-b' });
  });
});

test('encounter lookup returns one authorized projection and hides unknown IDs uniformly', async () => {
  await withHost(async ({ request }) => {
    const found = await request('/api/encounters/encounter-a', 'player');
    assert.deepEqual(await found.json(), { id: 'encounter-a', name: 'The Glass Bridge', summary: 'A narrow crossing over a deep ravine.' });
    const missing = await request('/api/encounters/not-a-fixture', 'player');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Encounter not found' });
  });
});

test('player projections and replay streams omit GM-owned actors and their events', async () => {
  await withHost(async ({ host, request }) => {
    host.db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role) VALUES(?,?,?,?,?,?,?)')
      .run('secret-actor', 'private.module', '1', 1, JSON.stringify({ secret: 'hidden' }), '{}', 'gm');
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('secret-event', 'secret-actor', 'actor.created', 'public', JSON.stringify({ secret: 'hidden' }), new Date().toISOString());
    host.db.prepare('INSERT INTO events(id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?)')
      .run('private-event', 'gm.note', 'gm', JSON.stringify({ secret: 'hidden' }), new Date().toISOString());
    const state = await (await request('/api/state', 'player')).json();
    assert.equal(state.actors.some(actor => actor.id === 'secret-actor'), false);
    assert.equal(state.events.some(event => event.id === 'secret-event'), false);
    assert.equal(state.events.some(event => event.id === 'private-event'), false);
    assert.equal(state.events.some(event => event.actorId === 'secret-actor'), false);
    const actorLookup = await request('/api/actors/secret-actor', 'player');
    assert.equal(actorLookup.status, 404);
    assert.deepEqual(await actorLookup.json(), { error: 'Actor not found' });
  });
});

test('GM enrollment creates distinct member identities and private actors require ownership or grants', async () => {
  await withHost(async ({ host, request }) => {
    const deniedEnrollment = await postJson(request, '/api/members/enroll', { displayName: 'Unauthorized' }, 'player');
    assert.equal(deniedEnrollment.status, 403);
    const enroll = async displayName => {
      const response = await postJson(request, '/api/members/enroll', { displayName });
      assert.equal(response.status, 201);
      return response.json();
    };
    const alice = await enroll('Alice');
    const bob = await enroll('Bob');
    assert.notEqual(alice.memberId, bob.memberId);
    assert.notEqual(alice.credential, bob.credential);
    assert.equal(host.db.prepare('SELECT credential_hash FROM members WHERE id=?').get(alice.memberId).credential_hash.includes(alice.credential), false);

    const manifest = {
      id: 'members.module', version: '3', schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [{ id: 'wait', policy: 'selfService', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [] }]
    };
    assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
    assert.equal((await postJson(request, '/api/actors', { id: 'alice-actor', moduleId: manifest.id, moduleVersion: manifest.version, ownerMemberId: alice.memberId, data: {} })).status, 201);

    const aliceState = await (await request('/api/state', alice.credential)).json();
    const bobState = await (await request('/api/state', bob.credential)).json();
    assert.equal(aliceState.memberId, alice.memberId);
    assert.equal(bobState.memberId, bob.memberId);
    assert.deepEqual(aliceState.actors.map(actor => actor.id), ['alice-actor']);
    assert.equal(bobState.actors.some(actor => actor.id === 'alice-actor'), false);
    assert.equal((await request('/api/actors/alice-actor', 'player')).status, 404);
    assert.equal((await request('/api/actors/alice-actor', bob.credential)).status, 404);

    const operation = {
      operationId: 'alice-wait', campaignId: 'foundation-demo', memberId: alice.memberId,
      entityId: 'alice-actor', baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version,
      schemaVersion: 1, actionId: 'wait', parameters: {}, dependencies: []
    };
    assert.equal((await postJson(request, '/api/actions', { ...operation, memberId: bob.memberId }, bob.credential)).status, 404);
    const applied = await postJson(request, '/api/actions', operation, alice.credential);
    assert.equal(applied.status, 200);
    assert.deepEqual(await applied.json(), { operationId: 'alice-wait', entityId: 'alice-actor', status: 'applied', revision: 2 });
    const bobReplayBeforeGrant = await (await request('/api/state?since=0', bob.credential)).json();
    assert.equal(bobReplayBeforeGrant.events.some(event => event.actorId === 'alice-actor'), false);
    const deniedController = new AbortController();
    const deniedStream = await request('/api/stream?since=0', bob.credential, { signal: deniedController.signal });
    const deniedReader = deniedStream.body.getReader();
    let deniedText = '';
    const deniedRead = (async () => {
      while (!deniedText.includes('context.changed')) {
        const { done, value } = await deniedReader.read();
        if (done) break;
        deniedText += new TextDecoder().decode(value);
      }
    })();
    await postJson(request, '/api/context', { context: { activeEncounter: 'encounter-b' } });
    await deniedRead;
    deniedController.abort();
    assert.equal(deniedText.includes('alice-wait'), false);
    assert.equal(deniedText.includes('alice-actor'), false);
    assert.equal((await postJson(request, '/api/actors/alice-actor/grants', { memberId: bob.memberId, permissions: ['read'] }, bob.credential)).status, 403);
    assert.equal((await request(`/api/members/${bob.memberId}`, bob.credential, { method: 'DELETE' })).status, 403);

    const granted = await postJson(request, '/api/actors/alice-actor/grants', { memberId: bob.memberId, permissions: ['read'] });
    assert.equal(granted.status, 201);
    assert.equal((await request('/api/actors/alice-actor', bob.credential)).status, 200);
    const bobReplayAfterGrant = await (await request('/api/state?since=0', bob.credential)).json();
    assert.equal(bobReplayAfterGrant.events.some(event => event.actorId === 'alice-actor'), true);
    assert.equal((await postJson(request, '/api/actions', { ...operation, operationId: 'bob-wait', memberId: bob.memberId }, bob.credential)).status, 404);
    const actGrant = await postJson(request, '/api/actors/alice-actor/grants', { memberId: bob.memberId, permissions: ['act'] });
    assert.equal(actGrant.status, 201);
    const bobAction = { ...operation, operationId: 'bob-wait-with-grant', memberId: bob.memberId, baseRevision: 2 };
    assert.equal((await postJson(request, '/api/actions', bobAction, bob.credential)).status, 200);

    const controller = new AbortController();
    const cursor = (await (await request('/api/state', bob.credential)).json()).revision;
    const stream = await request(`/api/stream?since=${cursor}`, bob.credential, { signal: controller.signal });
    const readStream = (async () => {
      const reader = stream.body.getReader();
      let text = '';
      while (!text.includes('context.changed')) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();
    const aliceAction = { ...operation, operationId: 'alice-wait-while-bob-streams', baseRevision: 3 };
    assert.equal((await postJson(request, '/api/actions', aliceAction, alice.credential)).status, 200);
    await postJson(request, '/api/context', { context: { activeEncounter: 'encounter-a' } });
    const streamed = await readStream;
    controller.abort();
    assert.equal(streamed.includes('alice-wait-while-bob-streams'), true);
    assert.equal(streamed.includes('alice-actor'), true);
    const revoked = await request(`/api/actors/alice-actor/grants/${bob.memberId}`, 'gm', { method: 'DELETE' });
    assert.equal(revoked.status, 200);
    assert.equal((await request('/api/actors/alice-actor', bob.credential)).status, 404);
    const bobReplayAfterRevoke = await (await request('/api/state?since=0', bob.credential)).json();
    assert.equal(bobReplayAfterRevoke.events.some(event => event.actorId === 'alice-actor'), false);
  });
});

test('member action identity, campaign, module, and schema versions are checked by the host', async () => {
  await withHost(async ({ request }) => {
    const enrolled = await (await postJson(request, '/api/members/enroll', { displayName: 'Member' })).json();
    const manifest = {
      id: 'offline.module', version: '1', schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [{ id: 'wait', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [] }]
    };
    await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest });
    await postJson(request, '/api/actors', { id: 'offline-actor', moduleId: manifest.id, moduleVersion: manifest.version, ownerMemberId: enrolled.memberId, data: {} });
    const command = {
      operationId: 'offline-op', campaignId: 'foundation-demo', memberId: enrolled.memberId,
      entityId: 'offline-actor', baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version,
      schemaVersion: 1, actionId: 'wait', parameters: {}, dependencies: []
    };
    assert.equal((await postJson(request, '/api/actions', { ...command, memberId: 'somebody-else' }, enrolled.credential)).status, 403);
    assert.equal((await postJson(request, '/api/actions', { ...command, campaignId: 'other-campaign' }, enrolled.credential)).status, 409);
    assert.equal((await postJson(request, '/api/actions', { ...command, moduleVersion: '2' }, enrolled.credential)).status, 409);
    assert.equal((await postJson(request, '/api/actions', command, enrolled.credential)).status, 200);
  });
});

test('reconnect replays missed context changes after the supplied event cursor', async () => {
  await withHost(async ({ request }) => {
    const cursor = (await (await request('/api/state', 'player')).json()).revision;
    await postJson(request, '/api/context', { context: { activeEncounter: 'encounter-b' } });
    const controller = new AbortController();
    const streamResponse = await request(`/api/stream?since=${cursor}`, 'player', { signal: controller.signal });
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    let streamText = '';
    while (!streamText.includes('context.changed')) {
      const { done, value } = await reader.read();
      if (done) break;
      streamText += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.match(streamText, /event: update/);
    assert.match(streamText, /"activeEncounter":"encounter-b"/);
  });
});

test('action retry with the same operation ID returns the committed result once', async () => {
  await withHost(async ({ host, request }) => {
    const manifest = {
      id: 'test.module', version: '1',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [{ id: 'wait', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [] }]
    };
    assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
    assert.equal((await postJson(request, '/api/actors', { id: 'retry-actor', moduleId: manifest.id, moduleVersion: manifest.version, data: {} })).status, 201);
    host.db.prepare('UPDATE actors SET legacy_shared=1 WHERE id=?').run('retry-actor');
    const command = { operationId: 'operation-once', entityId: 'retry-actor', baseRevision: 1, actionId: 'wait' };
    const first = await postJson(request, '/api/actions', command, 'player');
    const second = await postJson(request, '/api/actions', command, 'player');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(Number(host.db.prepare('SELECT COUNT(*) AS count FROM operations WHERE id=?').get(command.operationId).count), 1);
  });
});

test('player action event projections redact arbitrary parameters while GM audit retains them', async () => {
  await withHost(async ({ host, request }) => {
    const manifest = {
      id: 'privacy.module', version: '1',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [{ id: 'submit', input: { type: 'object', properties: {}, additionalProperties: true }, effects: [] }]
    };
    assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
    assert.equal((await postJson(request, '/api/actors', {
      id: 'privacy-actor', moduleId: manifest.id, moduleVersion: manifest.version,
      data: { notes: { secret: 'gm-only-marker' } }, visibility: { gmOnly: ['notes.secret'] }
    })).status, 201);
    host.db.prepare('UPDATE actors SET legacy_shared=1 WHERE id=?').run('privacy-actor');
    const cursor = (await (await request('/api/state', 'player')).json()).revision;
    const command = {
      operationId: 'privacy-operation', entityId: 'privacy-actor', baseRevision: 1,
      actionId: 'submit', parameters: { copiedValue: 'gm-only-marker' }
    };
    assert.equal((await postJson(request, '/api/actions', command, 'player')).status, 200);

    const playerState = await (await request(`/api/state?since=${cursor}`, 'player')).json();
    const playerEvent = playerState.events.find(event => event.operationId === command.operationId || event.payload.operationId === command.operationId);
    assert.ok(playerEvent);
    assert.equal(Object.hasOwn(playerEvent.payload, 'parameters'), false);
    assert.equal(JSON.stringify(playerState).includes('gm-only-marker'), false);

    const controller = new AbortController();
    const stream = await request(`/api/stream?since=${cursor}`, 'player', { signal: controller.signal });
    const reader = stream.body.getReader();
    let streamed = '';
    while (!streamed.includes('action.applied')) {
      const { done, value } = await reader.read();
      if (done) break;
      streamed += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.equal(streamed.includes('gm-only-marker'), false);
    assert.equal(streamed.includes('"parameters"'), false);

    const gmState = await (await request(`/api/state?since=${cursor}`, 'gm')).json();
    const gmEvent = gmState.events.find(event => event.payload.operationId === command.operationId);
    assert.deepEqual(gmEvent.payload.parameters, command.parameters);
  });
});

test('player action on a GM-owned actor returns the same not-found response as a missing actor', async () => {
  await withHost(async ({ host, request }) => {
    host.db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role) VALUES(?,?,?,?,?,?,?)')
      .run('hidden-actor', 'private.module', '1', 1, '{}', '{}', 'gm');
    const command = { operationId: 'forbidden-operation', entityId: 'hidden-actor', baseRevision: 1, actionId: 'anything' };
    const hidden = await postJson(request, '/api/actions', command, 'player');
    const missing = await postJson(request, '/api/actions', { ...command, entityId: 'missing-actor' }, 'player');
    assert.equal(hidden.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await hidden.json(), await missing.json());
  });
});

async function offlineFixture(request, actorId = 'offline-protocol-actor') {
  const enrolled = await (await postJson(request, '/api/members/enroll', { displayName: 'Offline member' })).json();
  const manifest = {
    id: 'offline.protocol.module', version: '1',
    schema: { type: 'object', properties: { resources: { type: 'object', properties: { focus: { type: 'integer', minimum: 0 } }, required: ['focus'] } }, required: ['resources'], additionalProperties: true },
    actions: [
      { id: 'spend', policy: 'selfService', reconciliation: 'commutative', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [{ op: 'changeResource', resource: 'focus', amount: { literal: -1 } }] },
      { id: 'recover', policy: 'gmReview', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [{ op: 'changeResource', resource: 'focus', amount: { literal: 1 } }] }
    ]
  };
  assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
  assert.equal((await postJson(request, '/api/actors', { id: actorId, moduleId: manifest.id, moduleVersion: manifest.version, ownerMemberId: enrolled.memberId, data: { resources: { focus: 3 } } })).status, 201);
  const operation = (operationId, actionId) => ({
    operationId, campaignId: 'foundation-demo', memberId: enrolled.memberId, entityId: actorId,
    baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version, schemaVersion: 1,
    actionId, parameters: {}, dependencies: []
  });
  return { ...enrolled, manifest, operation };
}

test('offline self-service receipt is canonical, member-scoped, idempotent and durable across restart', async () => {
  await withHost(async ({ request, restart }) => {
    const member = await offlineFixture(request);
    const command = member.operation('offline-spend-once', 'spend');
    command.dependencies = [{ entityId: command.entityId, revision: 1 }];
    const first = await postJson(request, '/api/offline/operations', command, member.credential);
    assert.equal(first.status, 200);
    const receipt = await first.json();
    assert.equal(receipt.status, 'applied');
    assert.equal(receipt.revision, 2);
    assert.match(receipt.requestHash, /^[0-9a-f]{64}$/);
    assert.equal((await (await request('/api/actors/offline-protocol-actor', member.credential)).json()).data.resources.focus, 2);
    const gmAudit = (await (await request('/api/state')).json()).events.find(event => event.payload.operationId === command.operationId);
    const playerAudit = (await (await request('/api/state', member.credential)).json()).events.find(event => event.payload.operationId === command.operationId);
    assert.equal(gmAudit.payload.memberId, member.memberId);
    assert.equal(playerAudit.payload.memberId, undefined);
    const reordered = { ...command, dependencies: [{ revision: 1, entityId: command.entityId }] };
    assert.deepEqual(await (await postJson(request, '/api/offline/operations', reordered, member.credential)).json(), receipt);
    const collision = await postJson(request, '/api/offline/operations', { ...command, actionId: 'recover' }, member.credential);
    assert.equal(collision.status, 409);
    assert.equal((await collision.json()).reasonCode, 'operation_id_collision');
    await restart();
    assert.deepEqual(await (await request('/api/offline/operations/offline-spend-once', member.credential)).json(), receipt);
    const mine = await (await request('/api/proposals/mine', member.credential)).json();
    assert.equal(mine.receipts.some(item => item.operationId === command.operationId && item.status === 'applied'), true);
  });
});

test('a declared commutative resource delta can apply against a newer authorized revision', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'commutative-actor');
    const first = await postJson(request, '/api/offline/operations', member.operation('commutative-first', 'spend'), member.credential);
    assert.equal((await first.json()).status, 'applied');
    const stale = await postJson(request, '/api/offline/operations', member.operation('commutative-stale', 'spend'), member.credential);
    assert.equal(stale.status, 200);
    assert.equal((await stale.json()).revision, 3);
    const actor = await (await request('/api/actors/commutative-actor', member.credential)).json();
    assert.equal(actor.data.resources.focus, 1);
    assert.equal(actor.revision, 3);
  });
});

test('GM changes an authorized prerequisite while player is offline without resurrecting stale intent', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'dependent-actor');
    const prerequisite = 'prerequisite-actor';
    assert.equal((await postJson(request, '/api/actors', {
      id: prerequisite, moduleId: member.manifest.id, moduleVersion: member.manifest.version,
      ownerMemberId: member.memberId, data: { resources: { focus: 3 } },
    })).status, 201);
    const queued = member.operation('dependent-stale', 'spend');
    queued.dependencies = [{ entityId: prerequisite, revision: 1 }];
    assert.equal((await postJson(request, '/api/actions', {
      operationId: 'gm-prerequisite-change', entityId: prerequisite, baseRevision: 1,
      actionId: 'spend', parameters: {},
    })).status, 200);
    const response = await postJson(request, '/api/offline/operations', queued, member.credential);
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.status, 'conflicted');
    assert.equal(receipt.reasonCode, 'dependency_revision_conflict');
    assert.equal((await (await request('/api/actors/dependent-actor', member.credential)).json()).data.resources.focus, 3);
    assert.equal((await (await request('/api/actors/prerequisite-actor', member.credential)).json()).data.resources.focus, 2);
  });
});

test('GM review proposal persists without changing actor state and can be accepted idempotently', async () => {
  await withHost(async ({ request, restart }) => {
    const member = await offlineFixture(request);
    const command = member.operation('offline-recover-proposal', 'recover');
    const submitted = await postJson(request, '/api/offline/operations', command, member.credential);
    assert.equal(submitted.status, 202);
    const receipt = await submitted.json();
    assert.equal(receipt.status, 'awaitingReview');
    assert.equal(typeof receipt.proposalId, 'string');
    assert.equal((await (await request('/api/actors/offline-protocol-actor', member.credential)).json()).data.resources.focus, 3);
    assert.equal((await request('/api/proposals', member.credential)).status, 403);
    assert.equal((await request(`/api/proposals/${receipt.proposalId}`, member.credential)).status, 403);
    await restart();
    const list = await (await request('/api/proposals?status=pending')).json();
    assert.equal(list.proposals.some(proposal => proposal.id === receipt.proposalId), true);
    const detail = await (await request(`/api/proposals/${receipt.proposalId}`)).json();
    assert.equal(detail.requestHash, receipt.requestHash);
    assert.deepEqual(detail.request, command);
    const mine = await (await request('/api/proposals/mine', member.credential)).json();
    assert.equal(mine.receipts.find(item => item.operationId === command.operationId).status, 'awaitingReview');
    const decision = { decisionId: 'gm-decision-accept-1', decision: 'accept', reason: 'Reviewed' };
    const acceptedResponse = await postJson(request, `/api/proposals/${receipt.proposalId}/decisions`, decision);
    assert.equal(acceptedResponse.status, 200);
    const accepted = await acceptedResponse.json();
    assert.equal(accepted.status, 'applied');
    assert.equal(accepted.revision, 2);
    await restart();
    assert.deepEqual(await (await postJson(request, `/api/proposals/${receipt.proposalId}/decisions`, decision)).json(), accepted);
    assert.equal((await (await request('/api/actors/offline-protocol-actor')).json()).data.resources.focus, 4);
    const mineAfter = await (await request('/api/proposals/mine', member.credential)).json();
    assert.equal(mineAfter.receipts.find(item => item.operationId === command.operationId).status, 'applied');
  });
});

test('offline review rejection and stale acceptance persist decisions without applying stale state', async () => {
  await withHost(async ({ host, request }) => {
    const member = await offlineFixture(request, 'offline-reject-actor');
    const rejectCommand = member.operation('offline-reject-op', 'recover');
    const rejectedReceipt = await (await postJson(request, '/api/offline/operations', rejectCommand, member.credential)).json();
    const reject = await postJson(request, `/api/proposals/${rejectedReceipt.proposalId}/decisions`, { decisionId: 'decision-reject-1', decision: 'reject', reason: 'Not approved' });
    assert.equal(reject.status, 200);
    const rejection = await reject.json();
    assert.equal(rejection.status, 'rejected');
    assert.equal(rejection.reasonCode, 'gm_rejected');
    assert.equal(rejection.reason, 'Not approved');
    assert.equal((await postJson(request, `/api/proposals/${rejectedReceipt.proposalId}/decisions`, { decisionId: 'decision-reject-1', decision: 'reject', reason: 'Not approved' })).status, 200);
    assert.equal((await postJson(request, `/api/proposals/${rejectedReceipt.proposalId}/decisions`, { decisionId: 'decision-reject-1', decision: 'accept' })).status, 409);

    const staleCommand = member.operation('offline-stale-op', 'recover');
    const staleReceipt = await (await postJson(request, '/api/offline/operations', staleCommand, member.credential)).json();
    host.db.prepare('UPDATE actors SET revision=revision+1 WHERE id=?').run(staleCommand.entityId);
    const staleDecision = await postJson(request, `/api/proposals/${staleReceipt.proposalId}/decisions`, { decisionId: 'decision-stale-1', decision: 'accept' });
    assert.equal(staleDecision.status, 200);
    const conflict = await staleDecision.json();
    assert.equal(conflict.status, 'conflicted');
    assert.equal(conflict.reasonCode, 'revision_conflict');
    const repeated = await postJson(request, '/api/offline/operations', staleCommand, member.credential);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).requestHash, staleReceipt.requestHash);
    const actor = await (await request(`/api/actors/${staleCommand.entityId}`)).json();
    assert.equal(actor.revision, 2);
    const gmList = await (await request('/api/proposals?status=conflict')).json();
    assert.equal(gmList.proposals.some(proposal => proposal.id === staleReceipt.proposalId), true);
  });
});

test('offline operation validates current module, schema and dependency revisions and keeps conflict receipts', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'offline-validation-actor');
    const base = member.operation('offline-validation-base', 'spend');
    for (const [operationId, changes, reasonCode] of [
      ['offline-wrong-module', { moduleVersion: '99' }, 'module_schema_conflict'],
      ['offline-wrong-schema', { schemaVersion: 99 }, 'module_schema_conflict'],
      ['offline-stale-dependency', { dependencies: [{ entityId: 'offline-validation-actor', revision: 0 }] }, 'dependency_revision_conflict']
    ]) {
      const response = await postJson(request, '/api/offline/operations', { ...base, ...changes, operationId }, member.credential);
      assert.equal(response.status, 200);
      const receipt = await response.json();
      assert.equal(receipt.status, 'conflicted');
      assert.equal(receipt.reasonCode, reasonCode);
      const replay = await request(`/api/offline/operations/${operationId}`, member.credential);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).requestHash, receipt.requestHash);
    }
    assert.equal((await (await request('/api/actors/offline-validation-actor', member.credential)).json()).data.resources.focus, 3);
  });
});

test('proposal acceptance rechecks the submitter current permission', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'offline-revoked-member-actor');
    const command = member.operation('offline-revoked-permission', 'recover');
    const submitted = await (await postJson(request, '/api/offline/operations', command, member.credential)).json();
    assert.equal((await request(`/api/members/${member.memberId}`, 'gm', { method: 'DELETE' })).status, 200);
    const decision = await postJson(request, `/api/proposals/${submitted.proposalId}/decisions`, { decisionId: 'decision-revoked-member', decision: 'accept' });
    assert.equal(decision.status, 200);
    const receipt = await decision.json();
    assert.equal(receipt.status, 'conflicted');
    assert.equal(receipt.reasonCode, 'actor_unavailable');
    assert.equal((await (await request('/api/actors/offline-revoked-member-actor')).json()).revision, 1);
  });
});

test('offline submission enforces authenticated member scope, current permission and filtered proposal events', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'offline-private-actor');
    const command = member.operation('offline-private-op', 'recover');
    assert.equal((await postJson(request, '/api/offline/operations', command, 'player')).status, 403);
    assert.equal((await postJson(request, '/api/offline/operations', { ...command, memberId: 'spoofed-member' }, member.credential)).status, 403);
    const cursor = (await (await request('/api/state', member.credential)).json()).revision;
    const response = await postJson(request, '/api/offline/operations', command, member.credential);
    const receipt = await response.json();
    const playerReplay = await (await request(`/api/state?since=${cursor}`, 'player')).json();
    assert.equal(playerReplay.events.some(event => event.kind === 'offline.proposal.submitted'), false);
    const gmReplay = await (await request(`/api/state?since=${cursor}`)).json();
    assert.equal(gmReplay.events.some(event => event.kind === 'offline.proposal.submitted' && event.payload.proposalId === receipt.proposalId), true);
    const unauthorized = await request('/api/proposals/mine', 'player');
    assert.equal(unauthorized.status, 403);
  });
});
