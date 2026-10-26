// Focused Maps host acceptance: pnpm acceptance:maps
// Exercises the real HTTP boundary against a disposable SQLite database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHost } from '../server/host/index.mjs';
import { exportCampaignBackup, restoreCampaignBackup } from '../server/host/backup.mjs';

const directory = await mkdtemp(join(tmpdir(), 'potomac-maps-acceptance-'));
const databasePath = join(directory, 'host.sqlite');
const backupPath = join(directory, 'maps-backup.json');
const restoredPath = join(directory, 'restored.sqlite');
const gmToken = 'maps-acceptance-gm';
const hostOptions = { databasePath, gmToken, playerToken: 'maps-acceptance-legacy-player', seedDemo: false };
const root = resolve(import.meta.dirname, '..');
let host;
let baseUrl;

async function startHost(path = databasePath) {
  host = createHost({ ...hostOptions, databasePath: path });
  const address = await host.listen(0);
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function stopHost() {
  host?.close();
  host = undefined;
}

async function request(path, credential = gmToken, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  });
}

async function readJson(response) {
  return { status: response.status, body: await response.json() };
}

async function command(sceneId, operationId, baseRevision, commandName, fields = {}) {
  return readJson(await request(`/api/maps/${sceneId}/commands`, gmToken, {
    method: 'POST', body: JSON.stringify({ operationId, baseRevision, command: commandName, ...fields })
  }));
}

