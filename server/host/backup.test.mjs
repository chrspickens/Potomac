import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHost } from './index.mjs';
import { exportCampaignBackup, restoreCampaignBackup } from './backup.mjs';
import { loadTrustedV2Catalog } from './v2-catalog.mjs';
import { hashV2Json } from './v2-effects.mjs';

const withDirectory = async run => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-backup-'));
  try { await run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test('campaign backup round-trips Lore and asset bytes along with host tables', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), restoredPath = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('UPDATE campaign SET name=?,system_module_id=?,system_module_version=?,revision=? WHERE id=?').run('The Ashen Road','example.system-a','0.1.0',3,'foundation-demo');
    host.db.prepare("INSERT INTO members(id,display_name,credential_hash,created_at) VALUES(?,?,?,?)").run('member-1', 'Player', 'sha256:credential-hash', '2026-01-01T00:00:00.000Z');
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,owner_member_id) VALUES(?,?,?,?,?,?,?,?)")
      .run('actor-1', 'example.system-a', '0.1.0', 4, JSON.stringify({ schemaVersion: 1, name: 'Ash' }), '{}', 'player', 'member-1');
    host.db.prepare('INSERT INTO actor_grants(actor_id,member_id,can_read,can_act,granted_at) VALUES(?,?,?,?,?)').run('actor-1', 'member-1', 1, 1, '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run('ash-bridge','The Glass Bridge','A perilous crossing','active',4,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO encounter_participants(encounter_id,actor_id,initiative,status,activation_order) VALUES(?,?,?,?,?)')
      .run('ash-bridge','actor-1',15,'active',0);
    host.db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify({ activeEncounter: 'ash-bridge' }), 'foundation-demo');
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)').run('event-1', 'actor-1', 'actor.created', 'public', '{}', '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('member-1', 'op-1', 'foundation-demo', 'hash', 'applied', null, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,summary,body,gm_notes,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('lore-1','foundation-demo','Old Keep','A ruined fort','Details','GM secret','["ruin"]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO lore_links(id,campaign_id,source_id,target_kind,target_id,label,created_at) VALUES(?,?,?,?,?,?,?)').run('link-1','foundation-demo','lore-1','actor','actor-1','guardian','2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO sessions(id,campaign_id,encounter_id,status,revision,started_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('session-1','foundation-demo','ash-bridge','active',2,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z');
    host.db.prepare('UPDATE session_state SET current_session_id=?,revision=2 WHERE campaign_id=?').run('session-1','foundation-demo');
    host.db.prepare('INSERT INTO session_operations(operation_id,request_hash,principal_id,response) VALUES(?,?,?,?)').run('session-op-1','request-hash','gm','{"status":"applied"}');
    mkdirSync(`${sourcePath}.assets`, { recursive: true });
    const digest = createHash('sha256').update('image bytes').digest('hex');
    writeFileSync(`${sourcePath}.assets/${digest}`, Buffer.from('image bytes'));
    host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('asset-1','foundation-demo','lore-1','map.png','image/png',11,digest,'gm','2026-01-03T00:00:00.000Z');
    exportCampaignBackup(sourcePath, backupPath, { now: new Date('2026-02-03T04:05:06.000Z') });
  } finally { host.close(); }

  const manifest = restoreCampaignBackup(backupPath, restoredPath);
  assert.equal(manifest.campaignId, 'foundation-demo');
  assert.equal(manifest.potomacDataVersion, 5);
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  assert.equal(archive.schemaVersion, 5);
  assert.ok(manifest.includedCollections.includes('encounters'));
  assert.ok(manifest.includedCollections.includes('encounter_participants'));
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.equal(restored.db.prepare('SELECT revision FROM actors WHERE id=?').get('actor-1').revision, 4);
    assert.equal(restored.db.prepare('SELECT archived FROM actors WHERE id=?').get('actor-1').archived, 0);
    assert.deepEqual({ ...restored.db.prepare('SELECT name,system_module_id,system_module_version,revision FROM campaign WHERE id=?').get('foundation-demo') }, {
      name: 'The Ashen Road', system_module_id: 'example.system-a', system_module_version: '0.1.0', revision: 3
    });
    assert.deepEqual({ ...restored.db.prepare('SELECT name,visibility,gm_notes FROM encounters WHERE id=?').get('ash-bridge') }, { name: 'The Glass Bridge', visibility: 'public', gm_notes: '' });
    assert.equal(restored.db.prepare('SELECT status FROM encounters WHERE id=?').get('ash-bridge').status, 'active');
    assert.equal(restored.db.prepare('SELECT initiative FROM encounter_participants WHERE encounter_id=? AND actor_id=?').get('ash-bridge','actor-1').initiative, 15);
    assert.equal(JSON.parse(restored.db.prepare('SELECT context FROM campaign WHERE id=?').get('foundation-demo').context).activeEncounter, 'ash-bridge');
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM actor_grants').get().n, 1);
    assert.equal(restored.db.prepare('SELECT cursor FROM events WHERE id=?').get('event-1').cursor, 1);
    assert.equal(restored.db.prepare('SELECT credential_hash FROM members WHERE id=?').get('member-1').credential_hash, 'sha256:credential-hash');
    assert.equal(restored.db.prepare('SELECT title FROM lore_entries WHERE id=?').get('lore-1').title, 'Old Keep');
    assert.equal(restored.db.prepare('SELECT target_id FROM lore_links WHERE id=?').get('link-1').target_id, 'actor-1');
    assert.deepEqual({ ...restored.db.prepare('SELECT current_session_id,revision FROM session_state WHERE campaign_id=?').get('foundation-demo') }, { current_session_id: 'session-1', revision: 2 });
    assert.equal(restored.db.prepare('SELECT status FROM sessions WHERE id=?').get('session-1').status, 'active');
    assert.equal(restored.db.prepare('SELECT request_hash FROM session_operations WHERE operation_id=?').get('session-op-1').request_hash, 'request-hash');
    assert.deepEqual({ ...restored.db.prepare('SELECT original_name,media_type,byte_size,sha256,created_by FROM lore_assets WHERE id=?').get('asset-1') }, { original_name: 'map.png', media_type: 'image/png', byte_size: 11, sha256: createHashHex('image bytes'), created_by: 'gm' });
  } finally { restored.close(); }
  assert.equal(readFileSync(`${restoredPath}.assets/${createHashHex('image bytes')}`, 'utf8'), 'image bytes');
}));

