import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function withHost(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-host-'));
  const host = createHost({ databasePath: join(directory, 'host.sqlite') });
  const address = await host.listen(0);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'gm', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer local-${role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  try { await run({ host, request }); }
  finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
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
  await withHost(async ({ request }) => {
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
