// Focused 0.5 session/reconnect acceptance: pnpm acceptance:table
// Uses the real host HTTP/SSE boundary and a disposable SQLite database.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../server/host/index.mjs';

const directory = mkdtempSync(join(tmpdir(), 'potomac-table-acceptance-'));
const databasePath = join(directory, 'host.sqlite');
const gmToken = 'table-acceptance-gm';
const hostOptions = { databasePath, gmToken, playerToken: 'table-acceptance-legacy-player', seedDemo: false };
let host;
let baseUrl;

async function startHost() {
  host = createHost(hostOptions);
  const address = await host.listen(0);
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function stopHost() {
  host?.close();
  host = undefined;
}

const token = value => value === 'gm' ? gmToken : value;
async function request(path, role = 'gm', options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token(role)}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  });
}
const send = (path, body, role = 'gm') => request(path, role, { method: 'POST', body: JSON.stringify(body) });
const readJson = async response => ({ status: response.status, body: await response.json() });

try {
  await startHost();

  // The initial install is clean while bundled declarative modules are present.
  const empty = await readJson(await request('/api/state'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.actors, [], 'fresh host contains no demo actors');
  assert.ok(empty.body.modules.some(module => module.id === 'example.system-a' && module.version === '0.1.0'));

  const enrollmentA = await readJson(await send('/api/members/enroll', { displayName: 'Player A' }));
  const enrollmentB = await readJson(await send('/api/members/enroll', { displayName: 'Player B' }));
  assert.equal(enrollmentA.status, 201);
  assert.equal(enrollmentB.status, 201);
  const playerA = enrollmentA.body.credential;
  const playerB = enrollmentB.body.credential;
  assert.notEqual(playerA, playerB);

  const tableCampaign = await readJson(await request('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify({
    name: 'Table Acceptance', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1
  }) }));
  assert.equal(tableCampaign.status, 200);
  const actor = (await readJson(await send('/api/actors', {
    id: 'table-actor-a', moduleId: 'example.system-a', moduleVersion: '0.1.0',
    ownerMemberId: enrollmentA.body.memberId,
    data: { name: 'Table Character', epithet: 'Acceptance fixture', attributes: { strength: 10, intelligence: 10 }, resources: { hp: { current: 10, maximum: 10 }, mana: { current: 2, maximum: 4 } } }
  }))).body;
  assert.equal(actor.id, 'table-actor-a');
  const encounter = await readJson(await send('/api/encounters', { id: 'table-encounter', name: 'The Glass Bridge', summary: 'Prepared fixture' }));
  assert.equal(encounter.status, 201);
  const participants = await readJson(await request('/api/encounters/table-encounter/participants', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision: encounter.body.revision, participants: [{ actorId: 'table-actor-a', status: 'active' }] }) }));
  assert.equal(participants.status, 200);

  const initialSession = await readJson(await request('/api/session'));
  assert.deepEqual(initialSession.body, { revision: 0, current: null, history: [] });
  const beforeStartCursor = (await readJson(await request('/api/state'))).body.revision;
  assert.equal((await send('/api/session/commands', { operationId: 'start-denied', command: 'start', sessionId: 'night-one', baseRevision: 0 }, playerA)).status, 403);
  const startedResponse = await send('/api/session/commands', { operationId: 'session-start', command: 'start', sessionId: 'night-one', encounterId: 'table-encounter', encounterRevision: participants.body.revision, baseRevision: 0 });
  const started = await readJson(startedResponse);
  assert.equal(started.status, 200);
  assert.equal(started.body.current.status, 'active');
  assert.deepEqual((await readJson(await send('/api/session/commands', { operationId: 'session-start', command: 'start', sessionId: 'night-one', encounterId: 'table-encounter', encounterRevision: participants.body.revision, baseRevision: 0 }))).body, started.body, 'retry returns original committed session receipt');
  assert.equal((await send('/api/session/commands', { operationId: 'session-start', command: 'start', sessionId: 'different', encounterId: 'table-encounter', encounterRevision: participants.body.revision, baseRevision: 0 })).status, 409, 'operation ID payload collision is rejected');

  // Private encounter preparation is inspected in transmitted JSON and SSE bytes.
  const hiddenEncounter = await readJson(await send('/api/encounters', {
    id: 'table-private-encounter', name: 'Hidden Room', summary: 'Public summary', visibility: 'gm', gmNotes: 'TABLE_ACCEPTANCE_SECRET'
  }));
  assert.equal(hiddenEncounter.status, 201);
  assert.equal(hiddenEncounter.body.gmNotes, 'TABLE_ACCEPTANCE_SECRET');
  const selected = await readJson(await send('/api/context', { context: { activeEncounter: 'table-private-encounter' } }));
  assert.equal(selected.status, 200);
  const playerStateResponse = await request('/api/state', playerA);
  const playerStateBytes = await playerStateResponse.text();
  assert.equal(playerStateResponse.status, 200);
  assert.ok(!playerStateBytes.includes('TABLE_ACCEPTANCE_SECRET'));
  assert.ok(!playerStateBytes.includes('table-private-encounter'), 'hidden encounter and derived context are omitted from player snapshot');
  assert.ok(playerStateBytes.includes('session.started'), 'authorized lifecycle event appears in player snapshot');

  const replayResponse = await request(`/api/state?since=${beforeStartCursor}`, playerB);
  const replayBytes = await replayResponse.text();
  assert.equal(replayResponse.status, 200);
  assert.ok(replayBytes.includes('session.started'), 'second member catches up from a durable cursor');
  assert.ok(!replayBytes.includes('TABLE_ACCEPTANCE_SECRET'));
  assert.ok(!replayBytes.includes('table-private-encounter'));

  // A real SSE stream replays authorized events from the supplied cursor.
  const streamResponse = await request(`/api/stream?since=${beforeStartCursor}`, playerB, { signal: AbortSignal.timeout(1500) });
  assert.equal(streamResponse.status, 200);
  const streamReader = streamResponse.body.getReader();
  let streamBytes = '';
  try {
    while (!streamBytes.includes('session.started')) {
      const { done, value } = await streamReader.read();
      if (done) break;
      streamBytes += new TextDecoder().decode(value);
    }
  } finally {
    await streamReader.cancel();
  }
  assert.ok(streamBytes.includes('session.started'));
  assert.ok(!streamBytes.includes('TABLE_ACCEPTANCE_SECRET'));
  assert.ok(!streamBytes.includes('table-private-encounter'));

  const paused = await readJson(await send('/api/session/commands', { operationId: 'session-pause', command: 'pause', sessionId: 'night-one', baseRevision: 1 }));
  assert.equal(paused.body.current.status, 'paused');
  stopHost();
  await startHost();
  const recoveredSession = await readJson(await request('/api/session'));
  assert.equal(recoveredSession.body.current.status, 'paused', 'session survives a host restart mid-transition');
  const resumed = await readJson(await send('/api/session/commands', { operationId: 'session-resume', command: 'resume', sessionId: 'night-one', baseRevision: 2 }));
  assert.equal(resumed.body.current.status, 'active');

  // Exercise an offline intent using a real member credential and durable receipt.
  assert.equal((await send('/api/actors/table-actor-a/grants', { memberId: enrollmentA.body.memberId, permissions: ['read', 'act'] })).status, 201);
  assert.equal((await send('/api/actors/table-actor-a/grants', { memberId: enrollmentB.body.memberId, permissions: ['read', 'act'] })).status, 201);

  const offlineOperation = {
    operationId: 'player-a-offline-spend', campaignId: 'foundation-demo', memberId: enrollmentA.body.memberId,
    entityId: actor.id, baseRevision: 1, moduleId: 'example.system-a', moduleVersion: '0.1.0',
    schemaVersion: 1, actionId: 'spend-mana', parameters: {}, dependencies: []
  };
  const offlineReceipt = await readJson(await send('/api/offline/operations', offlineOperation, playerA));
  assert.equal(offlineReceipt.status, 200);
  assert.equal(offlineReceipt.body.status, 'applied', 'only host receipt acknowledges the queued operation');
  assert.equal((await readJson(await send('/api/offline/operations', offlineOperation, playerA))).body.operationId, offlineOperation.operationId, 'same queued operation retries with its original receipt');
  assert.equal((await send('/api/offline/operations', { ...offlineOperation, parameters: { unexpected: true } }, playerA)).status, 409, 'changed body cannot reuse a committed operation ID');
  const committed = await readJson(await request('/api/actors/table-actor-a', playerA));
  assert.equal(committed.body.data.resources.mana.current, 1, 'retry did not apply the action twice');
  const playerAEvents = await readJson(await request('/api/state?since=0', playerA));
  assert.ok(!JSON.stringify(playerAEvents.body).includes('ACTOR_PRIVATE_SECRET'), 'actor secret is filtered from snapshot and event replay');
  assert.ok(!JSON.stringify(playerAEvents.body.events).includes('offline.proposal'), 'no unrelated member proposal is visible');

  // Revocation is enforced on the next request; previous cached bytes are not current authority.
  assert.equal((await send('/api/members/enroll', { displayName: 'Revocation Probe' })).status, 201);
  assert.equal((await request('/api/actors/table-actor-a', playerB)).status, 200);
  assert.equal((await request('/api/actors/table-actor-a', playerA)).status, 200);
  assert.equal((await request('/api/members/' + encodeURIComponent(enrollmentA.body.memberId), 'gm', { method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/actors/table-actor-a', playerA)).status, 401, 'revoked credential cannot fetch fresh actor state');

  // Drain an authorized SSE catch-up after restart, then end and reopen history.
  const timelineBeforeEnd = await readJson(await request('/api/session/night-one/timeline', 'gm'));
  assert.deepEqual(timelineBeforeEnd.body.events.map(event => event.kind), ['session.started', 'session.paused', 'session.resumed']);
  const ended = await readJson(await send('/api/session/commands', { operationId: 'session-end', command: 'finish', sessionId: 'night-one', baseRevision: 3 }));
  assert.equal(ended.body.current.status, 'finished');
  stopHost();
  await startHost();
  const finalSession = await readJson(await request('/api/session'));
  assert.equal(finalSession.body.current.status, 'finished');
  assert.deepEqual(finalSession.body.history.map(item => item.id), ['night-one']);
  const finalEvents = (await readJson(await request('/api/state?since=0'))).body.events;
  assert.equal(finalEvents.filter(event => event.kind === 'session.started').length, 1, 'lifecycle retry/restart created one start event');
  assert.equal(finalEvents.filter(event => event.kind === 'action.applied' && event.payload.operationId === offlineOperation.operationId).length, 1, 'offline retry/restart created one action event');

  console.log('PASS: isolated host HTTP/SSE coverage for session lifecycle, durable history, idempotent commands/actions, cursor replay, player authorization and byte-level redaction, offline operation retry, and credential revocation. Browser-level Table coverage runs as part of pnpm acceptance:campaign.');
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  stopHost();
  rmSync(directory, { recursive: true, force: true });
}
