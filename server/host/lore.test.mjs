import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function withHost(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-lore-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath });
  let address = await host.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'gm', options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${role === 'gm' || role === 'player' ? `local-${role}` : role}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  try {
    await run({ request, get host() { return host; }, restart: async () => {
      host.close(); host = createHost({ databasePath }); address = await host.listen(0); baseUrl = `http://127.0.0.1:${address.port}`;
    } });
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
}

const command = (request, path, body, method = 'POST', role = 'gm') => request(path, role, { method, body: JSON.stringify(body) });
const read = async response => response.json();

async function enroll(request) {
  const response = await command(request, '/api/members/enroll', { displayName: 'Lore reader' });
  assert.equal(response.status, 201);
  return (await read(response)).credential;
}

test('Lore CRUD persists the documented type and visibility contract and publication never exposes GM fields', async () => withHost(async ({ request, restart, host }) => {
  const player = await enroll(request);
  const createBody = { operationId: 'lore-create-1', baseRevision: 0, type: 'location', title: 'Sunken Archive', summary: 'Flooded records', bodyMarkdown: '# Public account', gmNotes: 'The traitor is Mira', tags: ['archive', 'secret-index'] };
  const createdResponse = await command(request, '/api/lore', createBody);
  assert.equal(createdResponse.status, 201);
  const created = await read(createdResponse);
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.revision, 1);
  assert.equal(created.type, 'location');
  assert.equal(created.visibility, 'gm');
  assert.equal(host.db.prepare('SELECT type,visibility FROM lore_entries WHERE id=?').get(created.id).visibility, 'gm');
  const creationEvent = (await read(await request('/api/state'))).events.find(event => event.kind === 'lore.created');
  assert.ok(creationEvent);
  assert.equal(creationEvent.visibility, 'gm');
  assert.deepEqual(creationEvent.payload, { entryId: created.id, revision: 1 });
  assert.deepEqual((await read(await request('/api/lore', player))).articles, []);

  assert.equal((await command(request, '/api/lore', { ...createBody, operationId: 'lore-overpost', visibility: 'public' })).status, 400);
  assert.equal((await command(request, '/api/lore', { ...createBody, operationId: 'lore-player-create' }, 'POST', player)).status, 403);
  assert.equal((await command(request, `/api/lore/${created.id}`, { operationId: 'lore-stale', baseRevision: 0, title: 'Overwritten' }, 'PUT')).status, 409);

  const updateBody = { operationId: 'lore-update-1', baseRevision: 1, body: '## Updated public account' };
  const updated = await read(await command(request, `/api/lore/${created.id}`, updateBody, 'PUT'));
  assert.equal(updated.revision, 2);
  assert.deepEqual(await read(await command(request, `/api/lore/${created.id}`, updateBody, 'PUT')), updated);
  assert.equal((await command(request, `/api/lore/${created.id}`, { ...updateBody, title: 'Different', operationId: 'lore-update-conflict' }, 'PUT')).status, 409);

  const publishBody = { operationId: 'lore-publish-1', baseRevision: 2 };
  const published = await read(await command(request, `/api/lore/${created.id}/publish`, publishBody, 'PUT'));
  assert.equal(published.revision, 3);
  const publicationEvent = (await read(await request('/api/state'))).events.find(event => event.kind === 'lore.published');
  assert.equal(publicationEvent.visibility, 'gm');
  assert.deepEqual(publicationEvent.payload, { entryId: created.id, revision: 3 });
  const playerList = await read(await request('/api/lore', player));
  assert.equal(playerList.articles.length, 1);
  assert.equal(playerList.articles[0].bodyMarkdown, '## Updated public account');
  assert.equal(playerList.articles[0].type, 'location');
  assert.equal(playerList.articles[0].visibility, 'shared');
  assert.deepEqual(playerList.articles[0].tags, ['archive', 'secret-index']);
  assert.equal('gmNotes' in playerList.articles[0], false);
  assert.deepEqual((await read(await request('/api/lore?q=secret-index', player))).articles.map(article => article.id), [created.id]);
  assert.equal((await read(await request(`/api/lore/${created.id}`, player))).article.gmNotes, undefined);
  assert.equal((await request(`/api/lore/${created.id}/publish`, player, { method: 'PUT', body: JSON.stringify({ operationId: 'player-publish', baseRevision: 3 }) })).status, 403);

  await restart();
  assert.equal((await read(await request(`/api/lore/${created.id}`, player))).article.bodyMarkdown, '## Updated public account');
  const revoked = await read(await command(request, `/api/lore/${created.id}/revoke`, { operationId: 'lore-revoke-1', baseRevision: 3 }, 'PUT'));
  assert.equal(revoked.revision, 4);
  const revocationEvent = (await read(await request('/api/state'))).events.find(event => event.kind === 'lore.revoked');
  assert.equal(revocationEvent.visibility, 'gm');
  assert.deepEqual(revocationEvent.payload, { entryId: created.id, revision: 4 });
  assert.equal((await request(`/api/lore/${created.id}`, player)).status, 404);
  assert.deepEqual((await read(await request('/api/lore', player))).articles, []);
  const replay = await read(await request('/api/state?since=0', player));
  assert.equal(replay.events.some(event => event.kind.startsWith('lore.')), false);

  const archive = await read(await command(request, `/api/lore/${created.id}/archive`, { operationId: 'lore-archive-1', baseRevision: 4 }, 'PUT'));
  assert.equal(archive.archived, true);
  assert.equal((await read(await request('/api/lore', player))).articles.length, 0);
  const restored = await read(await command(request, `/api/lore/${created.id}/restore`, { operationId: 'lore-restore-1', baseRevision: 5 }, 'PUT'));
  assert.equal(restored.archived, false);
  assert.equal((await read(await request(`/api/lore/${created.id}`))).article.visibility, 'gm');
}));

