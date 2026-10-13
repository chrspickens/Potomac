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

