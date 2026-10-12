import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-security-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath, seedDemo: true });
  let address = await host.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'player', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${role === 'gm' || role === 'player' ? `local-${role}` : role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  try {
    await run({ request, get host() { return host; }, restart: async () => {
      host.close();
      host = createHost({ databasePath, seedDemo: true });
      address = await host.listen(0);
      baseUrl = `http://127.0.0.1:${address.port}`;
    } });
  } finally {
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const post = async (request, path, body, role = 'player') => {
  if (path === '/api/actors' && role === 'gm') {
    const campaign = await (await request('/api/campaign', 'gm')).json();
    if (!campaign.systemModuleId) await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify({ name: 'Test campaign', systemModuleId: body.moduleId, systemModuleVersion: body.moduleVersion, baseRevision: campaign.revision }) });
  }
  return request(path, role, { method: 'POST', body: JSON.stringify(body) });
};
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

test('host refuses non-loopback listeners so bearer credentials stay local', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-bind-security-'));
  const host = createHost({ databasePath: join(directory, 'host.sqlite') });
  try {
    assert.throws(() => host.listen(0, '0.0.0.0'), /loopback/);
    const address = await host.listen(0);
    for (const token of ['local-gm', 'local-player']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/state`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
    }
  } finally {
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrade preserves 0.2 shared access only for existing player actors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-legacy-upgrade-'));
  const databasePath = join(directory, 'host.sqlite');
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    CREATE TABLE modules (id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(id, version));
    CREATE TABLE actors (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, module_version TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT '{}', owner_role TEXT NOT NULL DEFAULT 'player');
    CREATE TABLE events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation_id TEXT UNIQUE, actor_id TEXT, kind TEXT NOT NULL, visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE operations (id TEXT PRIMARY KEY, response TEXT NOT NULL, actor_id TEXT, action_id TEXT, request_hash TEXT);
    CREATE TABLE offline_proposals (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, member_id TEXT NOT NULL, actor_id TEXT NOT NULL, action_id TEXT NOT NULL, request_hash TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decision_id TEXT UNIQUE, decision TEXT, decision_response TEXT);
    CREATE TABLE campaign (id TEXT PRIMARY KEY, context TEXT NOT NULL DEFAULT '{}', name TEXT NOT NULL DEFAULT '', system_module_id TEXT, system_module_version TEXT, revision INTEGER NOT NULL DEFAULT 1);
  `);
  legacyDb.prepare('INSERT INTO offline_proposals(id,operation_id,member_id,actor_id,action_id,request_hash,request,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('legacy-proposal', 'legacy-operation', 'legacy-member', 'legacy-actor', 'wait', 'old-hash', '{}', 'pending', '2026-01-01T00:00:00.000Z');
  legacyDb.prepare('INSERT INTO modules(id,version,manifest) VALUES(?,?,?)').run(moduleDefinition.id, moduleDefinition.version, JSON.stringify(moduleDefinition));
  legacyDb.prepare('INSERT INTO campaign(id,context,name,system_module_id,system_module_version,revision) VALUES(?,?,?,?,?,1)').run('foundation-demo', '{}', 'Legacy', moduleDefinition.id, moduleDefinition.version);
  legacyDb.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role) VALUES(?,?,?,?,?,?,?)')
    .run('legacy-actor', moduleDefinition.id, moduleDefinition.version, 1, JSON.stringify({ moduleId: moduleDefinition.id, moduleVersion: moduleDefinition.version, schemaVersion: 1, entityId: 'legacy-actor', revision: 1, publicValue: 1, secret: 2, notes: { hidden: 'old' }, derived: {} }), '{}', 'player');
  legacyDb.close();
  const host = createHost({ databasePath, seedDemo: true });
  try {
    const migratedProposal = host.db.prepare('SELECT id,campaign_id,base_revision,rule_version FROM offline_proposals WHERE id=?').get('legacy-proposal');
    assert.deepEqual({ ...migratedProposal }, { id: 'legacy-proposal', campaign_id: null, base_revision: null, rule_version: null });
    const address = await host.listen(0);
    const request = (path, token) => fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await request('/api/actors/legacy-actor', 'local-player')).status, 200);
    const created = await fetch(`http://127.0.0.1:${address.port}/api/actors`, {
      method: 'POST', headers: { authorization: 'Bearer local-gm', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'new-actor', moduleId: moduleDefinition.id, moduleVersion: moduleDefinition.version, data: { publicValue: 1, secret: 2, notes: { hidden: 'new' } } }),
    });
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    assert.equal((await request('/api/actors/new-actor', 'local-player')).status, 404);
  } finally {
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('GM cannot accept a proposal under a different rules version', async () => {
  await fixture(async ({ request }) => {
    const manifest = { ...moduleDefinition, rulesVersion: 1, actions: [{ id: 'review', policy: 'gmReview', input: { type: 'object', properties: {}, additionalProperties: false }, effects: [] }] };
    assert.equal((await post(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest }, 'gm')).status, 201);
    const enrolled = await (await post(request, '/api/members/enroll', { displayName: 'Rules reviewer' }, 'gm')).json();
    const created = await post(request, '/api/actors', { id: 'rule-version-actor', moduleId: manifest.id, moduleVersion: manifest.version, ownerMemberId: enrolled.memberId, data: { publicValue: 1, secret: 2, notes: { hidden: 'safe' } } }, 'gm');
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const operation = { operationId: 'review-old-rules', campaignId: 'foundation-demo', memberId: enrolled.memberId, entityId: 'rule-version-actor', baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version, schemaVersion: 1, actionId: 'review', parameters: {}, dependencies: [] };
    const submission = await post(request, '/api/offline/operations', operation, enrolled.credential);
    assert.equal(submission.status, 202);
    const proposalId = (await submission.json()).proposalId;
    const proposal = await (await request(`/api/proposals/${proposalId}`, 'gm')).json();
    assert.equal(proposal.campaignId, 'foundation-demo');
    assert.equal(proposal.baseRevision, 1);
    assert.equal(proposal.ruleVersion, 1);
    assert.equal((await post(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest: { ...manifest, rulesVersion: 2 } }, 'gm')).status, 201);
    const decision = await post(request, `/api/proposals/${proposalId}/decisions`, { decisionId: 'old-rules-decision', decision: 'accept' }, 'gm');
    assert.equal(decision.status, 200);
    const receipt = await decision.json();
    assert.equal(receipt.status, 'conflicted');
    assert.equal(receipt.reasonCode, 'rules_version_conflict');
    assert.equal((await (await request('/api/actors/rule-version-actor', enrolled.credential)).json()).revision, 1);
  });
});

