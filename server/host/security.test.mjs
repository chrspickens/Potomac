import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-security-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath });
  let address = await host.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'player', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer local-${role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  try {
    await run({ request, get host() { return host; }, restart: async () => {
      host.close();
      host = createHost({ databasePath });
      address = await host.listen(0);
      baseUrl = `http://127.0.0.1:${address.port}`;
    } });
  } finally {
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const post = (request, path, body, role = 'player') => request(path, role, { method: 'POST', body: JSON.stringify(body) });
const moduleDefinition = {
  id: 'security.fixture', version: '1',
  schema: { type: 'object', properties: { publicValue: { type: 'number' }, secret: { type: 'number' }, notes: { type: 'object', properties: { hidden: { type: 'string' } } } }, additionalProperties: true },
  derivedValues: [
    { id: 'publicDouble', value: { op: 'multiply', left: { ref: 'publicValue' }, right: { literal: 2 } } },
    { id: 'secretDerived', value: { op: 'add', left: { ref: 'secret' }, right: { literal: 5 } } },
    { id: 'nestedSecretDerived', value: { op: 'eq', left: { ref: 'notes.hidden' }, right: { literal: 'classified' } } },
  ],
  actions: [{ id: 'wait', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [] }],
};

async function addActors(request, host) {
  assert.equal((await post(request, '/api/modules', { id: moduleDefinition.id, version: moduleDefinition.version, manifest: moduleDefinition }, 'gm')).status, 201);
  const add = (id, ownerRole, value) => host.db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role) VALUES(?,?,?,?,?,?,?)')
    .run(id, moduleDefinition.id, moduleDefinition.version, 1, JSON.stringify(value), JSON.stringify({ gmOnly: ['secret', 'notes.hidden'] }), ownerRole);
  add('player-actor', 'player', { publicValue: 7, secret: 42, notes: { hidden: 'classified' }, derived: { persistedLeak: 'classified' } });
  add('gm-actor', 'gm', { publicValue: 9, secret: 81, notes: { hidden: 'classified' }, derived: {} });
}

test('unauthenticated, missing and unauthorized actor reads/actions do not reveal actor existence', async () => {
  await fixture(async ({ request, host }) => {
    await addActors(request, host);
    const unauthorizedRead = await request('/api/actors/gm-actor');
    const missingRead = await request('/api/actors/missing-actor');
    assert.equal(unauthorizedRead.status, 404);
    assert.deepEqual(await unauthorizedRead.json(), await missingRead.json());
    assert.equal((await request('/api/actors/gm-actor', 'unknown')).status, 401);

    const command = { operationId: 'secure-op', entityId: 'gm-actor', baseRevision: 1, actionId: 'wait' };
    const unauthorizedAction = await post(request, '/api/actions', command);
    const missingAction = await post(request, '/api/actions', { ...command, entityId: 'missing-actor' });
    assert.equal(unauthorizedAction.status, 404);
    assert.deepEqual(await unauthorizedAction.json(), await missingAction.json());
    assert.equal((await post(request, '/api/actions', command, 'nobody')).status, 401);
    assert.equal((await request('/api/actors/player-actor')).status, 200);
  });
});

test('player actor projection removes GM fields before evaluation and keeps unrelated derived values', async () => {
  await fixture(async ({ request, host }) => {
    await addActors(request, host);
    const playerActor = await (await request('/api/actors/player-actor')).json();
    assert.equal(playerActor.data.secret, undefined);
    assert.equal(playerActor.data.notes.hidden, undefined);
    assert.equal(Object.hasOwn(playerActor.data.derived, 'persistedLeak'), false);
    assert.equal(playerActor.data.derived.publicDouble, 14);
    assert.equal(Object.hasOwn(playerActor.data.derived, 'secretDerived'), false);
    assert.equal(Object.hasOwn(playerActor.data.derived, 'nestedSecretDerived'), false);
    const gmActor = await (await request('/api/actors/gm-actor', 'gm')).json();
    assert.equal(gmActor.data.derived.secretDerived, 86);
    assert.equal(gmActor.data.derived.nestedSecretDerived, true);
  });
});

test('crafted actor IDs and nonexistent-actor events stay isolated in snapshots and replay', async () => {
  await fixture(async ({ request, host }) => {
    await addActors(request, host);
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('dangling-event', 'deleted-secret-actor', 'actor.changed', 'public', JSON.stringify({ marker: 'orphan-marker' }), new Date().toISOString());
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('gm-actor-event', 'gm-actor', 'actor.changed', 'public', JSON.stringify({ marker: 'gm-actor-marker' }), new Date().toISOString());
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('gm-private-event', 'player-actor', 'gm.note', 'gm', JSON.stringify({ marker: 'private-marker' }), new Date().toISOString());
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('player-event', 'player-actor', 'actor.changed', 'public', JSON.stringify({ marker: 'public-marker' }), new Date().toISOString());
    const playerState = await (await request('/api/state?since=0')).json();
    assert.equal(JSON.stringify(playerState).includes('orphan-marker'), false);
    assert.equal(JSON.stringify(playerState).includes('gm-actor-marker'), false);
    assert.equal(JSON.stringify(playerState).includes('private-marker'), false);
    assert.equal(playerState.events.some(event => event.id === 'player-event'), true);
    assert.equal(playerState.actors.some(actor => actor.id === 'gm-actor'), false);
    assert.equal((await request('/api/actors/gm-actor%27%20OR%201%3D1--')).status, 404);
    const craftedAction = await post(request, '/api/actions', { operationId: 'crafted', entityId: "gm-actor' OR 1=1--", baseRevision: 1, actionId: 'wait' });
    assert.equal(craftedAction.status, 404);

    const controller = new AbortController();
    const stream = await request('/api/stream?since=0', 'player', { signal: controller.signal });
    const reader = stream.body.getReader();
    let streamed = '';
    while (!streamed.includes('player-event')) {
      const { done, value } = await reader.read();
      if (done) break;
      streamed += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.equal(streamed.includes('orphan-marker'), false);
    assert.equal(streamed.includes('dangling-event'), false);
    assert.equal(streamed.includes('gm-actor-marker'), false);
    assert.equal(streamed.includes('private-marker'), false);
    assert.equal(streamed.includes('public-marker'), true);
  });
});

test('GM-only context mutation is denied to players and durable events replay after restart by cursor', async () => {
  await fixture(async ({ request, restart }) => {
    const before = await (await request('/api/state')).json();
    const denied = await post(request, '/api/context', { context: { activeEncounter: 'encounter-b' } });
    assert.equal(denied.status, 403);
    assert.deepEqual((await (await request('/api/state')).json()).context, before.context);
    const changed = await post(request, '/api/context', { context: { activeEncounter: 'encounter-b' } }, 'gm');
    assert.equal(changed.status, 200);
    const cursor = before.revision;
    await restart();
    const replay = await (await request(`/api/state?since=${cursor}`)).json();
    assert.equal(replay.events.some(event => event.kind === 'context.changed' && event.payload.activeEncounter === 'encounter-b'), true);
    const controller = new AbortController();
    const stream = await request(`/api/stream?since=${cursor}`, 'player', { signal: controller.signal });
    const reader = stream.body.getReader();
    let streamed = '';
    while (!streamed.includes('context.changed')) {
      const { done, value } = await reader.read();
      if (done) break;
      streamed += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.match(streamed, /"activeEncounter":"encounter-b"/);
  });
});