test('v6 backup preserves the exact trusted V2 lock, authority epoch, ownership and receipts', async () => withDirectory(async directory => {
  const databasePath = join(directory, 'v2.sqlite'), backupPath = join(directory, 'v2.json'), restoredPath = join(directory, 'restored-v2.sqlite');
  let host = createHost({ databasePath, campaignId: 'backup-v2', enableV2Api: true });
  let address = await host.listen(0); let base = `http://127.0.0.1:${address.port}`;
  const req = (path, token = 'local-gm', body, method = 'GET', headers = {}) => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const enrolled = await (await req('/api/members/enroll', 'local-gm', { displayName: 'Player A' }, 'POST')).json();
    await req('/api/v2/campaign/lock', 'local-gm', { moduleId: 'example.starship.system' }, 'PUT');
    const lock = await (await req('/api/v2/campaign/lock')).json(); const proof = { 'x-v2-lock-digest': lock.digest };
    await req('/api/v2/entities', 'local-gm', { operationId: 'backup-create-entity', entityId: 'reactor', typeId: 'example.starship.reactor', visibility: 'owner', ownerPrincipalId: enrolled.memberId, data: { power: 40, safe: false, allocations: { propulsion: 0, lifeSupport: 0 }, engineeringLog: ['secret'] } }, 'POST', proof);
    const command = { operationId: 'backup-command', commandId: 'example.starship.reactor.allocate-power', entityId: 'reactor', expectedRevision: 1, input: { subsystem: 'propulsion', amount: 12 } };
    const committed = await (await req('/api/v2/commands', 'local-gm', command, 'POST', proof)).json();
    const assetBytes = Buffer.from('schema-v6 asset publication rollback'); const assetDigest = createHashHex(assetBytes);
    mkdirSync(`${databasePath}.assets`, { recursive: true }); writeFileSync(`${databasePath}.assets/${assetDigest}`, assetBytes);
    host.db.prepare("INSERT INTO lore_entries(id,campaign_id,type,title,created_at,updated_at) VALUES('backup-lore','backup-v2','note','Recovery attachment','now','now')").run();
    host.db.prepare("INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES('backup-asset','backup-v2','backup-lore','note.txt','text/plain',?,?, 'gm','now')").run(assetBytes.length, assetDigest);
    exportCampaignBackup(databasePath, backupPath);
    host.close(); host = undefined;
    const original = JSON.parse(readFileSync(backupPath, 'utf8'));
    const rejectMutation = (label, mutate, { recompute = true, options = {} } = {}) => {
      const tamperedPath = join(directory, `${label}.json`), destination = join(directory, `${label}.sqlite`);
      const archive = structuredClone(original); mutate(archive);
      if (recompute) archive.integrity.sha256 = archiveChecksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data });
      writeFileSync(tamperedPath, JSON.stringify(archive));
      assert.throws(() => restoreCampaignBackup(tamperedPath, destination, options), /Backup/ , `${label} rejected`);
      assert.equal(existsSync(destination), false, `${label} fails before destination publication`);
      assert.equal(existsSync(`${destination}.assets`), false, `${label} leaves no asset publication`);
    };
    rejectMutation('bad-root-digest', archive => { archive.data.v2_campaign_locks[0].root_module_digest = `sha256:${'0'.repeat(64)}`; });
    rejectMutation('bad-capability-closure', archive => {
      const lock = archive.manifest.v2.lock; lock.entries.pop();
      archive.data.v2_campaign_locks[0].lock_json = JSON.stringify(lock);
      archive.data.v2_campaign_locks[0].lock_digest = hashV2Json(lock);
      archive.data.v2_campaign_locks[0].root_module_digest = lock.rootModule.digest;
      archive.manifest.v2.lockDigest = hashV2Json(lock);
    });
    rejectMutation('bad-owner', archive => { archive.data.v2_extension_entities[0].owner_principal_id = 'missing-member'; });
    rejectMutation('bad-campaign-reference', archive => { archive.data.v2_extension_entities[0].campaign_id = 'other-campaign'; });
    rejectMutation('bad-authority-epoch', archive => { archive.data.v2_authority_versions[0].version = -1; archive.manifest.v2.authorityVersion = -1; });
    rejectMutation('bad-receipt-payload', archive => { archive.data.v2_extension_receipts[0].response = '{'; });
    rejectMutation('bad-event-payload', archive => { archive.data.v2_extension_events[0].payload = '{'; });
    rejectMutation('bad-checksum', archive => { archive.data.v2_campaign_locks[0].lock_digest = 'corrupt'; }, { recompute: false });
    const catalog = await loadTrustedV2Catalog();
    rejectMutation('missing-trusted-module', () => undefined, { options: { trustedCatalog: { byId: new Map() } } });
    const alteredProviders = new Map(catalog.byId);
    alteredProviders.set('example.starship.system', { ...alteredProviders.get('example.starship.system'), digest: `sha256:${'0'.repeat(64)}` });
    rejectMutation('altered-trusted-module', () => undefined, { options: { trustedCatalog: { byId: alteredProviders } } });
    for (const stage of ['after-validation', 'during-row-import', 'during-asset-publication', 'before-destination-publication']) {
      const destination = join(directory, `rollback-${stage}.sqlite`);
      assert.throws(() => restoreCampaignBackup(backupPath, destination, { onRestoreStage: current => { if (current === stage) throw new Error(`injected:${stage}`); } }), new RegExp(`injected:${stage}`));
      assert.equal(existsSync(destination), false, `${stage} leaves no database`);
      assert.equal(existsSync(`${destination}.assets`), false, `${stage} leaves no published assets`);
    }
    restoreCampaignBackup(backupPath, restoredPath);
    host = createHost({ databasePath: restoredPath, campaignId: 'backup-v2', enableV2Api: true });
    address = await host.listen(0); base = `http://127.0.0.1:${address.port}`;
    const restoredLock = await (await req('/api/v2/campaign/lock')).json();
    assert.equal(restoredLock.digest, lock.digest);
    const state = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.deepEqual(state.manifest.v2.lock, JSON.parse(state.data.v2_campaign_locks[0].lock_json));
    assert.equal(state.schemaVersion, 6); assert.equal(state.data.v2_extension_entities[0].owner_principal_id, enrolled.memberId);
    assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_extension_receipts WHERE operation_id=?').get('backup-command').n, 1);
    assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_receipts WHERE operation_id=?').get('backup-command').n, 1);
    assert.equal(host.db.prepare('SELECT version FROM v2_authority_versions WHERE campaign_id=?').get('backup-v2').version, state.manifest.v2.authorityVersion);
    const player = await (await req('/api/v2/entities/reactor', enrolled.credential, undefined, 'GET', { 'x-v2-lock-digest': lock.digest })).json();
    assert.equal('engineeringLog' in player.data, false, 'restored player projection continues to filter private fields');
    assert.deepEqual(await (await req('/api/v2/commands', 'local-gm', command, 'POST', proof)).json(), committed, 'exact retry after restore replays its committed receipt');
    assert.equal((await req('/api/v2/commands', 'local-gm', { ...command, input: { subsystem: 'propulsion', amount: 11 } }, 'POST', proof)).status, 409, 'altered retry remains a conflict after restore');
  } finally { host?.close(); }
}));

