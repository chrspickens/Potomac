import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function withHost(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-host-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath, seedDemo: true });
  let address = await host.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'gm', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${role === 'gm' || role === 'player' ? `local-${role}` : role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  try {
    await run({ get host() { return host; }, request, restart: async () => {
      host.close();
      host = createHost({ databasePath, seedDemo: true });
      address = await host.listen(0);
      baseUrl = `http://127.0.0.1:${address.port}`;
    } });
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
}

const postJson = async (request, path, body, role = 'gm') => {
  if (path === '/api/actors' && role === 'gm') {
    const campaign = await (await request('/api/campaign')).json();
    if (!campaign.systemModuleId) await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify({ name: 'Test campaign', systemModuleId: body.moduleId, systemModuleVersion: body.moduleVersion, baseRevision: campaign.revision }) });
  }
  return request(path, role, { method: 'POST', body: JSON.stringify(body) });
};

async function prepareSessionEncounter(request, { encounterId = 'session-encounter', actorId = 'session-participant', moduleId = 'session.test', moduleVersion = '1', status = 'prepared', participantStatus = 'active', archived = false } = {}) {
  const manifest = { id: moduleId, version: moduleVersion, schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] };
  await postJson(request, '/api/modules', { id: moduleId, version: moduleVersion, manifest });
  assert.equal((await postJson(request, '/api/actors', { id: actorId, moduleId, moduleVersion, data: {} })).status, 201);
  const created = await postJson(request, '/api/encounters', { id: encounterId, name: 'Session encounter', status });
  assert.equal(created.status, 201);
  const participants = await request(`/api/encounters/${encounterId}/participants`, 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, participants: [{ actorId, status: participantStatus }] }) });
  assert.equal(participants.status, 200);
  if (archived) assert.equal((await request(`/api/actors/${actorId}/archive`, 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, archived: true }) })).status, 200);
  return { encounterId, encounterRevision: 2, actorId, moduleId, moduleVersion };
}

test('entity kinds filter encounter searches to creatures and host rejects items as participants', async () => {
  await withHost(async ({ request }) => {
    const create = async (id, kind, name) => {
      const response = await postJson(request, '/api/entities', { operationId: `create-${id}`, name, kind });
      assert.equal(response.status, 201);
      return (await response.json()).entity;
    };
    const creature = await create('creature', 'creature', 'Marsh Hound');
    const item = await create('item', 'item', 'Silver Key');
    assert.equal(creature.kind, 'creature');
    assert.equal(item.kind, 'item');
    const creatures = await (await request('/api/entities?kind=creature')).json();
    assert.deepEqual(creatures.entities.map(entity => entity.id), [creature.id]);
    const items = await (await request('/api/entities?kind=item')).json();
    assert.deepEqual(items.entities.map(entity => entity.id), [item.id]);

    assert.equal((await postJson(request, '/api/encounters', { id: 'typed-encounter', name: 'Typed encounter' })).status, 201);
    const rejectItem = await request('/api/encounters/typed-encounter/entities', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, entities: [{ entityId: item.id, quantity: 1, positions: [{ x: 0.5, y: 0.5 }] }] }) });
    assert.equal(rejectItem.status, 400);
    const addCreature = await request('/api/encounters/typed-encounter/entities', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, entities: [{ entityId: creature.id, quantity: 1, positions: [{ x: 0.5, y: 0.5 }] }] }) });
    assert.equal(addCreature.status, 200);
  });
});

test('durable session commands enforce GM transitions, revisions, and operation receipt identity', async () => {
  await withHost(async fixture => {
    const { request, restart } = fixture;
    const target = await prepareSessionEncounter(request);
    const initial = await (await request('/api/session')).json();
    assert.deepEqual(initial, { revision: 0, current: null, history: [] });
    const denied = await postJson(request, '/api/session/commands', { operationId: 'session-start', command: 'start', sessionId: 'session-one', baseRevision: 0 }, 'player');
    assert.equal(denied.status, 403);
    assert.equal((await (await request('/api/session')).json()).revision, 0);
    for (const input of [
      { operationId: '', command: 'start', sessionId: 'x', baseRevision: 0 },
      { operationId: 'bad-command', command: 'delete', sessionId: 'x', baseRevision: 0 },
      { operationId: 'bad-revision', command: 'start', sessionId: 'x', baseRevision: -1 },
      { operationId: 'extra-field', command: 'start', sessionId: 'x', baseRevision: 0, actorId: 'spoof' }
    ]) assert.equal((await postJson(request, '/api/session/commands', input)).status, 400);

    const send = (operationId, command, sessionId, baseRevision, encounterTarget = target) => postJson(request, '/api/session/commands', { operationId, command, sessionId, baseRevision, ...(command === 'start' ? { encounterId: encounterTarget.encounterId, encounterRevision: encounterTarget.encounterRevision } : {}) });
    const started = await (await send('session-start', 'start', 'session-one', 0)).json();
    assert.equal(started.current.status, 'active');
    assert.equal(started.current.encounterId, target.encounterId);
    assert.equal(started.revision, 1);
    const duplicate = await send('session-start', 'start', 'session-one', 0);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), started);
    assert.equal((await send('session-start', 'start', 'session-other', 0)).status, 409);
    assert.equal((await send('session-stale', 'pause', 'session-one', 0)).status, 409);
    assert.equal((await send('session-invalid', 'resume', 'session-one', 1)).status, 409);
    const paused = await (await send('session-pause', 'pause', 'session-one', 1)).json();
    assert.equal(paused.current.status, 'paused');
    await restart();
    const resumed = await (await send('session-resume', 'resume', 'session-one', 2)).json();
    assert.equal(resumed.current.status, 'active');
    const finished = await (await send('session-finish', 'finish', 'session-one', 3)).json();
    assert.equal(finished.current.status, 'finished');
    assert.ok(finished.current.finishedAt);
    const restarted = await (await send('session-start-two', 'start', 'session-two', 4)).json();
    assert.equal(restarted.current.id, 'session-two');
    assert.deepEqual(restarted.history.map(session => session.id), ['session-one', 'session-two']);
    const state = await (await request('/api/state', 'player')).json();
    assert.deepEqual({ revision: state.session.revision, current: state.session.current, history: state.session.history }, { revision: restarted.revision, current: restarted.current, history: restarted.history });
    assert.equal(state.events.filter(event => event.kind.startsWith('session.')).length, 5);
  });
});

test('GM-only member roster marks enrolled players present for characters in the live encounter', async () => {
  await withHost(async ({ request }) => {
    const target = await prepareSessionEncounter(request, { encounterId: 'member-roster-encounter', actorId: 'member-roster-actor' });
    const alice = await (await postJson(request, '/api/members/enroll', { displayName: 'Roster Alice' })).json();
    const bob = await (await postJson(request, '/api/members/enroll', { displayName: 'Roster Bob' })).json();
    assert.equal((await postJson(request, '/api/actors/member-roster-actor/grants', { memberId: alice.memberId, permissions: ['read'] })).status, 201);
    const enrolled = await (await request('/api/members')).json();
    assert.deepEqual(Object.fromEntries(enrolled.members.map(({ memberId, present }) => [memberId, present])), { [alice.memberId]: false, [bob.memberId]: false });
    assert.deepEqual(enrolled.members.map(({ displayName }) => displayName).sort(), ['Roster Alice', 'Roster Bob']);
    assert.equal(enrolled.members.some(member => 'credential' in member || 'credentialHash' in member), false);
    assert.equal((await request('/api/members', 'player')).status, 403);

    const started = await postJson(request, '/api/session/commands', {
      operationId: 'member-roster-start', command: 'start', sessionId: 'member-roster-session', baseRevision: 0,
      encounterId: target.encounterId, encounterRevision: target.encounterRevision
    });
    assert.equal(started.status, 200);
    const liveMembers = await (await request('/api/members')).json();
    assert.deepEqual(Object.fromEntries(liveMembers.members.map(({ memberId, present }) => [memberId, present])), { [alice.memberId]: true, [bob.memberId]: false });

    assert.equal((await postJson(request, '/api/session/commands', {
      operationId: 'member-roster-pause', command: 'pause', sessionId: 'member-roster-session', baseRevision: 1
    })).status, 200);
    assert.equal((await (await request('/api/members')).json()).members.find(member => member.memberId === alice.memberId).present, true);
    assert.equal((await postJson(request, '/api/session/commands', {
      operationId: 'member-roster-finish', command: 'finish', sessionId: 'member-roster-session', baseRevision: 2
    })).status, 200);
    assert.equal((await (await request('/api/members')).json()).members.find(member => member.memberId === alice.memberId).present, false);
  });
});