try {
  await startHost();

  const enrollA = await readJson(await request('/api/members/enroll', gmToken, {
    method: 'POST', body: JSON.stringify({ displayName: 'Maps Player A' })
  }));
  const enrollB = await readJson(await request('/api/members/enroll', gmToken, {
    method: 'POST', body: JSON.stringify({ displayName: 'Maps Player B' })
  }));
  assert.equal(enrollA.status, 201, 'player A enrolls on the disposable host');
  assert.equal(enrollB.status, 201, 'player B enrolls on the disposable host');
  const playerA = enrollA.body.credential;
  const playerB = enrollB.body.credential;

  const empty = await readJson(await request('/api/maps'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.maps, [], 'fresh host has no Maps');

  const worldInput = {
    operationId: 'maps-world-create', baseRevision: 0, id: 'acceptance-world',
    name: 'The Coast', kind: 'world', width: 1200, height: 800,
    grid: { type: 'none', size: 0 }, gmNotes: 'MAPS_GM_ONLY_WORLD_NOTE'
  };
  const worldCreated = await readJson(await request('/api/maps', gmToken, {
    method: 'POST', body: JSON.stringify(worldInput)
  }));
  assert.equal(worldCreated.status, 200);
  assert.equal(worldCreated.body.revision, 1);
  assert.deepEqual(await readJson(await request('/api/maps', gmToken, {
    method: 'POST', body: JSON.stringify(worldInput)
  })), worldCreated, 'identical create retry returns the original receipt');
  const conflictingRetry = await readJson(await request('/api/maps', gmToken, {
    method: 'POST', body: JSON.stringify({ ...worldInput, name: 'Different Coast' })
  }));
  assert.equal(conflictingRetry.status, 409, 'operation ID reuse with different content is rejected');

  const battleInput = {
    operationId: 'maps-battle-create', baseRevision: 0, id: 'acceptance-battle',
    name: 'The Tide Cavern', kind: 'battle', width: 40, height: 30,
    grid: { type: 'square', size: 5, units: 'ft' }, gmNotes: 'MAPS_GM_ONLY_BATTLE_NOTE'
  };
  const battleCreated = await readJson(await request('/api/maps', gmToken, {
    method: 'POST', body: JSON.stringify(battleInput)
  }));
  assert.equal(battleCreated.status, 200);
  assert.equal(battleCreated.body.revision, 1);

  const privateListBytes = await (await request('/api/maps', playerA)).text();
  assert.equal(JSON.parse(privateListBytes).maps.length, 0, 'players cannot list unpublished scenes');
  assert.ok(!privateListBytes.includes('acceptance-world') && !privateListBytes.includes('MAPS_GM_ONLY'), 'private map IDs and notes are absent from player HTTP bytes');
  const privateStateBytes = await (await request('/api/state', playerB)).text();
  assert.ok(!privateStateBytes.includes('acceptance-world') && !privateStateBytes.includes('acceptance-battle'), 'private maps are absent from player state');
  assert.ok(!privateStateBytes.includes('MAPS_GM_ONLY'), 'private map notes are absent from player state bytes');
  assert.equal((await request('/api/maps/acceptance-world', playerA)).status, 404, 'private scene lookup is hidden');

  const publishedWorld = await command('acceptance-world', 'maps-world-publish', 1, 'publish');
  assert.equal(publishedWorld.status, 200);
  const pinResult = await command('acceptance-world', 'maps-world-pin', 2, 'piece.put', {
    piece: { id: 'acceptance-destination-pin', kind: 'pin', x: 400, y: 250, label: 'Enter cavern' }
  });
  assert.equal(pinResult.status, 200);
  const linkResult = await command('acceptance-world', 'maps-world-link', 3, 'link.put', {
    pieceId: 'acceptance-destination-pin', targetSceneId: 'acceptance-battle', label: 'To the cavern'
  });
  assert.equal(linkResult.status, 200);
  const stale = await command('acceptance-world', 'maps-world-stale-update', 3, 'update', { name: 'Stale world title' });
  assert.equal(stale.status, 409, 'stale scene revision is rejected');
  assert.equal(stale.body.currentRevision, 4);

  const publishedBattle = await command('acceptance-battle', 'maps-battle-publish', 1, 'publish');
  assert.equal(publishedBattle.status, 200);
  const battlePin = await command('acceptance-battle', 'maps-battle-pin', 2, 'piece.put', {
    piece: { id: 'acceptance-battle-pin', kind: 'pin', x: 10, y: 12, label: 'Cavern entrance' }
  });
  assert.equal(battlePin.status, 200);

  const playerMaps = await readJson(await request('/api/maps', playerA));
  assert.equal(playerMaps.status, 200);
  assert.deepEqual(playerMaps.body.maps.map(map => map.id).sort(), ['acceptance-battle', 'acceptance-world']);
  const playerWorld = await readJson(await request('/api/maps/acceptance-world', playerA));
  assert.equal(playerWorld.status, 200);
  assert.equal(playerWorld.body.visibility, 'shared');
  assert.equal(Object.hasOwn(playerWorld.body, 'gmNotes'), false, 'shared player projection omits GM notes');
  assert.deepEqual(playerWorld.body.pieces[0].destination, { kind: 'map_scene', sceneId: 'acceptance-battle', name: 'The Tide Cavern', label: 'To the cavern' });
  assert.ok(!JSON.stringify(playerWorld.body).includes('MAPS_GM_ONLY'));
  const playerBattle = await readJson(await request('/api/maps/acceptance-battle', playerB));
  assert.equal(playerBattle.status, 200, 'player B independently receives shared battle projection');
  assert.ok(!JSON.stringify(playerBattle.body).includes('MAPS_GM_ONLY'));
  const playerReplayBytes = await (await request('/api/state?since=0', playerB)).text();
  assert.ok(playerReplayBytes.includes('acceptance-world') && playerReplayBytes.includes('acceptance-battle'), 'player replay includes currently shared map event references');
  assert.ok(!playerReplayBytes.includes('MAPS_GM_ONLY'), 'player event replay never contains GM map notes');

  const revoked = await command('acceptance-world', 'maps-world-revoke', 4, 'revoke');
  assert.equal(revoked.status, 200);
  const revokedMapBytes = await (await request('/api/maps', playerA)).text();
  assert.ok(!revokedMapBytes.includes('acceptance-world') && !revokedMapBytes.includes('Enter cavern'), 'revoked world and its pin disappear from player projections');
  assert.equal((await request('/api/maps/acceptance-world', playerA)).status, 404, 'revoked scene reads return not found');
  assert.equal((await request('/api/maps', playerB)).status, 200);
  assert.ok(!(await (await request('/api/maps', playerB)).text()).includes('acceptance-world'), 'second player also loses the revoked scene');

  const gmMapState = await readJson(await request('/api/maps', gmToken));
  assert.deepEqual(gmMapState.body.maps.map(map => map.id).sort(), ['acceptance-battle', 'acceptance-world']);
  assert.equal(gmMapState.body.maps.find(map => map.id === 'acceptance-world').visibility, 'gm', 'revocation is committed in host state');
  assert.equal(gmMapState.body.maps.find(map => map.id === 'acceptance-world').pieces[0].destination.sceneId, 'acceptance-battle', 'GM retains link and piece after revocation');

  stopHost();
  const manifest = exportCampaignBackup(databasePath, backupPath);
  assert.equal(manifest.potomacDataVersion, 9, 'Maps backup uses schema v9');
  assert.ok(manifest.includedCollections.includes('map_scenes'));
  assert.ok(manifest.includedCollections.includes('map_pieces'));
  assert.ok(manifest.includedCollections.includes('map_links'));
  restoreCampaignBackup(backupPath, restoredPath);
  const source = new DatabaseSync(databasePath, { readOnly: true });
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    for (const table of ['map_scenes', 'map_pieces', 'map_links', 'map_encounter_scenes', 'map_assets', 'map_operations']) {
      assert.equal(restored.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
        source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, `restored ${table} row count matches source`);
    }
    assert.deepEqual(
      restored.prepare('SELECT id,kind,revision,visibility FROM map_scenes ORDER BY id').all().map(row => ({ ...row })),
      source.prepare('SELECT id,kind,revision,visibility FROM map_scenes ORDER BY id').all().map(row => ({ ...row })),
      'scene identity, kind, revision, and publication state round-trip'
    );
    assert.deepEqual(
      restored.prepare('SELECT id,scene_id,kind,label,x,y,visible,revision FROM map_pieces ORDER BY id').all().map(row => ({ ...row })),
      source.prepare('SELECT id,scene_id,kind,label,x,y,visible,revision FROM map_pieces ORDER BY id').all().map(row => ({ ...row })),
      'pieces round-trip'
    );
    assert.deepEqual(
      restored.prepare('SELECT source_scene_id,target_scene_id,piece_id,label FROM map_links ORDER BY id').all().map(row => ({ ...row })),
      source.prepare('SELECT source_scene_id,target_scene_id,piece_id,label FROM map_links ORDER BY id').all().map(row => ({ ...row })),
      'scene links round-trip'
    );
  } finally {
    restored.close();
    source.close();
  }

  const tamperedPath = join(directory, 'tampered-backup.json');
  const tampered = JSON.parse(readFileSync(backupPath, 'utf8'));
  tampered.data.map_scenes[0].name = 'Tampered without integrity update';
  await import('node:fs/promises').then(({ writeFile }) => writeFile(tamperedPath, JSON.stringify(tampered)));
  assert.throws(() => restoreCampaignBackup(tamperedPath, join(directory, 'tampered.sqlite')), /integrity check failed/,
    'restore rejects a modified archive');

  // Start from the restored archive and prove projections still enforce current visibility.
  await startHost(restoredPath);
  const restoredGm = await readJson(await request('/api/maps', gmToken));
  assert.equal(restoredGm.status, 200);
  assert.equal(restoredGm.body.maps.find(map => map.id === 'acceptance-world').visibility, 'gm');
  const restoredPlayerBytes = await (await request('/api/maps', playerA)).text();
  assert.ok(!restoredPlayerBytes.includes('acceptance-world'), 'restored host keeps revoked map private to players');

  console.log('PASS: isolated host; World/Battle creation; publication and revocation privacy; map pieces and destination links; idempotent retries and conflicting operation IDs; stale revision conflict; player HTTP/state projections; schema v9 export/restore and tamper rejection.');
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  stopHost();
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