test('v5 backup round-trips World and Battle scenes, pieces, map links and managed image bytes', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'maps.json'), restoredPath = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(2,16); bytes.writeUInt32BE(3,20); const hash = createHashHex(bytes);
  try {
    mkdirSync(`${sourcePath}.assets`, { recursive: true }); writeFileSync(`${sourcePath}.assets/${hash}`, bytes);
    host.db.prepare("INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,background_id,created_at,updated_at) VALUES('world','foundation-demo','World','world',2,100,80,'{\"type\":\"none\",\"size\":0}','shared','map-image','now','now')").run();
    host.db.prepare("INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,created_at,updated_at) VALUES('battle','foundation-demo','Battle','battle',1,30,20,'{\"type\":\"square\",\"size\":5}','gm','now','now')").run();
    host.db.prepare("INSERT INTO map_pieces(id,scene_id,kind,label,x,y) VALUES('pin','world','pin','stairs',4,5)").run();
    host.db.prepare("INSERT INTO map_pieces(id,scene_id,kind,label,x,y) VALUES('lore-pin','world','pin','archive',6,7)").run();
    host.db.prepare("INSERT INTO map_links(id,campaign_id,source_scene_id,target_scene_id,piece_id,label) VALUES('link','foundation-demo','world','battle','pin','down')").run();
    host.db.prepare("INSERT INTO lore_entries(id,campaign_id,type,title,summary,body,gm_notes,tags,revision,archived,published,visibility,created_at,updated_at) VALUES('lore-archive','foundation-demo','location','Sunken Archive','','Public record','Private note','[]',3,0,1,'shared','now','now')").run();
    host.db.prepare("INSERT INTO map_lore_links(id,campaign_id,source_scene_id,target_lore_entry_id,piece_id,label) VALUES('lore-link','foundation-demo','world','lore-archive','lore-pin','Read records')").run();
    host.db.prepare("INSERT INTO map_assets(id,campaign_id,scene_id,original_name,media_type,byte_size,sha256,created_at) VALUES('map-image','foundation-demo','world','world.png','image/png',?,?, 'now')").run(bytes.length, hash);
    // A safely named orphan must not enter the archive.
    const orphanBytes = Buffer.from('unreferenced map image');
    const orphanHash = createHashHex(orphanBytes);
    writeFileSync(`${sourcePath}.assets/${orphanHash}`, orphanBytes);
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  assert.deepEqual(archive.data.assets.map(asset => asset.sha256), [hash]);
  assert.equal(archive.schemaVersion, 5);
  restoreCampaignBackup(backupPath, restoredPath);
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.deepEqual({ ...restored.db.prepare('SELECT kind,background_id FROM map_scenes WHERE id=?').get('world') }, { kind: 'world', background_id: 'map-image' });
    assert.equal(restored.db.prepare('SELECT target_scene_id FROM map_links WHERE id=?').get('link').target_scene_id, 'battle');
    assert.deepEqual({ ...restored.db.prepare('SELECT target_lore_entry_id,label FROM map_lore_links WHERE id=?').get('lore-link') }, { target_lore_entry_id: 'lore-archive', label: 'Read records' });
    assert.equal(restored.db.prepare('SELECT sha256 FROM map_assets WHERE id=?').get('map-image').sha256, hash);
  } finally { restored.close(); }
  assert.deepEqual(readFileSync(`${restoredPath}.assets/${hash}`), bytes);
}));