test('Lore search is bounded, read-only and filters unpublished entries before returning them', async () => {
  await withHost(async ({ host, request }) => {
    const now = new Date().toISOString();
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,summary,body,gm_notes,tags,published,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('public-lore','foundation-demo','Silver Harbor','A coastal city','Ships gather here','Secret note','[]',1,'shared',now,now);
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,summary,body,gm_notes,tags,published,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('draft-lore','foundation-demo','Hidden Vault','Under the city','Secret passage','Hidden secret','[]',0,'gm',now,now);
    const before = host.db.prepare('SELECT COUNT(*) AS n FROM lore_entries').get().n;
    const player = await (await request('/api/lore?q=Silver', 'player')).json();
    assert.deepEqual(player.articles.map(article => article.id), ['public-lore']);
    assert.equal(JSON.stringify(player).includes('Secret note'), false);
    assert.equal((await request('/api/lore/draft-lore', 'player')).status, 404);
    const gm = await (await request('/api/lore/draft-lore')).json();
    assert.equal(gm.article.id, 'draft-lore');
    assert.equal((await request('/api/lore?limit=100000')).status, 200);
    assert.equal((await request(`/api/lore?q=${'x'.repeat(201)}`)).status, 400);
    assert.equal((await request('/api/lore?limit=0')).status, 400);
    assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM lore_entries').get().n, before);
  });
});

test('campaign search returns bounded role-authorized stable-ID projections without changing session state', async () => {
  await withHost(async ({ host, request }) => {
    const alice = await (await postJson(request, '/api/members/enroll', { displayName: 'Search Alice' })).json();
    const bob = await (await postJson(request, '/api/members/enroll', { displayName: 'Search Bob' })).json();
    const moduleId = 'search.fixture', moduleVersion = '1';
    await postJson(request, '/api/modules', { id: moduleId, version: moduleVersion, manifest: { id: moduleId, version: moduleVersion, schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] } });
    const campaign = await (await request('/api/campaign')).json();
    if (!campaign.systemModuleId) await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify({ name: 'Search campaign', systemModuleId: moduleId, systemModuleVersion: moduleVersion, baseRevision: campaign.revision }) });
    for (const [id, name, owner] of [['alice-actor', 'Authorized Ranger', alice.memberId], ['bob-actor', 'Hidden Ranger', bob.memberId]]) {
      await postJson(request, '/api/actors', { id, moduleId, moduleVersion, data: { name }, visibility: {}, ownerRole: 'player', ownerMemberId: owner });
    }
    await postJson(request, '/api/actors', { id: 'redacted-name-actor', moduleId, moduleVersion, data: { name: 'CLASSIFIED Ranger Name' }, visibility: { gmOnly: ['name'] }, ownerRole: 'gm' });
    await request('/api/actors/alice-actor/grants', 'gm', { method: 'POST', body: JSON.stringify({ memberId: alice.memberId, permissions: ['read', 'act'] }) });
    await request('/api/actors/redacted-name-actor/grants', 'gm', { method: 'POST', body: JSON.stringify({ memberId: alice.memberId, permissions: ['read'] }) });
    const now = new Date().toISOString();
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,type,title,summary,body,gm_notes,tags,published,visibility,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('shared-lore','foundation-demo','note','Shared Ranger Notes','','','', '[]',1,'shared',0,now,now);
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,type,title,summary,body,gm_notes,tags,published,visibility,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('secret-lore','foundation-demo','note','CLASSIFIED RANGER PLAN','','','SECRET-CAMPAIGN-MARKER','[]',0,'gm',0,now,now);
    host.db.prepare('INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,gm_notes,created_at,updated_at) VALUES(?,?,?,?,1,100,100,?,?,?, ?,?)')
      .run('shared-map','foundation-demo','Ranger Coast','world','{}','shared','',now,now);
    host.db.prepare('INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,gm_notes,created_at,updated_at) VALUES(?,?,?,?,1,100,100,?,?,?, ?,?)')
      .run('secret-map','foundation-demo','CLASSIFIED RANGER ROOM','battle','{}','gm','SECRET-CAMPAIGN-MARKER',now,now);
    host.db.prepare("INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES('shared-encounter','Ranger Crossing','Shared passage','prepared',1,?,?, 'public','')").run(now,now);
    host.db.prepare("INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES('secret-encounter','CLASSIFIED RANGER ENCOUNTER','Secret passage','prepared',1,?,?, 'gm','SECRET-CAMPAIGN-MARKER')").run(now,now);
    const before = await (await request('/api/state', 'gm')).json();
    const search = async (token, q, params = '') => request(`/api/search?q=${encodeURIComponent(q)}${params}`, token);
    const alicePage = await (await search(alice.credential, 'Ranger')).json();
    const bobPage = await (await search(bob.credential, 'Ranger')).json();
    const gmPage = await (await search('gm', 'Ranger')).json();
    assert.deepEqual(alicePage.results.map(row => `${row.kind}:${row.id}`).sort(), ['actor:alice-actor','encounter:shared-encounter','lore:shared-lore','map:shared-map']);
    assert.deepEqual(bobPage.results.map(row => `${row.kind}:${row.id}`).sort(), ['actor:bob-actor','encounter:shared-encounter','lore:shared-lore','map:shared-map']);
    assert.ok(gmPage.results.some(row => row.id === 'secret-lore') && gmPage.results.some(row => row.id === 'bob-actor'));
    for (const forbidden of ['secret-lore','CLASSIFIED','SECRET-CAMPAIGN-MARKER','secret-map','secret-encounter','bob-actor','redacted-name-actor']) assert.equal(JSON.stringify(alicePage).includes(forbidden), false, `search leaked ${forbidden}`);
    assert.equal(await (await search(alice.credential, 'CLASSIFIED')).json().then(body => body.results.length), 0);
    const aliceState = await (await request('/api/state', alice.credential)).json();
    assert.equal(JSON.stringify(aliceState.actors.find(actor => actor.id === 'redacted-name-actor')).includes('CLASSIFIED'), false, 'authorized actor projection removes a GM-only name');
    const resolve = (token, target) => request(`/api/navigation/${target.kind}/${target.id}`, token);
    assert.equal((await resolve(alice.credential, { kind: 'actor', id: 'bob-actor' })).status, 404);
    assert.equal((await resolve(alice.credential, { kind: 'actor', id: 'redacted-name-actor' })).status, 404, 'target without an authorized label is unavailable');
    assert.equal((await resolve(alice.credential, { kind: 'lore', id: 'secret-lore' })).status, 404);
    assert.equal((await resolve(alice.credential, { kind: 'map', id: 'secret-map' })).status, 404);
    assert.equal((await resolve(alice.credential, { kind: 'encounter', id: 'secret-encounter' })).status, 404);
    assert.equal((await resolve(alice.credential, { kind: 'actor', id: 'missing-id' })).status, 404);
    assert.deepEqual(await (await resolve(alice.credential, { kind: 'actor', id: 'alice-actor' })).json().then(body => body.target), { kind: 'actor', id: 'alice-actor', label: 'Authorized Ranger' });
    const pageOne = await (await search('gm', 'Ranger', '&limit=1')).json();
    assert.equal(pageOne.results.length, 1);
    assert.ok(pageOne.next);
    const pageTwo = await (await search('gm', 'Ranger', `&limit=1&after=${encodeURIComponent(pageOne.next)}`)).json();
    assert.equal(pageTwo.results.length, 1);
    for (const [id, name] of [['case-a','Ranger lower'],['case-b','Ranger middle'],['case-Z','Ranger upper']])
      host.db.prepare("INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES(?,?, '', 'prepared',1,?,?, 'public','')").run(id,name,now,now);
    const keys = [];
    let pageCursor = null;
    do {
      const page = await (await search('gm', 'Ranger', `&limit=1${pageCursor ? `&after=${encodeURIComponent(pageCursor)}` : ''}`)).json();
      keys.push(...page.results.map(row => `${row.kind}:${row.id}`)); pageCursor = page.next;
    } while (pageCursor);
    assert.deepEqual(keys, [...keys].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), 'cursor ordering uses the same codepoint comparator as result sorting');
    assert.ok(keys.includes('encounter:case-Z') && keys.includes('encounter:case-a') && keys.includes('encounter:case-b'), 'mixed-case IDs are not skipped between pages');
    assert.equal((await search('gm', 'Ranger', '&limit=0')).status, 400);
    assert.equal((await search('gm', 'x'.repeat(201))).status, 400);
    assert.equal((await request('/api/search?q=Ranger', 'unknown-token')).status, 401);
    const after = await (await request('/api/state', 'gm')).json();
    assert.equal(JSON.stringify(after.events).includes('SECRET-CAMPAIGN-MARKER'), false);
    assert.deepEqual(after.context, before.context, 'search navigation query does not mutate shared context');
    assert.deepEqual(after.events, before.events, 'search is read only and adds no replay events');
  });
});

