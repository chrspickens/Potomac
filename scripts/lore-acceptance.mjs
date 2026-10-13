// Focused Lore HTTP/privacy acceptance: pnpm acceptance:lore
// Exercises the current host contract against a disposable SQLite database.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../server/host/index.mjs';

const directory = mkdtempSync(join(tmpdir(), 'potomac-lore-acceptance-'));
const gmToken = 'lore-acceptance-gm';
let host;
let baseUrl;

async function startHost() {
  host = createHost({ databasePath: join(directory, 'host.sqlite'), gmToken, playerToken: 'lore-acceptance-unused', seedDemo: false });
  const address = await host.listen(0);
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function stopHost() { host?.close(); host = undefined; }

async function request(path, credential = gmToken, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${credential}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
}

async function json(response) { return { status: response.status, body: await response.json() }; }

try {
  await startHost();
  const enrolled = await json(await request('/api/members/enroll', gmToken, { method: 'POST', body: JSON.stringify({ displayName: 'Lore Reader' }) }));
  assert.equal(enrolled.status, 201);
  const playerToken = enrolled.body.credential;

  const invalidCredential = await request('/api/lore', 'invalid-lore-credential');
  assert.equal(invalidCredential.status, 401, 'Lore reads require host authentication');

  const draftInput = {
    operationId: 'lore-create-draft', baseRevision: 0, id: 'lore-moonwell', type: 'location', title: 'Moonwell', summary: 'A spring beneath the cliffs',
    body: 'Water reflects a second moon.', gmNotes: 'GM_ONLY_LORE_SECRET', tags: ['coast', 'ruins', 'potomac-kind:location']
  };
  const created = await json(await request('/api/lore', gmToken, { method: 'POST', body: JSON.stringify(draftInput) }));
  assert.equal(created.status, 201);
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.published, false);
  const loreId = draftInput.id;

  const gmList = await json(await request('/api/lore'));
  assert.equal(gmList.status, 200);
  assert.equal(gmList.body.articles.length, 1);
  assert.equal(gmList.body.articles[0].gmNotes, 'GM_ONLY_LORE_SECRET');
  assert.equal(gmList.body.articles[0].type, 'location', 'Lore kind is explicit in the host contract');
  assert.equal(gmList.body.articles[0].visibility, 'gm', 'draft visibility is explicit in the host contract');
  assert.equal(gmList.body.articles[0].published, false, 'legacy publication alias agrees with visibility');
  assert.equal((await json(await request('/api/lore', playerToken))).body.articles.length, 0, 'player cannot list an unpublished draft');

  const deniedWrite = await request('/api/lore', playerToken, { method: 'POST', body: JSON.stringify({ ...draftInput, operationId: 'lore-player-create', id: 'player-created-lore' }) });
  assert.equal(deniedWrite.status, 403, 'player cannot create Lore');

  const published = await json(await request(`/api/lore/${encodeURIComponent(loreId)}/publication`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-publish', baseRevision: 1, published: true })
  }));
  assert.equal(published.status, 200);
  assert.equal(published.body.visibility, 'shared', 'host publication state is explicit on the command response');

  const playerArticle = await json(await request(`/api/lore/${encodeURIComponent(loreId)}`, playerToken));
  assert.equal(playerArticle.status, 200);
  assert.equal(playerArticle.body.article.body, draftInput.body);
  assert.equal(playerArticle.body.article.type, 'location', 'player receives the explicit Lore kind');
  assert.equal(playerArticle.body.article.visibility, 'shared', 'player receives the explicit Lore visibility');
  assert.equal(Object.hasOwn(playerArticle.body.article, 'gmNotes'), false, 'player projection omits GM notes');
  assert.ok(!JSON.stringify(playerArticle.body).includes('GM_ONLY_LORE_SECRET'));

  const gmReplay = await json(await request('/api/state?since=0'));
  const createdEvent = gmReplay.body.events.find(event => event.kind === 'lore.created');
  const publishedEvent = gmReplay.body.events.find(event => event.kind === 'lore.published');
  assert.ok(createdEvent, 'creation event has the explicit lore.created kind');
  assert.equal(createdEvent.visibility, 'gm', 'creation event visibility is explicit');
  assert.deepEqual(createdEvent.payload, { entryId: loreId, revision: 1 });
  assert.ok(publishedEvent, 'publication event has the explicit lore.published kind');
  assert.equal(publishedEvent.visibility, 'gm', 'publication event visibility is explicit');
  assert.deepEqual(publishedEvent.payload, { entryId: loreId, revision: 2 });
  const playerReplay = await json(await request('/api/state?since=0', playerToken));
  assert.ok(playerReplay.body.events.some(event => event.kind === 'lore.published' && event.visibility === 'gm'), 'host filters Lore events by current entry access while retaining their explicit event visibility');
  assert.ok(playerReplay.body.events.every(event => !JSON.stringify(event).includes(draftInput.body) && !JSON.stringify(event).includes('GM_ONLY_LORE_SECRET')), 'Lore event payloads do not expose article content or GM notes');

  const revoked = await json(await request(`/api/lore/${encodeURIComponent(loreId)}/publication`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-revoke', baseRevision: 2, published: false })
  }));
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.visibility, 'gm');
  assert.equal((await json(await request('/api/lore', playerToken))).body.articles.length, 0, 'unpublished Lore is unavailable to players');
  assert.equal((await json(await request(`/api/lore/${encodeURIComponent(loreId)}`, playerToken))).status, 404);

  const uiSource = readFileSync(new URL('../clients/web/src/lore-app.tsx', import.meta.url), 'utf8');
  const apiSource = readFileSync(new URL('../clients/web/src/api.ts', import.meta.url), 'utf8');
  assert.match(uiSource, /<h1>Lore &amp; handouts<\/h1>/, 'Lore application surface is present');
  assert.match(uiSource, /Preview safely/, 'Lore UI exposes a safe text preview');
  assert.ok(apiSource.includes("/api/lore/${encodeURIComponent(id)}/${archived ? 'archive' : 'restore'}"), 'archive API path is wired');

  assert.match(apiSource, /export type LoreKind = /, 'client declares an explicit Lore kind contract');
  assert.match(apiSource, /export type LoreVisibility = /, 'client declares an explicit Lore visibility contract');
  assert.match(apiSource, /kind: LoreKind/, 'client Lore articles carry kind explicitly');
  assert.match(apiSource, /visibility: LoreVisibility/, 'client Lore articles carry visibility explicitly');
  const archiveResponse = await request(`/api/lore/${encodeURIComponent(loreId)}/archive`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-client-archive-shape', baseRevision: 3 })
  });
  assert.equal(archiveResponse.status, 200, 'client archive method/path matches the host API');
  const archiveResult = await archiveResponse.json();
  assert.equal(archiveResult.archived, true);
  const archiveEvent = (await json(await request('/api/state?since=0'))).body.events.find(event => event.kind === 'lore.archived');
  assert.ok(archiveEvent, 'archive event has the explicit lore.archived kind');
  assert.equal(archiveEvent.visibility, 'gm', 'archive event visibility is explicit');

  console.log('PASS: Lore creation, publication/revocation/archive, explicit kind and visibility contracts, GM/player projections, authorization, event filtering, and client wire alignment.');
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  stopHost();
  rmSync(directory, { recursive: true, force: true });
}