test('v5 restore accepts the previously published collection layout without map Lore links', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'current-v5.json'), legacyPath = join(directory, 'legacy-v5.json'), restoredPath = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare("INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,created_at,updated_at) VALUES('world','foundation-demo','World','world',1,10,10,'{\"type\":\"none\",\"size\":0}','gm','now','now')").run();
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  delete archive.data.map_lore_links;
  archive.manifest.includedCollections = archive.manifest.includedCollections.filter(name => name !== 'map_lore_links');
  archive.integrity = { algorithm: 'sha256', sha256: archiveChecksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) };
  writeFileSync(legacyPath, JSON.stringify(archive));
  restoreCampaignBackup(legacyPath, restoredPath);
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS count FROM map_lore_links').get().count, 0);
    assert.equal(restored.db.prepare('SELECT id FROM map_scenes WHERE id=?').get('world').id, 'world');
  } finally { restored.close(); }
}));

test('v5 export deduplicates an asset shared by Lore and a map and rejects damaged map bytes', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), archivePath = join(directory, 'shared.json');
  const host = createHost({ databasePath: sourcePath });
  const bytes = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(2,16); bytes.writeUInt32BE(3,20);
  const hash = createHashHex(bytes);
  try {
    mkdirSync(`${sourcePath}.assets`, { recursive: true });
    writeFileSync(`${sourcePath}.assets/${hash}`, bytes);
    host.db.prepare("INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES('lore-map','foundation-demo','Shared image','now','now')").run();
    host.db.prepare("INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES('lore-image','foundation-demo','lore-map','world.png','image/png',?,?, 'gm','now')").run(bytes.length,hash);
    host.db.prepare("INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,background_id,created_at,updated_at) VALUES('world','foundation-demo','World','world',1,100,80,'{\"type\":\"none\",\"size\":0}','shared','map-image','now','now')").run();
    host.db.prepare("INSERT INTO map_assets(id,campaign_id,scene_id,original_name,media_type,byte_size,sha256,created_at) VALUES('map-image','foundation-demo','world','world.png','image/png',?,?, 'now')").run(bytes.length,hash);
    exportCampaignBackup(sourcePath, archivePath);
    const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
    assert.deepEqual(archive.data.assets.map(asset => asset.sha256), [hash]);
    writeFileSync(`${sourcePath}.assets/${hash}`, Buffer.from('corrupt'));
    assert.throws(() => exportCampaignBackup(sourcePath, join(directory,'corrupt.json')), /asset .*failed validation/);
    assert.equal(existsSync(join(directory,'corrupt.json')), false);
    rmSync(`${sourcePath}.assets/${hash}`);
    assert.throws(() => exportCampaignBackup(sourcePath, join(directory,'missing.json')), /referenced asset .*missing/);
  } finally { host.close(); }
}));