test('session start rejects stale or ineligible encounter targets without events and accepts only eligible participants', async () => {
  await withHost(async ({ request }) => {
    const target = await prepareSessionEncounter(request);
    const sessionBefore = await (await request('/api/session')).json();
    const sessionEventsBefore = (await (await request('/api/state')).json()).events.filter(event => event.kind.startsWith('session.')).length;
    const send = (operationId, overrides = {}) => postJson(request, '/api/session/commands', {
      operationId, command: 'start', sessionId: `session-${operationId}`, baseRevision: sessionBefore.revision,
      encounterId: target.encounterId, encounterRevision: target.encounterRevision, ...overrides
    });
    assert.equal((await send('missing', { encounterId: 'missing-encounter' })).status, 409);
    assert.equal((await send('stale', { encounterRevision: 1 })).status, 409);
    assert.equal((await send('invalid-revision', { encounterRevision: 0 })).status, 400);
    assert.equal((await send('wrong-status', { encounterId: (await prepareSessionEncounter(request, { encounterId: 'active-encounter', actorId: 'active-actor', status: 'active' })).encounterId, encounterRevision: 2 })).status, 409);
    const noEligible = await prepareSessionEncounter(request, { encounterId: 'no-eligible', actorId: 'removed-actor', participantStatus: 'removed' });
    assert.equal((await send('removed-participant', { encounterId: noEligible.encounterId, encounterRevision: noEligible.encounterRevision })).status, 409);
    const archived = await prepareSessionEncounter(request, { encounterId: 'archived-participant', actorId: 'archived-actor', archived: true });
    assert.equal((await send('archived-participant', { encounterId: archived.encounterId, encounterRevision: archived.encounterRevision })).status, 409);
    const afterFailures = await (await request('/api/session')).json();
    assert.deepEqual(afterFailures, sessionBefore);
    assert.equal((await (await request('/api/state')).json()).events.filter(event => event.kind.startsWith('session.')).length, sessionEventsBefore);

    const accepted = await send('eligible-start');
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).current.encounterId, target.encounterId);
    const eventCount = (await (await request('/api/state')).json()).events.length;
    const duplicate = await send('eligible-start');
    assert.equal(duplicate.status, 200);
    assert.equal((await (await request('/api/state')).json()).events.length, eventCount);
    assert.equal((await send('changed-target', { encounterId: archived.encounterId, encounterRevision: archived.encounterRevision })).status, 409);
  });
});