test('Lore migration adds type and visibility without changing legacy rows or publication state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-lore-migrate-'));
  const databasePath = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TABLE lore_entries (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', gm_notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO lore_entries(id,campaign_id,title,published,created_at,updated_at) VALUES('legacy-shared','foundation-demo','Shared legacy',1,'now','now'),('legacy-private','foundation-demo','Private legacy',0,'now','now');`);
  legacy.close();
  const host = createHost({ databasePath });
  try {
    assert.deepEqual({ ...host.db.prepare('SELECT type,visibility,published FROM lore_entries WHERE id=?').get('legacy-shared') }, { type: 'note', visibility: 'shared', published: 1 });
    assert.deepEqual({ ...host.db.prepare('SELECT type,visibility,published FROM lore_entries WHERE id=?').get('legacy-private') }, { type: 'note', visibility: 'gm', published: 0 });
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Lore links resolve by stable IDs and hide private targets from player lists, backlinks, and event replay', async () => withHost(async ({ request, restart }) => {
  const player = await enroll(request);
  const make = async (operationId, title) => read(await command(request, '/api/lore', { operationId, baseRevision: 0, title, body: `${title} public text` }));
  const source = await make('source-create', 'Sunken Archive');
  const visibleTarget = await make('target-create', 'The Wardens');
  const secretTarget = await make('secret-create', 'Secret Observatory');
  await command(request, `/api/lore/${visibleTarget.id}/publish`, { operationId: 'target-publish', baseRevision: 1 }, 'PUT');
  await command(request, `/api/lore/${source.id}/publish`, { operationId: 'source-publish', baseRevision: 1 }, 'PUT');
  const link = await read(await command(request, `/api/lore/${source.id}/links`, { operationId: 'link-visible', baseRevision: 2, targetKind: 'lore', targetId: visibleTarget.id, label: 'allies' }, 'PUT'));
  await command(request, `/api/lore/${source.id}/links`, { operationId: 'link-hidden', baseRevision: 3, targetKind: 'lore', targetId: secretTarget.id }, 'PUT');

  const playerSourceResponse = await request(`/api/lore/${source.id}`, player);
  const playerSource = await read(playerSourceResponse);
  assert.equal(playerSourceResponse.status, 200, JSON.stringify(playerSource));
  assert.deepEqual(playerSource.links.map(item => item.targetId), [visibleTarget.id]);
  assert.equal(JSON.stringify(playerSource).includes(secretTarget.id), false);
  const backlinksResponse = await request(`/api/lore/${visibleTarget.id}/links`, player);
  const backlinks = await read(backlinksResponse);
  assert.equal(backlinksResponse.status, 200, JSON.stringify(backlinks));
  assert.equal(backlinks.backlinks.some(item => item.sourceId === source.id), true);
  assert.equal((await read(await request(`/api/lore/${secretTarget.id}/links`, player))).error, 'Lore entry not found');

  await restart();
  assert.deepEqual((await read(await request(`/api/lore/${source.id}`, player))).links.map(item => item.id), [link.linkId]);
  const remove = await read(await command(request, `/api/lore/${source.id}/links/${link.linkId}`, { operationId: 'link-remove', baseRevision: 4 }, 'PUT'));
  assert.equal(remove.removed, true);
  assert.deepEqual((await read(await request(`/api/lore/${source.id}`, player))).links, []);
  assert.equal((await request(`/api/lore/${source.id}/links/${link.linkId}`, player, { method: 'PUT', body: JSON.stringify({ operationId: 'player-unlink', baseRevision: 5 }) })).status, 403);
}));

test('Lore commands reject malformed content, operation collisions, and stale publication', async () => withHost(async ({ request }) => {
  for (const type of ['unknown', '', null]) assert.equal((await command(request, '/api/lore', { operationId: `bad-type-${String(type)}`, baseRevision: 0, type, title: 'A title' })).status, 400);
  for (const [operationId, title, body] of [
    ['invalid-title', '', 'text'], ['invalid-markdown', 'Good title', 'bad\u0000text'], ['oversized', 'Good title', 'x'.repeat(200001)]
  ]) assert.equal((await command(request, '/api/lore', { operationId, baseRevision: 0, title, body })).status, 400);
  const entry = await read(await command(request, '/api/lore', { operationId: 'collision-id', baseRevision: 0, title: 'First', body: '' }));
  const collision = await command(request, '/api/lore', { operationId: 'collision-id', baseRevision: 0, title: 'Other', body: '' });
  assert.equal(collision.status, 409, await collision.text());
  assert.equal((await command(request, `/api/lore/${entry.id}/publish`, { operationId: 'stale-publish', baseRevision: 0 }, 'PUT')).status, 409);
}));