test('PR #45 v3 archives retain sessions and privacy fields on restore', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,legacy_shared,archived) VALUES('archived-actor','example.system-a','0.1.0',2,'{}','{}','player',1,1)").run();
    host.db.prepare("INSERT INTO encounters(id,name,created_at,updated_at,visibility,gm_notes) VALUES('private-encounter','Hidden','now','now','gm','secret')").run();
    host.db.prepare("INSERT INTO sessions(id,campaign_id,encounter_id,status,revision,started_at,updated_at) VALUES('private-session','foundation-demo','private-encounter','active',1,'now','now')").run();
    host.db.prepare("UPDATE session_state SET current_session_id='private-session',revision=1 WHERE campaign_id='foundation-demo'").run();
    host.db.prepare("INSERT INTO session_operations(operation_id,request_hash,principal_id,response) VALUES('session-op','hash','gm','{}')").run();
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  archive.schemaVersion = 3;
  for (const key of ['map_scenes','map_pieces','map_links','map_lore_links','map_encounter_scenes','map_assets','map_operations']) delete archive.data[key];
  archive.manifest.potomacDataVersion = 3;
  archive.manifest.includedCollections = ['campaign','modules','actors','encounters','encounter_participants','members','actor_grants','events','operations','offline_receipts','offline_proposals','offline_decisions','sessions','session_state','session_operations'];
  for (const table of ['lore_entries','lore_operations','lore_links','lore_assets','assets']) delete archive.data[table];
  delete archive.integrity;
  archive.integrity = { algorithm: 'sha256', sha256: archiveChecksum({ format: archive.format, schemaVersion: 3, manifest: archive.manifest, data: archive.data }) };
  writeFileSync(backupPath, JSON.stringify(archive));
  restoreCampaignBackup(backupPath, destination);
  const restored = createHost({ databasePath: destination });
  try {
    assert.equal(restored.db.prepare('SELECT current_session_id FROM session_state WHERE campaign_id=?').get('foundation-demo').current_session_id, 'private-session');
    assert.deepEqual({ ...restored.db.prepare('SELECT archived,legacy_shared FROM actors WHERE id=?').get('archived-actor') }, { archived: 1, legacy_shared: 1 });
    assert.equal(restored.db.prepare('SELECT visibility FROM encounters WHERE id=?').get('private-encounter').visibility, 'gm');
    assert.equal(restored.db.prepare('SELECT gm_notes FROM encounters WHERE id=?').get('private-encounter').gm_notes, 'secret');
    assert.equal(restored.db.prepare('SELECT request_hash FROM session_operations WHERE operation_id=?').get('session-op').request_hash, 'hash');
  } finally { restored.close(); }
}));