test('session actions use declared actions, expose authorized verified timeline events, and reject inactive or reused operations', async () => {
  await withHost(async ({ request, restart }) => {
    const enrolled = await (await postJson(request, '/api/members/enroll', { displayName: 'Session player' })).json();
    const manifest = {
      id: 'session.actions', version: '1', rulesVersion: 3,
      schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [
        { id: 'wait', policy: 'selfService', input: { type: 'object', properties: { privateInput: { type: 'string' } }, additionalProperties: false }, effects: [] },
        { id: 'secret-check', policy: 'selfService', input: { type: 'object', properties: { difficulty: { type: 'integer' } }, required: ['difficulty'], additionalProperties: false }, effects: [], resolution: { dice: [{ count: 1, sides: 20 }], modifier: { ref: 'secretModifier' }, targetInput: 'difficulty', comparison: 'gte' } },
        { id: 'two-pool-check', policy: 'selfService', input: { type: 'object', properties: { difficulty: { type: 'integer' } }, required: ['difficulty'], additionalProperties: false }, effects: [], resolution: { dice: [{ count: 2, sides: 6, role: 'hope' }, { count: 2, sides: 6, role: 'stress' }], compareTotals: true, modifier: { ref: 'traits.instinct' }, targetInput: 'difficulty', comparison: 'gte' } }
      ]
    };
    await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest });
    await postJson(request, '/api/actors', { id: 'session-actor', moduleId: manifest.id, moduleVersion: manifest.version, ownerMemberId: enrolled.memberId, data: { secretModifier: 19, traits: { instinct: 1 } }, visibility: { gmOnly: ['secretModifier'] } });
    const createdEncounter = await postJson(request, '/api/encounters', { id: 'action-encounter', name: 'Action encounter' });
    assert.equal(createdEncounter.status, 201);
    const participants = await request('/api/encounters/action-encounter/participants', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, participants: [{ actorId: 'session-actor' }] }) });
    assert.equal(participants.status, 200);
    const start = await postJson(request, '/api/session/commands', { operationId: 'session-start-for-action', command: 'start', sessionId: 'action-session', baseRevision: 0, encounterId: 'action-encounter', encounterRevision: 2 });
    assert.equal(start.status, 200);
    const command = {
      operationId: 'session-action-one', sessionId: 'action-session', campaignId: 'foundation-demo', memberId: enrolled.memberId,
      entityId: 'session-actor', baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version,
      schemaVersion: 1, actionId: 'wait', parameters: { privateInput: 'must not appear' }, dependencies: []
    };
    const applied = await postJson(request, '/api/session/actions', command, enrolled.credential);
    assert.equal(applied.status, 200);
    const actionReceipt = await applied.json();
    assert.deepEqual(
      Object.fromEntries(['operationId', 'entityId', 'status', 'revision', 'actionId', 'moduleId', 'moduleVersion', 'schemaVersion', 'ruleVersion', 'sessionId'].map(key => [key, actionReceipt[key]])),
      { operationId: 'session-action-one', entityId: 'session-actor', status: 'applied', revision: 2, actionId: 'wait', moduleId: manifest.id, moduleVersion: manifest.version, schemaVersion: 1, ruleVersion: 3, sessionId: 'action-session' }
    );
    assert.ok(actionReceipt.eventCursor > 0);
    const timeline = await (await request('/api/session/action-session/timeline', enrolled.credential)).json();
    assert.equal(timeline.sessionId, 'action-session');
    assert.equal(timeline.events.length, 2);
    const actionEvent = timeline.events.find(event => event.kind === 'action.applied');
    assert.equal(actionEvent.payload.sessionId, 'action-session');
    assert.equal(actionEvent.payload.entityId, 'session-actor');
    assert.equal(actionEvent.payload.actionId, 'wait');
    assert.equal(actionEvent.payload.moduleId, manifest.id);
    assert.equal(actionEvent.payload.moduleVersion, manifest.version);
    assert.equal(actionEvent.payload.ruleVersion, 3);
    assert.equal(Object.hasOwn(actionEvent.payload, 'verified'), false, 'non-roll actions are not mislabeled as verified dice');
    assert.equal(Object.hasOwn(actionEvent.payload, 'parameters'), false);

    const gmTimeline = await (await request('/api/session/action-session/timeline')).json();
    assert.deepEqual(gmTimeline.events.find(event => event.kind === 'action.applied').payload.parameters, { privateInput: 'must not appear' });
    const invalidParameters = await postJson(request, '/api/session/actions', { ...command, operationId: 'session-roll-invalid', baseRevision: 2, actionId: 'secret-check', parameters: {} }, enrolled.credential);
    assert.equal(invalidParameters.status, 400);
    assert.equal((await (await request('/api/actors/session-actor', enrolled.credential)).json()).revision, 2);
    const rollCommand = { ...command, operationId: 'session-roll-once', baseRevision: 2, actionId: 'secret-check', parameters: { difficulty: 15 } };
    const rollResponse = await postJson(request, '/api/session/actions', rollCommand, enrolled.credential);
    assert.equal(rollResponse.status, 200);
    const receipt = await rollResponse.json();
    assert.equal(receipt.verified, true);
    assert.equal(receipt.moduleId, manifest.id);
    assert.equal(receipt.moduleVersion, manifest.version);
    assert.equal(receipt.ruleVersion, 3);
    assert.equal(receipt.eventCursor > 0, true);
    assert.equal(receipt.rolls.length, 1);
    assert.ok(receipt.rolls[0] >= 1 && receipt.rolls[0] <= 20);
    assert.equal(receipt.resolution.groups[0].dice[0], receipt.rolls[0]);
    assert.equal(Object.hasOwn(receipt.resolution, 'modifier'), false);
    assert.equal(JSON.stringify(receipt).includes('secretModifier'), false);
    assert.equal(Object.hasOwn(receipt.resolution, 'modifier'), false);
    assert.equal(Object.hasOwn(receipt.resolution, 'total'), false);
    assert.equal(JSON.stringify(receipt).includes('secretModifier'), false);
    assert.equal(Object.hasOwn(receipt.resolution, 'modifier'), false);
    assert.equal(Object.hasOwn(receipt.resolution, 'total'), false);
    assert.equal(JSON.stringify(receipt).includes('secretModifier'), false);
    const redactedTimelineResponse = await request('/api/session/action-session/timeline?limit=2', enrolled.credential);
    const redactedPage = await redactedTimelineResponse.json();
    assert.equal(redactedPage.events.length, 2);
    assert.equal(redactedPage.hasMore, true);
    assert.ok(redactedPage.highWaterCursor >= redactedPage.nextCursor);
    const nextPage = await (await request(`/api/session/action-session/timeline?after=${redactedPage.nextCursor}&limit=2`, enrolled.credential)).json();
    const playerRollEvent = nextPage.events.find(event => event.payload.operationId === rollCommand.operationId);
    assert.ok(playerRollEvent);
    assert.equal(playerRollEvent.payload.resolution.verified, true);
    assert.deepEqual(playerRollEvent.payload.resolution.groups[0].dice, receipt.rolls);
    assert.equal(Object.hasOwn(playerRollEvent.payload.resolution, 'modifier'), false);
    assert.equal(Object.hasOwn(playerRollEvent.payload.resolution, 'total'), false);
    assert.equal(JSON.stringify(playerRollEvent).includes('secretModifier'), false);
    const playerState = await (await request('/api/state', enrolled.credential)).json();
    const stateRollEvent = playerState.events.find(event => event.payload.operationId === rollCommand.operationId);
    assert.deepEqual(stateRollEvent.payload.resolution.groups[0].dice, receipt.rolls);
    assert.equal(Object.hasOwn(stateRollEvent.payload.resolution, 'modifier'), false);
    const streamController = new AbortController();
    const stream = await request('/api/stream?since=0', enrolled.credential, { signal: streamController.signal });
    const streamReader = stream.body.getReader();
    const streamDecoder = new TextDecoder();
    let replay = '';
    while (!replay.includes(rollCommand.operationId)) {
      const { done, value } = await streamReader.read();
      if (done) break;
      replay += streamDecoder.decode(value, { stream: true });
    }
    streamController.abort();
    const rollStreamData = replay.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
      .find(event => event.payload?.operationId === rollCommand.operationId);
    assert.ok(rollStreamData);
    assert.deepEqual(rollStreamData.payload.resolution.groups[0].dice, receipt.rolls);
    assert.equal(Object.hasOwn(rollStreamData.payload.resolution, 'modifier'), false);
    assert.equal(JSON.stringify(rollStreamData).includes('secretModifier'), false);
    const gmRollEvent = (await (await request('/api/session/action-session/timeline')).json()).events.find(event => event.payload.operationId === rollCommand.operationId);
    assert.equal(gmRollEvent.payload.resolution.modifier, 19);
    const twoPoolCommand = { ...command, operationId: 'session-two-pool-roll', baseRevision: 3, actionId: 'two-pool-check', parameters: { difficulty: 4 } };
    const twoPoolResponse = await postJson(request, '/api/session/actions', twoPoolCommand, enrolled.credential);
    assert.equal(twoPoolResponse.status, 200);
    const twoPoolReceipt = await twoPoolResponse.json();
    assert.equal(twoPoolReceipt.verified, true);
    assert.equal(twoPoolReceipt.resolution.groups[0].role, 'hope');
    assert.equal(twoPoolReceipt.resolution.groups[0].dice.length, 2);
    assert.equal(twoPoolReceipt.resolution.groups[1].role, 'stress');
    assert.equal(twoPoolReceipt.resolution.groups[1].dice.length, 2);
    const eventCountBeforeRetry = (await (await request('/api/session/action-session/timeline')).json()).events.length;
    await restart();
    const retried = await postJson(request, '/api/session/actions', rollCommand, enrolled.credential);
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), receipt);
    assert.equal((await (await request('/api/session/action-session/timeline')).json()).events.length, eventCountBeforeRetry);
    assert.equal((await (await request('/api/actors/session-actor', enrolled.credential)).json()).revision, 4);
    assert.equal((await request('/api/session/action-session/timeline?after=-1')).status, 400);
    const collision = await postJson(request, '/api/session/actions', { ...command, sessionId: 'different-session' }, enrolled.credential);
    assert.equal(collision.status, 409);
    assert.equal((await collision.json()).reasonCode, 'operation_id_collision');
    await postJson(request, '/api/session/commands', { operationId: 'session-pause-for-action', command: 'pause', sessionId: 'action-session', baseRevision: 1 });
    assert.equal((await postJson(request, '/api/session/actions', { ...command, operationId: 'session-action-paused', baseRevision: 2 }, enrolled.credential)).status, 409);
    await postJson(request, '/api/session/commands', { operationId: 'session-resume-for-action', command: 'resume', sessionId: 'action-session', baseRevision: 2 });
    await postJson(request, '/api/session/commands', { operationId: 'session-finish-for-action', command: 'finish', sessionId: 'action-session', baseRevision: 3 });
    assert.equal((await postJson(request, '/api/session/actions', { ...command, operationId: 'session-action-ended', baseRevision: 2 }, enrolled.credential)).status, 409);
    const finalCount = (await (await request('/api/session/action-session/timeline')).json()).events.length;
    const endedRetry = await postJson(request, '/api/session/actions', rollCommand, enrolled.credential);
    assert.equal(endedRetry.status, 200);
    assert.deepEqual(await endedRetry.json(), receipt);
    assert.equal((await (await request('/api/session/action-session/timeline')).json()).events.length, finalCount);
    const finishedRetry = await postJson(request, '/api/session/actions', rollCommand, enrolled.credential);
    assert.equal(finishedRetry.status, 200, 'an authorized duplicate gets its original receipt after session end');
    assert.deepEqual(await finishedRetry.json(), receipt);
    const duplicateId = await postJson(request, '/api/session/actions', { ...command, operationId: 'session-start-for-action' }, enrolled.credential);
    assert.equal(duplicateId.status, 409);
    assert.equal((await request('/api/session/missing/timeline')).status, 404);
  });
});

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