async function addActors(request, host) {
  assert.equal((await post(request, '/api/modules', { id: moduleDefinition.id, version: moduleDefinition.version, manifest: moduleDefinition }, 'gm')).status, 201);
  const add = (id, ownerRole, value) => host.db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,legacy_shared) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, moduleDefinition.id, moduleDefinition.version, 1, JSON.stringify(value), JSON.stringify({ gmOnly: ['secret', 'notes.hidden'] }), ownerRole, ownerRole === 'player' ? 1 : 0);
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

test('member credential and owned actor access survive restart, while member revocation invalidates credentials', async () => {
  await fixture(async ({ request, restart }) => {
    const enrollment = await post(request, '/api/members/enroll', { displayName: 'Persistent member' }, 'gm');
    assert.equal(enrollment.status, 201);
    const member = await enrollment.json();
    assert.equal((await post(request, '/api/modules', { id: moduleDefinition.id, version: moduleDefinition.version, manifest: moduleDefinition }, 'gm')).status, 201);
    assert.equal((await post(request, '/api/actors', {
      id: 'persistent-private-actor', moduleId: moduleDefinition.id, moduleVersion: moduleDefinition.version,
      ownerMemberId: member.memberId, data: { publicValue: 13, secret: 99, notes: { hidden: 'private' } }
    }, 'gm')).status, 201);
    const privateStateBefore = await (await request('/api/state', member.credential)).json();
    assert.equal(privateStateBefore.memberId, member.memberId);
    assert.equal(privateStateBefore.actors.some(actor => actor.id === 'persistent-private-actor'), true);
    const cursor = privateStateBefore.revision;
    await restart();
    const privateStateAfter = await (await request(`/api/state?since=${cursor}`, member.credential)).json();
    assert.equal(privateStateAfter.memberId, member.memberId);
    assert.equal(privateStateAfter.actors.some(actor => actor.id === 'persistent-private-actor'), true);
    assert.equal((await request('/api/actors/persistent-private-actor')).status, 404);
    const rotatedResponse = await post(request, `/api/members/${member.memberId}/rotate`, {}, 'gm');
    assert.equal(rotatedResponse.status, 200);
    const rotated = await rotatedResponse.json();
    assert.equal(rotated.memberId, member.memberId);
    assert.notEqual(rotated.credential, member.credential);
    assert.equal((await request('/api/state', member.credential)).status, 401);
    assert.equal((await request('/api/state', rotated.credential)).status, 200);
    await restart();
    assert.equal((await request('/api/state', rotated.credential)).status, 200);
    const revoked = await request(`/api/members/${member.memberId}`, 'gm', { method: 'DELETE' });
    assert.equal(revoked.status, 200);
    assert.equal((await request('/api/state', member.credential)).status, 401);
    assert.equal((await request('/api/actors/persistent-private-actor', rotated.credential)).status, 401);
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

test('member revocation ends an existing stream and blocks subsequent recovery requests', async () => {
  await fixture(async ({ request }) => {
    const enrolled = await post(request, '/api/members/enroll', { displayName: 'Reconnect member' }, 'gm');
    const member = await enrolled.json();
    const controller = new AbortController();
    const stream = await request('/api/stream?since=0', member.credential, { signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const initial = await reader.read();
    assert.equal(initial.done, false, 'authorized stream is established before revocation');

    const revoked = await request(`/api/members/${member.memberId}`, 'gm', { method: 'DELETE' });
    assert.equal(revoked.status, 200);
    const ended = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('revoked stream remained open')), 1000)),
    ]);
    assert.equal(ended.done, true);
    assert.equal((await request('/api/state', member.credential)).status, 401);
    assert.equal((await request('/api/stream?since=0', member.credential)).status, 401);
    controller.abort();
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