function createHashHex(value) { return createHash('sha256').update(value).digest('hex'); }

const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const archiveChecksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

test('pre-Lore v2 campaign backups restore without synthesizing Lore records', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try { exportCampaignBackup(sourcePath, backupPath); } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  for (const name of ['lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations', 'assets','map_scenes','map_pieces','map_links','map_lore_links','map_encounter_scenes','map_assets','map_operations']) delete archive.data[name];
  archive.schemaVersion = 2;
  archive.manifest.potomacDataVersion = 2;
  archive.manifest.includedCollections = archive.manifest.includedCollections.filter(name => !['lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations', 'assets','map_scenes','map_pieces','map_links','map_lore_links','map_encounter_scenes','map_assets','map_operations'].includes(name));
  for (const key of ['lore_entries','lore_operations','lore_links','lore_assets','sessions','session_state','session_operations','assets','map_scenes','map_pieces','map_links','map_lore_links','map_encounter_scenes','map_assets','map_operations']) delete archive.data[key];
  delete archive.integrity;
  archive.integrity = { algorithm: 'sha256', sha256: archiveChecksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) };
  writeFileSync(backupPath, JSON.stringify(archive));
  restoreCampaignBackup(backupPath, destination);
  const restored = createHost({ databasePath: destination });
  try { assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM lore_entries').get().n, 0); }
  finally { restored.close(); }
}));

test('historical Lore v3 layout restores Lore records and attached assets', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('lore-v3','foundation-demo','V3 note','now','now');
    const bytes = Buffer.from('v3 image object');
    const digest = createHashHex(bytes);
    mkdirSync(`${sourcePath}.assets`, { recursive: true }); writeFileSync(`${sourcePath}.assets/${digest}`, bytes);
    host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('asset-v3','foundation-demo','lore-v3','v3.png','image/png',bytes.length,digest,'gm','now');
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  archive.schemaVersion = 3; archive.manifest.potomacDataVersion = 3;
  for (const key of ['map_scenes','map_pieces','map_links','map_lore_links','map_encounter_scenes','map_assets','map_operations']) delete archive.data[key];
  archive.manifest.includedCollections = ['campaign','modules','actors','encounters','encounter_participants','members','actor_grants','events','operations','offline_receipts','offline_proposals','offline_decisions','lore_entries','lore_operations','lore_links','assets'];
  delete archive.data.lore_assets; delete archive.data.sessions; delete archive.data.session_state; delete archive.data.session_operations;
  delete archive.integrity;
  archive.integrity = { algorithm: 'sha256', sha256: archiveChecksum({ format: archive.format, schemaVersion: 3, manifest: archive.manifest, data: archive.data }) };
  writeFileSync(backupPath, JSON.stringify(archive));
  restoreCampaignBackup(backupPath, destination);
  const restored = createHost({ databasePath: destination });
  try { assert.equal(restored.db.prepare('SELECT title FROM lore_entries WHERE id=?').get('lore-v3').title, 'V3 note'); }
  finally { restored.close(); }
  assert.equal(readFileSync(`${destination}.assets/${createHashHex(Buffer.from('v3 image object'))}`, 'utf8'), 'v3 image object');
}));