test('fresh host has no demo content and actor creation requires the exact campaign pin', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-fresh-'));
  const fresh = createHost({ databasePath: join(directory, 'fresh.sqlite') });
  try {
    const address = await fresh.listen(0);
    const requestFresh = (path, options = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, { ...options, headers: { authorization: 'Bearer local-gm', ...(options.body ? { 'content-type': 'application/json' } : {}) } });
    assert.equal((await (await requestFresh('/api/encounters')).json()).encounters.length, 0);
    assert.deepEqual((await (await requestFresh('/api/state')).json()).modules.map(module => module.id).sort(), ['example.system-a', 'example.system-b']);
    const module = { id: 'fresh.system', version: '1', schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] };
    const create = (path, body) => requestFresh(path, { method: 'POST', body: JSON.stringify(body) });
    await create('/api/modules', { id: module.id, version: module.version, manifest: module });
    assert.equal((await create('/api/actors', { id: 'un-pinned', moduleId: module.id, moduleVersion: module.version, data: {} })).status, 409);
    await requestFresh('/api/campaign', { method: 'PUT', body: JSON.stringify({ name: 'Fresh', systemModuleId: module.id, systemModuleVersion: module.version, baseRevision: 1 }) });
    assert.equal((await create('/api/actors', { id: 'pinned', moduleId: module.id, moduleVersion: module.version, data: {} })).status, 201);
  } finally { fresh.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('campaign setup pins a registered module with GM-only revisioned updates that persist', async () => {
  await withHost(async ({ request, restart }) => {
    const initial = await (await request('/api/campaign')).json();
    assert.equal(initial.id, 'foundation-demo');
    assert.equal(initial.revision, 1);
    assert.equal((await request('/api/campaign', 'player', { method: 'PUT', body: JSON.stringify({ name: 'Test', baseRevision: 1 }) })).status, 403);
    const module = { id: 'campaign.system', version: '2', schema: { type: 'object' } };
    assert.equal((await postJson(request, '/api/modules', { id: module.id, version: module.version, manifest: module })).status, 201);
    const input = { name: '  New Campaign  ', systemModuleId: module.id, systemModuleVersion: module.version, baseRevision: 1 };
    const put = await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify(input) });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { id: 'foundation-demo', name: 'New Campaign', systemModuleId: module.id, systemModuleVersion: module.version, revision: 2 });
    const stale = await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify(input) });
    assert.equal(stale.status, 409);
    await restart();
    assert.equal((await (await request('/api/campaign')).json()).revision, 2);
  });
});

test('encounters, participant ordering, and activation persist with GM-only participant changes', async () => {
  await withHost(async ({ request, restart }) => {
    const manifest = { id: 'encounter.actor', version: '1', schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] };
    await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest });
    await postJson(request, '/api/actors', { id: 'encounter-actor-a', moduleId: manifest.id, moduleVersion: manifest.version, data: {} });
    await postJson(request, '/api/actors', { id: 'encounter-actor-b', moduleId: manifest.id, moduleVersion: manifest.version, data: {} });
    const created = await postJson(request, '/api/encounters', { id: 'persistent-encounter', name: 'Persistent', summary: 'Test' });
    assert.equal(created.status, 201);
    assert.equal((await request('/api/encounters/persistent-encounter', 'player', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, status: 'active' }) })).status, 403);
    const participantSet = { baseRevision: 1, participants: [
      { actorId: 'encounter-actor-b', initiative: 15, activationOrder: 0 },
      { actorId: 'encounter-actor-a', initiative: 10, activationOrder: 1 }
    ] };
    const updated = await request('/api/encounters/persistent-encounter/participants', 'gm', { method: 'PUT', body: JSON.stringify(participantSet) });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).participants.map(item => item.actorId), ['encounter-actor-b', 'encounter-actor-a']);
    const active = await request('/api/encounters/persistent-encounter', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 2, status: 'active' }) });
    assert.equal((await active.json()).status, 'active');
    const context = await postJson(request, '/api/context', { context: { activeEncounter: 'persistent-encounter' } });
    assert.equal(context.status, 200);
    await restart();
    const state = await (await request('/api/state')).json();
    assert.equal(state.context.activeEncounter, 'persistent-encounter');
    const persisted = await (await request('/api/encounters/persistent-encounter')).json();
    assert.equal(persisted.status, 'active');
    assert.deepEqual(persisted.participants.map(item => item.actorId), ['encounter-actor-b', 'encounter-actor-a']);
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

test('GM-only encounters redact list, lookup, context, and replay while actor archive removes participation', async () => {
  await withHost(async ({ request }) => {
    const manifest = { id: 'archive-test.system', version: '1', schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] };
    await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest });
    assert.equal((await postJson(request, '/api/actors', { id: 'archivable-actor', moduleId: manifest.id, moduleVersion: manifest.version, data: {} })).status, 201);
    const created = await postJson(request, '/api/encounters', { id: 'private-encounter', name: 'Hidden', gmNotes: 'secret prep', visibility: 'gm' });
    assert.equal(created.status, 201);
    assert.equal((await (await request('/api/encounters', 'player')).json()).encounters.some(e => e.id === 'private-encounter'), false);
    assert.equal((await request('/api/encounters/private-encounter', 'player')).status, 404);
    assert.equal((await request('/api/encounters/private-encounter', 'gm').then(r => r.json())).gmNotes, 'secret prep');
    await postJson(request, '/api/context', { context: { activeEncounter: 'private-encounter' } });
    const playerState = await (await request('/api/state', 'player')).json();
    assert.equal(playerState.context.activeEncounter, null);
    assert.equal(JSON.stringify(playerState).includes('private-encounter'), false);
    const archived = await request('/api/actors/archivable-actor/archive', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, archived: true }) });
    assert.equal(archived.status, 200, JSON.stringify(await archived.clone().json()));
    const participant = await request('/api/encounters/private-encounter/participants', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, participants: [{ actorId: 'archivable-actor' }] }) });
    assert.equal(participant.status, 404);
    assert.equal((await request('/api/actors/archivable-actor', 'gm')).status, 404);
    const completed = await request('/api/encounters/private-encounter', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: 1, status: 'completed' }) });
    assert.equal(completed.status, 200);
    assert.equal((await (await request('/api/state', 'gm')).json()).context.activeEncounter, null);
  });
});

