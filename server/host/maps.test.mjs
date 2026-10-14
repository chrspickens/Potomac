import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-maps-'));
  const databasePath = join(directory, 'host.sqlite');
  let host = createHost({ databasePath });
  let address = await host.listen(0);
  let base = `http://127.0.0.1:${address.port}`;
  const request = (path, role = 'gm', body) => fetch(`${base}${path}`, {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    headers: { authorization: `Bearer ${role === 'gm' || role === 'player' ? `local-${role}` : role}`, ...(body ? { 'content-type': 'application/json' } : {}) }
  });
  try {
    await run({ request, getBase: () => base, get host() { return host; }, restart() { host.close(); host = createHost({ databasePath }); return host.listen(0).then(result => { address = result; base = `http://127.0.0.1:${address.port}`; }); } });
  } finally { host.close(); rmSync(directory, { recursive: true, force: true }); }
}
const send = (request, path, body, role = 'gm') => request(path, role, body);
const json = response => response.json();
async function readWithTimeout(reader) {
  let timer;
  try {
    return await Promise.race([reader.read(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
  } finally { clearTimeout(timer); }
}

test('map scenes use revisioned idempotent commands, protect linked private destinations and manage shared image bytes', async () => fixture(async ({ request, restart, getBase }) => {
  const enrollment = await request('/api/members/enroll', 'gm', { displayName: 'Map player' });
  assert.equal(enrollment.status, 201);
  const player = (await json(enrollment)).credential;
  const create = { operationId: 'scene-create', baseRevision: 0, id: 'world-one', name: 'North', kind: 'world', width: 100, height: 80, grid: { type: 'none', size: 0 } };
  const createdResponse = await send(request, '/api/maps', create);
  assert.equal(createdResponse.status, 200);
  const created = await json(createdResponse);
  assert.equal(created.revision, 1);
  assert.equal((await json(await request('/api/maps', player))).maps.length, 0);
  assert.deepEqual(await json(await send(request, '/api/maps', create)), created);
  assert.equal((await send(request, '/api/maps', { ...create, name: 'changed' })).status, 409);
  assert.equal((await send(request, '/api/maps', { operationId: 'battle-create', baseRevision: 0, id: 'battle-one', name: 'Vault', kind: 'battle', width: 40, height: 30 })).status, 200);

  const putPiece = { operationId: 'piece-put', baseRevision: 1, command: 'piece.put', piece: { id: 'pin-one', kind: 'pin', label: 'Path', x: 10, y: 15 } };
  assert.equal((await send(request, '/api/maps/world-one/commands', putPiece)).status, 200);
  assert.equal((await send(request, '/api/maps/world-one/commands', { operationId: 'link-put', baseRevision: 2, command: 'link.put', pieceId: 'pin-one', targetSceneId: 'battle-one', label: 'Hidden vault' })).status, 200);
  const image = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(image); image.writeUInt32BE(2,16); image.writeUInt32BE(3,20);
  const uploadHeaders = { authorization: 'Bearer local-gm', 'content-type': 'image/png', 'x-file-name': 'map.png', 'x-operation-id': 'background-upload', 'x-base-revision': '3' };
  const upload = () => fetch(`${getBase()}/api/maps/world-one/background`, { method: 'POST', headers: uploadHeaders, body: image });
  assert.equal((await upload()).status, 201);
  assert.equal((await upload()).status, 200);
  assert.equal((await fetch(`${getBase()}/api/maps/world-one/background/content`, { headers: { authorization: `Bearer ${player}` } })).status, 404);
  const published = { operationId: 'scene-publish', baseRevision: 4, command: 'publish' };
  assert.equal((await send(request, '/api/maps/world-one/commands', published)).status, 200);
  let playerScene = await json(await request('/api/maps/world-one', player));
  assert.equal(playerScene.visibility, 'shared');
  assert.equal(playerScene.pieces.length, 0); // the linked Battle scene is private
  assert.equal('gmNotes' in playerScene, false);
  const playerImage = await fetch(`${getBase()}/api/maps/world-one/background/content`, { headers: { authorization: `Bearer ${player}` } });
  assert.equal(playerImage.status, 200); assert.deepEqual(Buffer.from(await playerImage.arrayBuffer()), image);
  assert.equal((await send(request, '/api/maps/world-one/commands', { operationId: 'player-move', baseRevision: 5, command: 'piece.delete', pieceId: 'pin-one' }, player)).status, 403);
  assert.equal((await send(request, '/api/maps/world-one/commands', { operationId: 'bad-geometry', baseRevision: 5, command: 'piece.put', piece: { id: 'bad', kind: 'pin', label: 'x', x: NaN, y: 1 } })).status, 400);

  await restart();
  const restoredScene = await json(await request('/api/maps/world-one', player));
  assert.equal(restoredScene.pieces.length, 0);
  assert.equal(restoredScene.background.sha256, createHash('sha256').update(image).digest('hex'));
  const restoredImage = await fetch(`${getBase()}/api/maps/world-one/background/content`, { headers: { authorization: `Bearer ${player}` } });
  assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), image);
  assert.equal((await send(request, '/api/maps/world-one/commands', { operationId: 'scene-revoke', baseRevision: 5, command: 'revoke' })).status, 200);
  assert.equal((await request('/api/maps/world-one', player)).status, 404);
  assert.equal((await fetch(`${getBase()}/api/maps/world-one/background/content`, { headers: { authorization: `Bearer ${player}` } })).status, 404);
  const state = await json(await request('/api/state', player));
  assert.equal(state.maps.length, 0);
  assert.equal(state.events.some(event => event.kind.startsWith('map.') && event.payload.sceneId === 'world-one'), false);
}));

test('Lore pin destinations are revisioned, independently authorized in projections and replay, and survive restart', async () => fixture(async ({ request, restart, getBase }) => {
  const enroll = await request('/api/members/enroll', 'gm', { displayName: 'Lore map reader' });
  const player = (await json(enroll)).credential;
  const loreMutation = (entryId, action, operationId, baseRevision) => fetch(`${getBase()}/api/lore/${entryId}/${action}`, { method: 'PUT', headers: { authorization: 'Bearer local-gm', 'content-type': 'application/json' }, body: JSON.stringify({ operationId, baseRevision }) });
  const assertOpaqueRefresh = async (entryId, action, operationId, baseRevision, secrets) => {
    const cursor = (await json(await request('/api/state', player))).revision;
    const controller = new AbortController();
    const stream = await fetch(`${getBase()}/api/stream?since=${cursor}`, { headers: { authorization: `Bearer ${player}` }, signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const mutation = await loreMutation(entryId, action, operationId, baseRevision);
    assert.equal(mutation.status, 200);
    let text = '';
    while (!text.includes('permissions.refresh')) {
      const chunk = await readWithTimeout(reader);
      assert.ok(chunk, `timed out awaiting opaque Lore refresh; received ${text.slice(-500)}`);
      const { done, value } = chunk;
      assert.equal(done, false);
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    await reader.cancel().catch(() => {});
    assert.ok(text.includes('"payload":{}'));
    for (const secret of secrets) assert.equal(text.includes(secret), false);
    return text;
  };
  const assertAuthorizedLifecycle = async (entryId, action, eventKind, operationId, baseRevision) => {
    const cursor = (await json(await request('/api/state', player))).revision;
    const controller = new AbortController();
    const stream = await fetch(`${getBase()}/api/stream?since=${cursor}`, { headers: { authorization: `Bearer ${player}` }, signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const mutation = await loreMutation(entryId, action, operationId, baseRevision);
    assert.equal(mutation.status, 200);
    let text = '';
    while (!text.includes(eventKind)) {
      const chunk = await readWithTimeout(reader);
      assert.ok(chunk, `timed out awaiting authorized Lore publication event; received ${text.slice(-500)}`);
      const { done, value } = chunk;
      assert.equal(done, false);
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    await reader.cancel().catch(() => {});
    assert.ok(text.includes('"visibility":"gm"'));
    assert.ok(text.includes(entryId));
    assert.equal(text.includes('PRIVATE SUNKEN ARCHIVE'), false);
    assert.equal(text.includes('GM-only archive coordinates'), false);
    return text;
  };
  const loreCreate = async (operationId, title) => json(await request('/api/lore', 'gm', {
    operationId, baseRevision: 0, type: 'location', title, bodyMarkdown: `${title} account`, gmNotes: 'GM-only archive coordinates'
  }));
  const hiddenLore = await loreCreate('hidden-lore-create', 'PRIVATE SUNKEN ARCHIVE');
  const publicLore = await loreCreate('public-lore-create', 'Sunken Archive');
  const anotherLore = await loreCreate('another-lore-create', 'Archive Annex');
  const scene = await json(await send(request, '/api/maps', { operationId: 'lore-map-create', baseRevision: 0, id: 'lore-world', name: 'Ashen Coast', kind: 'world', width: 100, height: 80, grid: { type: 'none', size: 0 } }));
  await send(request, '/api/maps', { operationId: 'lore-battle-create', baseRevision: 0, id: 'battle-one', name: 'Vault', kind: 'battle', width: 40, height: 30 });
  await send(request, '/api/maps/battle-one/commands', { operationId: 'publish-battle', baseRevision: 1, command: 'publish' });
  await send(request, '/api/maps/lore-world/commands', { operationId: 'lore-pin-create', baseRevision: scene.revision, command: 'piece.put', piece: { id: 'archive-pin', kind: 'pin', label: 'Flooded entrance', x: 10, y: 12 } });
  await send(request, '/api/maps/lore-world/commands', { operationId: 'legacy-map-link', baseRevision: 2, command: 'link.put', pieceId: 'archive-pin', targetSceneId: 'battle-one', label: 'Submerged entrance' });
  await send(request, '/api/maps/lore-world/commands', { operationId: 'publish-lore-world', baseRevision: 3, command: 'publish' });
  // A published pin remains visible when its independently authorized Lore
  // destination is unavailable; the host omits every target field.
  assert.equal((await send(request, '/api/maps/lore-world/commands', { operationId: 'missing-lore-link', baseRevision: 4, command: 'lore-link.put', pieceId: 'archive-pin', targetLoreEntryId: 'missing-lore-entry' })).status, 404);
  const privateLink = { operationId: 'private-lore-link', baseRevision: 4, command: 'lore-link.put', pieceId: 'archive-pin', targetLoreEntryId: hiddenLore.id, label: 'Classified' };
  const beforeLinkCursor = (await json(await request('/api/state'))).revision;
  const privateReplay = new AbortController();
  const privateStream = await fetch(`${getBase()}/api/stream?since=${beforeLinkCursor}`, { headers: { authorization: `Bearer ${player}` }, signal: privateReplay.signal });
  assert.equal(privateStream.status, 200);
  const replayReader = privateStream.body.getReader();
  const privateResult = await send(request, '/api/maps/lore-world/commands', privateLink);
  assert.equal(privateResult.status, 200);
  assert.deepEqual(await json(await send(request, '/api/maps/lore-world/commands', privateLink)), await json(privateResult));
  assert.equal((await send(request, '/api/maps/lore-world/commands', { ...privateLink, operationId: 'player-lore-link' }, player)).status, 403);
  assert.equal((await request(`/api/lore/${hiddenLore.id}`, player)).status, 404);

  const privateProjection = JSON.stringify(await json(await request('/api/maps/lore-world', player)));
  for (const secret of [hiddenLore.id, 'PRIVATE SUNKEN ARCHIVE', 'GM-only archive coordinates', 'Classified']) assert.equal(privateProjection.includes(secret), false);
  const hiddenPinProjection = await json(await request('/api/maps/lore-world', player));
  assert.equal(hiddenPinProjection.pieces.length, 1);
  assert.equal(hiddenPinProjection.pieces[0].id, 'archive-pin');
  assert.equal('destination' in hiddenPinProjection.pieces[0], false);
  const privateState = JSON.stringify(await json(await request('/api/state?since=0', player)));
  for (const secret of [hiddenLore.id, 'PRIVATE SUNKEN ARCHIVE', 'GM-only archive coordinates']) assert.equal(privateState.includes(secret), false);
  let replayText = '';
  while (!replayText.includes('permissions.refresh')) {
    const { done, value } = await replayReader.read();
    assert.equal(done, false);
    replayText += new TextDecoder().decode(value);
  }
  privateReplay.abort();
  for (const secret of [hiddenLore.id, 'PRIVATE SUNKEN ARCHIVE', 'GM-only archive coordinates', 'archive-pin', 'lore-world', 'Classified']) assert.equal(replayText.includes(secret), false);

  await assertAuthorizedLifecycle(hiddenLore.id, 'publish', 'lore.published', 'publish-hidden-lore', 1);
  assert.equal((await request(`/api/lore/${hiddenLore.id}`, player)).status, 200);
  assert.deepEqual((await json(await request('/api/maps/lore-world', player))).pieces[0].destination, { kind: 'lore_entry', entryId: hiddenLore.id, title: 'PRIVATE SUNKEN ARCHIVE', label: 'Classified' });
  await assertOpaqueRefresh(hiddenLore.id, 'revoke', 'revoke-hidden-lore', 2, [hiddenLore.id, 'PRIVATE SUNKEN ARCHIVE', 'GM-only archive coordinates', 'archive-pin', 'lore-world']);
  assert.equal((await request(`/api/lore/${hiddenLore.id}`, player)).status, 404);
  assert.equal('destination' in (await json(await request('/api/maps/lore-world', player))).pieces[0], false);
  const updateLink = { operationId: 'public-lore-link', baseRevision: 5, command: 'lore-link.put', pieceId: 'archive-pin', targetLoreEntryId: publicLore.id, label: 'Read the records' };
  assert.equal((await send(request, '/api/maps/lore-world/commands', updateLink)).status, 200);
  assert.equal(JSON.stringify(await json(await request('/api/maps/lore-world', player))).includes(publicLore.id), false);
  await assertAuthorizedLifecycle(publicLore.id, 'publish', 'lore.published', 'publish-map-lore', 1);
  const visibleScene = await json(await request('/api/maps/lore-world', player));
  assert.deepEqual(visibleScene.pieces[0].destination, { kind: 'lore_entry', entryId: publicLore.id, title: 'Sunken Archive', label: 'Read the records' });
  assert.equal((await request(`/api/lore/${publicLore.id}`, player)).status, 200);

  await assertOpaqueRefresh(publicLore.id, 'revoke', 'revoke-map-lore', 2, [publicLore.id, 'Sunken Archive', 'archive-pin', 'lore-world']);
  const revokedProjection = JSON.stringify(await json(await request('/api/maps/lore-world', player)));
  for (const secret of [publicLore.id, 'Sunken Archive', 'Read the records']) assert.equal(revokedProjection.includes(secret), false);
  assert.equal((await request(`/api/lore/${publicLore.id}`, player)).status, 404);

  assert.equal((await send(request, '/api/maps/lore-world/commands', { operationId: 'change-lore-target', baseRevision: 6, command: 'lore-link.put', pieceId: 'archive-pin', targetLoreEntryId: anotherLore.id })).status, 200);
  await assertAuthorizedLifecycle(anotherLore.id, 'publish', 'lore.published', 'publish-annex', 1);
  await assertOpaqueRefresh(anotherLore.id, 'archive', 'archive-annex', 2, [anotherLore.id, 'Archive Annex', 'archive-pin', 'lore-world']);
  assert.equal((await request(`/api/lore/${anotherLore.id}`, player)).status, 404);
  const archivedProjection = JSON.stringify(await json(await request('/api/maps/lore-world', player)));
  assert.equal(archivedProjection.includes(anotherLore.id), false);
  await assertAuthorizedLifecycle(anotherLore.id, 'restore', 'lore.restored', 'restore-annex', 3);
  await restart();
  let afterRestart = await json(await request('/api/maps/lore-world', player));
  assert.equal(afterRestart.pieces[0].destination.entryId, anotherLore.id);
  assert.equal(afterRestart.pieces[0].destination.title, 'Archive Annex');
  assert.equal((await send(request, '/api/maps/lore-world/commands', { operationId: 'remove-lore-target', baseRevision: 7, command: 'lore-link.delete', pieceId: 'archive-pin' })).status, 200);
  afterRestart = await json(await request('/api/maps/lore-world', player));
  assert.equal('destination' in afterRestart.pieces[0], false);
  assert.equal((await send(request, '/api/maps/lore-world/commands', { operationId: 'switch-back-to-map', baseRevision: 8, command: 'link.put', pieceId: 'archive-pin', targetSceneId: 'battle-one', label: 'Submerged entrance' })).status, 200);
  afterRestart = await json(await request('/api/maps/lore-world', player));
  assert.deepEqual(afterRestart.pieces[0].destination, { kind: 'map_scene', sceneId: 'battle-one', name: 'Vault', label: 'Submerged entrance' });
  assert.equal((await send(request, '/api/maps/lore-world/commands', { operationId: 'stale-private-write', baseRevision: 2, command: 'lore-link.put', pieceId: 'archive-pin', targetLoreEntryId: anotherLore.id })).status, 409);
}));

