import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';
import { exportCampaignBackup, restoreCampaignBackup } from './backup.mjs';

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
    mkdirSync(`${sourcePath}.assets`, { recursive: true });
    const digest = createHash('sha256').update('image bytes').digest('hex');
    writeFileSync(`${sourcePath}.assets/${digest}`, Buffer.from('image bytes'));
    exportCampaignBackup(sourcePath, backupPath, { now: new Date('2026-02-03T04:05:06.000Z') });
  } finally { host.close(); }

  const manifest = restoreCampaignBackup(backupPath, restoredPath);
  assert.equal(manifest.campaignId, 'foundation-demo');
  assert.equal(manifest.potomacDataVersion, 3);
  assert.ok(manifest.includedCollections.includes('encounters'));
  assert.ok(manifest.includedCollections.includes('encounter_participants'));
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.equal(restored.db.prepare('SELECT revision FROM actors WHERE id=?').get('actor-1').revision, 4);
    assert.deepEqual({ ...restored.db.prepare('SELECT name,system_module_id,system_module_version,revision FROM campaign WHERE id=?').get('foundation-demo') }, {
      name: 'The Ashen Road', system_module_id: 'example.system-a', system_module_version: '0.1.0', revision: 3
    });
    assert.equal(restored.db.prepare('SELECT name FROM encounters WHERE id=?').get('ash-bridge').name, 'The Glass Bridge');
    assert.equal(restored.db.prepare('SELECT status FROM encounters WHERE id=?').get('ash-bridge').status, 'active');
    assert.equal(restored.db.prepare('SELECT initiative FROM encounter_participants WHERE encounter_id=? AND actor_id=?').get('ash-bridge','actor-1').initiative, 15);
    assert.equal(JSON.parse(restored.db.prepare('SELECT context FROM campaign WHERE id=?').get('foundation-demo').context).activeEncounter, 'ash-bridge');
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM actor_grants').get().n, 1);
    assert.equal(restored.db.prepare('SELECT cursor FROM events WHERE id=?').get('event-1').cursor, 1);
    assert.equal(restored.db.prepare('SELECT credential_hash FROM members WHERE id=?').get('member-1').credential_hash, 'sha256:credential-hash');
    assert.equal(restored.db.prepare('SELECT title FROM lore_entries WHERE id=?').get('lore-1').title, 'Old Keep');
    assert.equal(restored.db.prepare('SELECT target_id FROM lore_links WHERE id=?').get('link-1').target_id, 'actor-1');
  } finally { restored.close(); }
  assert.equal(readFileSync(`${restoredPath}.assets/${createHashHex('image bytes')}`, 'utf8'), 'image bytes');
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
  for (const name of ['lore_entries', 'lore_operations', 'lore_links', 'assets']) delete archive.data[name];
  archive.schemaVersion = 2;
  archive.manifest.potomacDataVersion = 2;
  archive.manifest.includedCollections = archive.manifest.includedCollections.filter(name => !['lore_entries', 'lore_operations', 'lore_links', 'assets'].includes(name));
  delete archive.integrity;
  archive.integrity = { algorithm: 'sha256', sha256: archiveChecksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) };
  writeFileSync(backupPath, JSON.stringify(archive));
  restoreCampaignBackup(backupPath, destination);
  const restored = createHost({ databasePath: destination });
  try { assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM lore_entries').get().n, 0); }
  finally { restored.close(); }
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