test('encounter participants and actor fields are projected per GM and member across HTTP, state, and SSE; archived actors disappear', async () => {
  await withHost(async ({ host, request }) => {
    const enroll = async displayName => (await postJson(request, '/api/members/enroll', { displayName })).json();
    const alice = await enroll('Projection Alice');
    const bob = await enroll('Projection Bob');
    const module = {
      id: 'projection.system', version: '1',
      schema: { type: 'object', properties: {}, additionalProperties: true }, actions: []
    };
    await postJson(request, '/api/modules', { id: module.id, version: module.version, manifest: module });
    const createActor = (id, ownerRole, ownerMemberId, marker) => postJson(request, '/api/actors', {
      id, ownerRole, ownerMemberId, moduleId: module.id, moduleVersion: module.version,
      data: { publicName: `${id}-public`, notes: { secret: `${marker}-gm-only` } },
      visibility: { gmOnly: ['notes.secret'] }
    });
    assert.equal((await createActor('alice-actor', 'player', alice.memberId, 'alice')).status, 201);
    assert.equal((await createActor('bob-actor', 'player', bob.memberId, 'bob')).status, 201);
    assert.equal((await createActor('gm-actor', 'gm', null, 'hidden')).status, 201);
    const encounter = await postJson(request, '/api/encounters', { id: 'projection-encounter', name: 'Projection test' });
    assert.equal(encounter.status, 201);
    assert.equal((await request('/api/encounters/projection-encounter/participants', 'gm', {
      method: 'PUT', body: JSON.stringify({ baseRevision: 1, participants: [
        { actorId: 'alice-actor' }, { actorId: 'bob-actor' }, { actorId: 'gm-actor' }
      ] })
    })).status, 200);

    const gmRoster = await (await request('/api/encounters/projection-encounter')).json();
    const aliceRoster = await (await request('/api/encounters/projection-encounter', alice.credential)).json();
    const bobRoster = await (await request('/api/encounters/projection-encounter', bob.credential)).json();
    assert.deepEqual(gmRoster.participants.map(item => item.actorId), ['alice-actor', 'bob-actor', 'gm-actor']);
    assert.deepEqual(aliceRoster.participants.map(item => item.actorId), ['alice-actor']);
    assert.deepEqual(bobRoster.participants.map(item => item.actorId), ['bob-actor']);
    assert.equal(Object.hasOwn(gmRoster, 'gmNotes'), true);
    for (const roster of [aliceRoster, bobRoster]) {
      assert.equal(Object.hasOwn(roster, 'gmNotes'), false);
      assert.equal(JSON.stringify(roster).includes('gm-actor'), false);
    }

    const aliceState = await (await request('/api/state', alice.credential)).json();
    const bobState = await (await request('/api/state', bob.credential)).json();
    assert.deepEqual(aliceState.actors.map(actor => actor.id), ['alice-actor']);
    assert.deepEqual(bobState.actors.map(actor => actor.id), ['bob-actor']);
    assert.equal(aliceState.actors[0].data.notes.secret, undefined);
    assert.equal(bobState.actors[0].data.notes.secret, undefined);
    assert.equal((await (await request('/api/actors/alice-actor', alice.credential)).json()).data.notes.secret, undefined);
    assert.equal((await (await request('/api/actors/alice-actor')).json()).data.notes.secret, 'alice-gm-only');
    assert.equal((await request('/api/actors/bob-actor', alice.credential)).status, 404);
    for (const [state, hiddenId, hiddenField] of [
      [aliceState, 'bob-actor', 'bob-gm-only'], [aliceState, 'gm-actor', 'hidden-gm-only'],
      [bobState, 'alice-actor', 'alice-gm-only'], [bobState, 'gm-actor', 'hidden-gm-only']
    ]) {
      const serialized = JSON.stringify(state);
      assert.equal(serialized.includes(hiddenId), false);
      assert.equal(serialized.includes(hiddenField), false);
    }

    const readReplay = async (credential, expectedVisibleId, hiddenIds, hiddenMarkers) => {
      const controller = new AbortController();
      const response = await request('/api/stream?since=0', credential, { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!text.includes(expectedVisibleId)) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      controller.abort();
      assert.ok(text.includes(expectedVisibleId));
      for (const hidden of [...hiddenIds, ...hiddenMarkers]) assert.equal(text.includes(hidden), false, `SSE leaked ${hidden}`);
      return text;
    };
    await readReplay('local-gm', 'gm-actor', [], []);
    await readReplay(alice.credential, 'alice-actor', ['bob-actor', 'gm-actor'], ['alice-gm-only', 'bob-gm-only', 'hidden-gm-only']);
    await readReplay(bob.credential, 'bob-actor', ['alice-actor', 'gm-actor'], ['alice-gm-only', 'bob-gm-only', 'hidden-gm-only']);

    const archiveCursor = (await (await request('/api/state', alice.credential)).json()).revision;
    const archiveController = new AbortController();
    const archiveStream = await request(`/api/stream?since=${archiveCursor}`, alice.credential, { signal: archiveController.signal });
    assert.equal(archiveStream.status, 200);
    const archiveReader = archiveStream.body.getReader();
    const archiveDecoder = new TextDecoder();
    let archiveStreamText = '';
    const archivedEventRead = (async () => {
      while (!archiveStreamText.includes('context.changed')) {
        const { done, value } = await archiveReader.read();
        if (done) break;
        archiveStreamText += archiveDecoder.decode(value, { stream: true });
      }
    })();
    const archived = await request('/api/actors/alice-actor/archive', 'gm', {
      method: 'PUT', body: JSON.stringify({ baseRevision: 1, archived: true })
    });
    assert.equal(archived.status, 200);
    await postJson(request, '/api/context', { context: { activeEncounter: 'projection-encounter' } });
    await archivedEventRead;
    archiveController.abort();
    assert.equal(archiveStreamText.includes('actor.archived'), false);
    assert.equal(archiveStreamText.includes('alice-actor'), false);
    assert.equal((await request('/api/actors/alice-actor', alice.credential)).status, 404);
    const afterArchive = await (await request('/api/encounters/projection-encounter')).json();
    assert.deepEqual(afterArchive.participants.map(item => item.actorId), ['bob-actor', 'gm-actor']);
    const archivedState = await (await request('/api/state', alice.credential)).json();
    assert.equal(archivedState.actors.some(actor => actor.id === 'alice-actor'), false);
    assert.equal(archivedState.events.some(event => event.actorId === 'alice-actor'), false);
    host.db.prepare('INSERT INTO encounter_participants(encounter_id,actor_id,status) VALUES(?,?,?)')
      .run('projection-encounter', 'alice-actor', 'active');
    const staleRoster = await (await request('/api/encounters/projection-encounter')).json();
    assert.equal(staleRoster.participants.some(item => item.actorId === 'alice-actor'), false);
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
    const actionReceipt = await applied.json();
    assert.deepEqual(
      Object.fromEntries(['operationId', 'entityId', 'status', 'revision', 'actionId', 'moduleId', 'moduleVersion', 'schemaVersion'].map(key => [key, actionReceipt[key]])),
      { operationId: 'alice-wait', entityId: 'alice-actor', status: 'applied', revision: 2, actionId: 'wait', moduleId: manifest.id, moduleVersion: manifest.version, schemaVersion: 1 }
    );
    assert.ok(actionReceipt.eventCursor > 0);
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

test('offline rolls keep the same verified dice in durable receipts and role-filtered history', async () => {
  await withHost(async ({ request, restart }) => {
    const member = await (await postJson(request, '/api/members/enroll', { displayName: 'Roller' })).json();
    const manifest = {
      id: 'verified.rolls', version: '1',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      actions: [{
        id: 'check', policy: 'selfService', effects: [],
        input: { type: 'object', properties: { difficulty: { type: 'integer' } }, required: ['difficulty'], additionalProperties: false },
        resolution: { dice: [{ count: 1, sides: 20 }], targetInput: 'difficulty', comparison: 'gte' }
      }]
    };
    assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
    assert.equal((await postJson(request, '/api/actors', {
      id: 'roll-actor', moduleId: manifest.id, moduleVersion: manifest.version,
      ownerMemberId: member.memberId, data: {}
    })).status, 201);
    const operation = {
      operationId: 'verified-roll-1', campaignId: 'foundation-demo', memberId: member.memberId,
      entityId: 'roll-actor', baseRevision: 1, moduleId: manifest.id, moduleVersion: manifest.version,
      schemaVersion: 1, actionId: 'check', parameters: { difficulty: 10 }, dependencies: []
    };
    const first = await postJson(request, '/api/offline/operations', operation, member.credential);
    assert.equal(first.status, 200);
    const receipt = await first.json();
    assert.equal(receipt.status, 'applied');
    assert.equal(receipt.verified, true);
    assert.equal(receipt.rolls.length, 1);
    assert.ok(receipt.rolls[0] >= 1 && receipt.rolls[0] <= 20);
    assert.equal(receipt.resolution.groups[0].dice[0], receipt.rolls[0]);
    const playerEvents = (await (await request('/api/state', member.credential)).json()).events;
    const rollEvent = playerEvents.find(event => event.payload.operationId === operation.operationId);
    assert.ok(rollEvent, 'action has an authorized durable audit event');
    assert.deepEqual(rollEvent.payload.rolls, receipt.rolls);
    assert.deepEqual(rollEvent.payload.resolution, receipt.resolution);
    assert.equal(rollEvent.payload.verified, true);
    await restart();
    assert.deepEqual(await (await postJson(request, '/api/offline/operations', operation, member.credential)).json(), receipt);
    assert.deepEqual(await (await request('/api/offline/operations/verified-roll-1', member.credential)).json(), receipt);
    assert.equal((await (await request('/api/actors/roll-actor', member.credential)).json()).revision, 2);
  });
});

test('pre-upgrade GM actions can retry their original command without a second commit', async () => {
  await withHost(async ({ host, request, restart }) => {
    const member = await offlineFixture(request, 'legacy-gm-actor');
    const command = { operationId: 'pre-upgrade-gm-1', entityId: 'legacy-gm-actor', baseRevision: 1, actionId: 'spend', parameters: {} };
    const first = await postJson(request, '/api/actions', command);
    assert.equal(first.status, 200);
    const result = await first.json();
    const legacyHash = createHash('sha256').update(JSON.stringify({
      entityId: command.entityId, baseRevision: command.baseRevision,
      actionId: command.actionId, parameters: command.parameters
    })).digest('hex');
    // Simulate an operations row created by the 0.2 host, before principal_id existed.
    host.db.prepare('UPDATE operations SET principal_id=NULL,request_hash=? WHERE id=?').run(legacyHash, command.operationId);
    await restart();
    const repeated = await postJson(request, '/api/actions', command);
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), result);
    assert.equal((await (await request('/api/actors/legacy-gm-actor')).json()).revision, 2);
    const changed = await postJson(request, '/api/actions', { ...command, parameters: { changed: true } });
    assert.equal(changed.status, 409);
    assert.equal((await (await request('/api/actors/legacy-gm-actor')).json()).revision, 2);
  });
});

test('grant and revoke send only an opaque refresh event to the affected live member', async () => {
  await withHost(async ({ request }) => {
    const alice = await (await postJson(request, '/api/members/enroll', { displayName: 'Alice' })).json();
    const bob = await (await postJson(request, '/api/members/enroll', { displayName: 'Bob' })).json();
    const manifest = { id: 'grant.refresh', version: '1', schema: { type: 'object', properties: {}, additionalProperties: true }, actions: [] };
    assert.equal((await postJson(request, '/api/modules', { id: manifest.id, version: manifest.version, manifest })).status, 201);
    assert.equal((await postJson(request, '/api/actors', {
      id: 'grant-private-actor', moduleId: manifest.id, moduleVersion: manifest.version,
      ownerMemberId: alice.memberId, data: { name: 'A private character' }
    })).status, 201);
    const checkSignal = async changePermissions => {
      const cursor = (await (await request('/api/state', bob.credential)).json()).revision;
      const controller = new AbortController();
      const stream = await request(`/api/stream?since=${cursor}`, bob.credential, { signal: controller.signal });
      assert.equal(stream.status, 200);
      const reader = stream.body.getReader();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const pending = (async () => {
          let text = '';
          while (!text.includes('permissions.refresh')) {
            const { done, value } = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
          }
          return text;
        })();
        await changePermissions();
        const eventText = await pending;
        assert.match(eventText, /permissions.refresh/, 'already connected player receives a refresh');
        assert.equal(eventText.includes('grant-private-actor'), false, 'no private actor ID is disclosed by refresh');
        assert.equal(eventText.includes(bob.memberId), false, 'no member ID is disclosed by refresh');
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    };
    assert.equal((await request('/api/actors/grant-private-actor', bob.credential)).status, 404);
    await checkSignal(async () => {
      assert.equal((await postJson(request, '/api/actors/grant-private-actor/grants', { memberId: bob.memberId, permissions: ['read'] })).status, 201);
    });
    assert.equal((await request('/api/actors/grant-private-actor', bob.credential)).status, 200);
    await checkSignal(async () => {
      assert.equal((await request(`/api/actors/grant-private-actor/grants/${bob.memberId}`, 'gm', { method: 'DELETE' })).status, 200);
    });
    assert.equal((await request('/api/actors/grant-private-actor', bob.credential)).status, 404);
    const replay = (await (await request('/api/state?since=0', bob.credential)).json()).events;
    assert.equal(replay.some(event => event.kind === 'actor.granted' || event.kind === 'actor.grant_revoked'), false);
  });
});

test('cursor recovery rejects malformed cursors and returns an explicit snapshot recovery for gaps', async () => {
  await withHost(async ({ host, request }) => {
    for (let i = 0; i < 3; i++) host.db.prepare('INSERT INTO events(id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?)')
      .run(`cursor-fixture-${i}`, 'cursor.fixture', 'gm', '{}', new Date().toISOString());
    const latest = Number(host.db.prepare('SELECT MAX(cursor) AS n FROM events').get().n);
    const first = Number(host.db.prepare('SELECT MIN(cursor) AS n FROM events').get().n);
    host.db.prepare('DELETE FROM events WHERE cursor=?').run(first);

    for (const cursor of ['-1', 'nope', '9007199254740992']) {
      const invalid = await request(`/api/state?since=${cursor}`);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).reasonCode, 'invalid_cursor');
      assert.equal((await request(`/api/stream?since=${cursor}`)).status, 400);
    }
    const expired = await (await request('/api/state?since=0')).json();
    assert.deepEqual(expired.recovery, { reason: 'cursor_expired', cursor: latest });
    assert.deepEqual(expired.events, [], 'a cursor gap requires snapshot recovery, not partial replay');
    const controller = new AbortController();
    try {
      const stream = await request('/api/stream?since=0', 'gm', { signal: controller.signal });
      const reader = stream.body.getReader();
      const firstChunk = await reader.read();
      const notification = new TextDecoder().decode(firstChunk.value);
      assert.match(notification, /recovery\.required/);
      assert.match(notification, /cursor_expired/);
    } finally { controller.abort(); }
    const ahead = await (await request(`/api/state?since=${latest + 1}`)).json();
    assert.deepEqual(ahead.recovery, { reason: 'cursor_ahead', cursor: latest });
    assert.deepEqual(ahead.events, []);
  });
});

test('0.4 character field edit is revisioned, host-validated, idempotent and GM-only', async () => {
  await withHost(async ({ request }) => {
    const member = await offlineFixture(request, 'editable-actor');
    const edit = { operationId: 'character-edit-1', baseRevision: 1, changes: { resources: { focus: 2 } } };
    assert.equal((await request('/api/actors/editable-actor', member.credential, { method: 'PUT', body: JSON.stringify(edit) })).status, 403);
    const first = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify(edit) });
    assert.equal(first.status, 200);
    const accepted = await first.json();
    assert.deepEqual(accepted, { operationId: edit.operationId, entityId: 'editable-actor', status: 'applied', revision: 2 });
    const retried = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify(edit) });
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), accepted);
    const changed = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify({ ...edit, changes: { resources: { focus: 1 } } }) });
    assert.equal(changed.status, 409, 'reusing operation ID with new payload is denied');
    const stale = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify({ ...edit, operationId: 'stale-character', changes: { resources: { focus: 1 } } }) });
    assert.equal(stale.status, 409);
    const forged = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify({ ...edit, operationId: 'forged-character', baseRevision: 2, changes: { ownerMemberId: member.memberId } }) });
    assert.equal(forged.status, 400, 'undeclared / privilege fields cannot be overposted');
    const malformed = await request('/api/actors/editable-actor', 'gm', { method: 'PUT', body: JSON.stringify({ ...edit, operationId: 'malformed-character', baseRevision: 2, changes: { resources: { focus: -5 } } }) });
    assert.equal(malformed.status, 400, 'invalid module data is rejected');
    const actor = await (await request('/api/actors/editable-actor', member.credential)).json();
    assert.equal(actor.revision, 2);
    assert.equal(actor.data.resources.focus, 2);
    const activity = (await (await request('/api/state', member.credential)).json()).events;
    assert.equal(activity.filter(event => event.kind === 'actor.edited' && event.payload.operationId === edit.operationId).length, 1);
  });
});