test('a halfway asset restore failure leaves the database and asset destination untouched', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('lore-fail','foundation-demo','Assets','now','now');
    mkdirSync(`${sourcePath}.assets`, { recursive: true });
    for (const text of ['first bytes','second bytes']) {
      const bytes = Buffer.from(text), digest = createHashHex(bytes);
      writeFileSync(`${sourcePath}.assets/${digest}`, bytes);
      host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`asset-${text[0]}`,'foundation-demo','lore-fail',`${text[0]}.bin`,'application/octet-stream',bytes.length,digest,'gm','now');
    }
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const emptyDestination = new DatabaseSync(destination); emptyDestination.close();
  const originalDestination = readFileSync(destination);
  mkdirSync(`${destination}.assets`);
  let writes = 0;
  assert.throws(() => restoreCampaignBackup(backupPath, destination, { assetWriter(path, bytes, options) {
    if (++writes === 2) throw new Error('injected halfway attachment failure');
    writeFileSync(path, bytes, options);
  } }), /injected halfway attachment failure/);
  assert.deepEqual(readFileSync(destination), originalDestination);
  assert.deepEqual(readdirSync(`${destination}.assets`), []);
}));

test('v4 restore rejects missing and extra asset objects with valid archive digests', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('lore-assets','foundation-demo','Assets','now','now');
    const bytes = Buffer.from('referenced bytes'), digest = createHashHex(bytes);
    mkdirSync(`${sourcePath}.assets`, { recursive: true }); writeFileSync(`${sourcePath}.assets/${digest}`, bytes);
    host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('asset-ref','foundation-demo','lore-assets','ref.bin','application/octet-stream',bytes.length,digest,'gm','now');
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const original = JSON.parse(readFileSync(backupPath, 'utf8'));
  for (const mutate of [archive => { archive.data.assets = []; }, archive => {
    const bytes = Buffer.from('unreferenced'), sha256 = createHashHex(bytes);
    archive.data.assets.push({ sha256, size: bytes.length, bytes: bytes.toString('base64') });
  }]) {
    const invalid = structuredClone(original); mutate(invalid);
    invalid.integrity.sha256 = archiveChecksum({ format: invalid.format, schemaVersion: invalid.schemaVersion, manifest: invalid.manifest, data: invalid.data });
    writeFileSync(backupPath, JSON.stringify(invalid));
    assert.throws(() => restoreCampaignBackup(backupPath, destination), /asset (objects do not match|references unavailable)/);
    assert.equal(exists(destination), false);
  }
}));

test('backup alteration and unsupported schemas fail before touching destination', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try { exportCampaignBackup(sourcePath, backupPath); } finally { host.close(); }
  const original = JSON.parse(readFileSync(backupPath, 'utf8'));
  const corrupt = structuredClone(original); corrupt.data.campaign[0].context = '{"tampered":true}';
  writeFileSync(backupPath, JSON.stringify(corrupt));
  assert.throws(() => restoreCampaignBackup(backupPath, destination), /integrity check failed/);
  assert.equal(exists(destination), false);
  const unsupported = structuredClone(original); unsupported.schemaVersion = 99;
  writeFileSync(backupPath, JSON.stringify(unsupported));
  assert.throws(() => restoreCampaignBackup(backupPath, destination), /unsupported/);
  assert.equal(exists(destination), false);
}));