test('localhost browser preflight permits revisioned JSON and map-image mutations', async () => {
  await withHost(async ({ request }) => {
    const response = await request('/api/maps/map-preflight/background', 'gm', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-file-name,x-operation-id,x-base-revision' }
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
    const allowedHeaders = response.headers.get('access-control-allow-headers') || '';
    for (const header of ['authorization', 'content-type', 'x-file-name', 'x-operation-id', 'x-base-revision']) assert.match(allowedHeaders, new RegExp(header, 'i'));
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  });
});

test('managed Lore assets are content addressed, persistent and gated by current entry publication', async () => {
  await withHost(async ({ request, restart }) => {
    const member = await (await postJson(request, '/api/members/enroll', { displayName: 'Lore reader' })).json();
    const created = await postJson(request, '/api/lore', { operationId: 'asset-lore-create', baseRevision: 0, id: 'sunken-archive', title: 'Sunken Archive', body: 'A hidden place.' });
    assert.equal(created.status, 201);
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const upload = () => request('/api/lore/sunken-archive/assets', 'gm', {
      method: 'POST', body: bytes,
      headers: { 'content-type': 'image/png', 'x-file-name': 'archive.png' }
    });
    const first = await upload();
    assert.equal(first.status, 201);
    const asset = await first.json();
    const second = await upload();
    assert.equal(second.status, 201);
    const duplicate = await second.json();
    assert.notEqual(asset.id, duplicate.id, 'separate Lore references keep independent metadata identities');
    assert.equal(asset.sha256, duplicate.sha256, 'identical bytes share the content-addressed object');
    assert.equal((await request('/api/lore/sunken-archive/assets', member.credential)).status, 404);
    assert.equal((await request(`/api/assets/${asset.id}/content`, member.credential)).status, 404);
    assert.equal((await request(`/api/assets/${asset.id}`, 'nobody')).status, 401);

    assert.equal((await request('/api/lore/sunken-archive/publication', 'gm', { method: 'PUT', body: JSON.stringify({ operationId: 'asset-lore-publish', baseRevision: 1, published: true }) })).status, 200);
    const visibleAssets = await (await request('/api/lore/sunken-archive/assets', member.credential)).json();
    assert.equal(visibleAssets.assets.length, 2);
    const download = await request(`/api/assets/${asset.id}/content`, member.credential);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    await restart();
    assert.deepEqual(Buffer.from(await (await request(`/api/assets/${asset.id}/content`, member.credential)).arrayBuffer()), bytes);

    assert.equal((await request('/api/lore/sunken-archive/publication', 'gm', { method: 'PUT', body: JSON.stringify({ operationId: 'asset-lore-revoke', baseRevision: 2, published: false }) })).status, 200);
    assert.equal((await request('/api/lore/sunken-archive/assets', member.credential)).status, 404);
    assert.equal((await request(`/api/assets/${asset.id}/content`, member.credential)).status, 404);
    assert.equal((await request(`/api/assets/${asset.id}`, member.credential, { method: 'DELETE' })).status, 404);
    assert.equal((await request(`/api/assets/${asset.id}`, 'gm', { method: 'DELETE' })).status, 200);
  });
});

test('Lore asset upload rejects player writes, unsafe names, mismatched bytes and oversized streams', async () => {
  await withHost(async ({ request }) => {
    await postJson(request, '/api/lore', { operationId: 'asset-validation-create', baseRevision: 0, id: 'asset-validation', title: 'Asset validation' });
    const upload = (role, name, mediaType, body) => request('/api/lore/asset-validation/assets', role, {
      method: 'POST', body,
      headers: { 'content-type': mediaType, 'x-file-name': name }
    });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    assert.equal((await upload('player', 'ok.png', 'image/png', png)).status, 404, 'unpublished Lore entry remains unavailable to players');
    assert.equal((await upload('gm', '../escape.png', 'image/png', png)).status, 400);
    assert.equal((await upload('gm', 'script.svg', 'image/svg+xml', Buffer.from('<svg/>'))).status, 400);
    assert.equal((await upload('gm', 'wrong.png', 'image/png', Buffer.from('<html>'))).status, 400);
    assert.equal((await upload('gm', 'large.png', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1, 1))).status, 413);
    const denied = await upload('gm', 'ok.png', 'image/png', png);
    assert.equal(denied.status, 201);
    assert.equal((await request('/api/lore/asset-validation/publication', 'gm', { method: 'PUT', body: JSON.stringify({ operationId: 'asset-validation-publish', baseRevision: 1, published: true }) })).status, 200);
    assert.equal((await upload('player', 'other.png', 'image/png', png)).status, 404, 'unpublished entry existence stays hidden from players');
  });
});

test('GM-private session history and timeline are filtered from player HTTP state and SSE replay', async () => {
  await withHost(async ({ request, host }) => {
    const now = '2026-01-01T00:00:00.000Z';
    host.db.prepare('INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('secret-encounter','Secret encounter','CLASSIFIED_ENCOUNTER_SUMMARY','prepared',1,now,now,'gm','CLASSIFIED_GM_NOTES');
    host.db.prepare('INSERT INTO sessions(id,campaign_id,encounter_id,status,revision,started_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('secret-session','foundation-demo','secret-encounter','active',1,now,now,null);
    host.db.prepare('UPDATE session_state SET current_session_id=?,revision=? WHERE campaign_id=?').run('secret-session',1,'foundation-demo');
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('secret-session-event',null,'session.started','public',JSON.stringify({ sessionId:'secret-session', encounterId:'secret-encounter', marker:'CLASSIFIED_SESSION_MARKER' }),now);
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)')
      .run('public-sentinel',null,'public.marker','public',JSON.stringify({ marker:'VISIBLE_AFTER_SECRET' }),now);
    const gm = await (await request('/api/session','gm')).json();
    assert.equal(gm.current.encounterId,'secret-encounter');
    assert.equal(gm.history[0].encounterId,'secret-encounter');
    const playerResponse = await request('/api/session','player');
    assert.equal(playerResponse.status,200);
    const playerBytes = await playerResponse.text();
    assert.ok(!playerBytes.includes('secret-session') && !playerBytes.includes('secret-encounter'));
    assert.deepEqual(JSON.parse(playerBytes), { revision: 1, current: null, history: [] });
    const stateBytes = await (await request('/api/state?since=0','player')).text();
    for (const secret of ['secret-session','secret-encounter','CLASSIFIED_SESSION_MARKER','CLASSIFIED_GM_NOTES']) assert.ok(!stateBytes.includes(secret));
    const denied = await request('/api/session/secret-session/timeline?after=0','player');
    const absent = await request('/api/session/nonexistent-session/timeline?after=0','player');
    assert.equal(denied.status,404);
    assert.equal(absent.status,404);
    assert.deepEqual(await denied.json(),await absent.json());
    const controller = new AbortController();
    try {
      const stream = await request('/api/stream?since=0','player',{ signal: controller.signal });
      const reader = stream.body.getReader();
      let replay = '';
      while (!replay.includes('VISIBLE_AFTER_SECRET')) {
        const { done, value } = await reader.read();
        if (done) break;
        replay += new TextDecoder().decode(value);
      }
      assert.ok(replay.includes('VISIBLE_AFTER_SECRET'));
      for (const secret of ['secret-session','secret-encounter','CLASSIFIED_SESSION_MARKER']) assert.ok(!replay.includes(secret));
    } finally { controller.abort(); }
    const gmTimeline = await (await request('/api/session/secret-session/timeline?after=0','gm')).json();
    assert.ok(gmTimeline.events.some(event => event.payload.marker === 'CLASSIFIED_SESSION_MARKER'));
  });
});