test('Lore and asset archive tampering is rejected before restoring', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('lore-x','foundation-demo','Entry','now','now');
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const archive = JSON.parse(readFileSync(backupPath, 'utf8'));
  archive.data.lore_entries[0].title = 'Altered';
  writeFileSync(backupPath, JSON.stringify(archive));
  assert.throws(() => restoreCampaignBackup(backupPath, destination), /integrity check failed/);
  assert.equal(exists(destination), false);
}));

test('restore refuses non-empty destinations and does not alter their contents', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'occupied.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try { exportCampaignBackup(sourcePath, backupPath); } finally { host.close(); }
  writeFileSync(destination, 'preserve this file');
  assert.throws(() => restoreCampaignBackup(backupPath, destination), /destination is not empty/);
  assert.equal(readFileSync(destination, 'utf8'), 'preserve this file');
}));

test('restore fails on unavailable module versions and invalid references', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), destination = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data) VALUES(?,?,?,?,?)").run('actor-1', 'system-a', '0.0.0', 1, '{}');
    assert.throws(() => exportCampaignBackup(sourcePath, backupPath), /required module system-a@0.0.0 is unavailable/);
  } finally { host.close(); }
}));

function exists(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

test('backup rejects missing participants and pinned modules even after an integrity-valid export', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'backup.json'), dest = join(directory, 'dest.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('UPDATE campaign SET name=?,system_module_id=?,system_module_version=? WHERE id=?')
      .run('Pinned','example.system-a','0.1.0','foundation-demo');
    exportCampaignBackup(sourcePath, backupPath);
  } finally { host.close(); }
  const original = JSON.parse(readFileSync(backupPath, 'utf8'));
  const invalidPin = structuredClone(original);
  invalidPin.data.campaign[0].system_module_version = 'missing';
  // The archive digest rejects any modification even before semantic validation.
  writeFileSync(backupPath, JSON.stringify(invalidPin));
  assert.throws(() => restoreCampaignBackup(backupPath, dest), /integrity check failed/);
  assert.equal(exists(dest), false);
}));

test('v5 export includes only referenced Lore asset bytes and ignores safe orphan objects', async () => withDirectory(async directory => {
  const dbPath = join(directory, 'host.sqlite'), archivePath = join(directory, 'archive.json');
  const host = createHost({ databasePath: dbPath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('article','foundation-demo','Article','now','now');
    const bytes = Buffer.from('referenced bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const orphan = Buffer.from('orphaned but safely named bytes');
    const orphanHash = createHash('sha256').update(orphan).digest('hex');
    mkdirSync(`${dbPath}.assets`, { recursive: true });
    writeFileSync(`${dbPath}.assets/${hash}`, bytes);
    writeFileSync(`${dbPath}.assets/${orphanHash}`, orphan);
    host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('asset-1','foundation-demo','article','reference.png','image/png',bytes.length,hash,'gm','now');
    const manifest = exportCampaignBackup(dbPath, archivePath);
    assert.equal(manifest.potomacDataVersion, 5);
    const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
    assert.deepEqual(archive.data.assets.map(asset => asset.sha256), [hash]);
    assert.equal(archive.data.assets[0].bytes, bytes.toString('base64'));
  } finally { host.close(); }
}));

test('v5 export fails rather than omitting a referenced missing or modified Lore asset', async () => withDirectory(async directory => {
  const dbPath = join(directory, 'host.sqlite'), archivePath = join(directory, 'archive.json');
  const host = createHost({ databasePath: dbPath });
  try {
    host.db.prepare('INSERT INTO lore_entries(id,campaign_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('article','foundation-demo','Article','now','now');
    const bytes = Buffer.from('correct bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    host.db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('asset-1','foundation-demo','article','reference.png','image/png',bytes.length,hash,'gm','now');
    assert.throws(() => exportCampaignBackup(dbPath, archivePath), /referenced asset .* missing or unsafe/);
    assert.equal(exists(archivePath), false);
    mkdirSync(`${dbPath}.assets`, { recursive: true });
    writeFileSync(`${dbPath}.assets/${hash}`, 'tampered bytes');
    assert.throws(() => exportCampaignBackup(dbPath, archivePath), /asset .* failed validation/);
    assert.equal(exists(archivePath), false);
  } finally { host.close(); }
}));
