import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHost } from './index.mjs';
import { exportCampaignBackup, restoreCampaignBackup } from './backup.mjs';

const withDirectory = async run => {
  const directory = mkdtempSync(join(tmpdir(), 'potomac-backup-'));
  try { await run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test('campaign backup round-trips host tables and remains usable by host authorization', async () => withDirectory(async directory => {
  const sourcePath = join(directory, 'source.sqlite'), backupPath = join(directory, 'campaign.json'), restoredPath = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: sourcePath });
  try {
    host.db.prepare('UPDATE campaign SET name=?,system_module_id=?,system_module_version=?,revision=? WHERE id=?').run('The Ashen Road','example.system-a','0.1.0',3,'foundation-demo');
    host.db.prepare("INSERT INTO members(id,display_name,credential_hash,created_at) VALUES(?,?,?,?)").run('member-1', 'Player', 'sha256:credential-hash', '2026-01-01T00:00:00.000Z');
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,owner_member_id,archived) VALUES(?,?,?,?,?,?,?,?,?)")
      .run('actor-1', 'example.system-a', '0.1.0', 4, JSON.stringify({ schemaVersion: 1, name: 'Ash' }), '{}', 'player', 'member-1', 1);
    host.db.prepare('INSERT INTO actor_grants(actor_id,member_id,can_read,can_act,granted_at) VALUES(?,?,?,?,?)').run('actor-1', 'member-1', 1, 1, '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('ash-bridge','The Glass Bridge','A perilous crossing','active',4,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','gm','Private encounter preparation');
    host.db.prepare('INSERT INTO encounter_participants(encounter_id,actor_id,initiative,status,activation_order) VALUES(?,?,?,?,?)')
      .run('ash-bridge','actor-1',15,'active',0);
    host.db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify({ activeEncounter: 'ash-bridge' }), 'foundation-demo');
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)').run('event-1', 'actor-1', 'actor.created', 'public', '{}', '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('member-1', 'op-1', 'foundation-demo', 'hash', 'applied', null, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO sessions(id,campaign_id,encounter_id,status,revision,started_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('session-1','foundation-demo','ash-bridge','paused',2,'2026-01-01T00:00:00.000Z','2026-01-01T00:01:00.000Z',null);
    host.db.prepare('UPDATE session_state SET current_session_id=?,revision=? WHERE campaign_id=?').run('session-1',2,'foundation-demo');
    host.db.prepare('INSERT INTO session_operations(operation_id,request_hash,principal_id,response) VALUES(?,?,?,?)')
      .run('session-op-1','session-command-hash','gm',JSON.stringify({ sessionId:'session-1', status:'applied' }));
    exportCampaignBackup(sourcePath, backupPath, { now: new Date('2026-02-03T04:05:06.000Z') });
  } finally { host.close(); }

  const manifest = restoreCampaignBackup(backupPath, restoredPath);
  assert.equal(manifest.campaignId, 'foundation-demo');
  assert.equal(manifest.potomacDataVersion, 3);
  assert.ok(manifest.includedCollections.includes('sessions'));
  assert.ok(manifest.includedCollections.includes('session_state'));
  assert.ok(manifest.includedCollections.includes('session_operations'));
  assert.ok(manifest.includedCollections.includes('encounters'));
  assert.ok(manifest.includedCollections.includes('encounter_participants'));
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.equal(restored.db.prepare('SELECT revision FROM actors WHERE id=?').get('actor-1').revision, 4);
    assert.equal(restored.db.prepare('SELECT archived FROM actors WHERE id=?').get('actor-1').archived, 1);
    assert.deepEqual({ ...restored.db.prepare('SELECT visibility,gm_notes FROM encounters WHERE id=?').get('ash-bridge') }, {
      visibility: 'gm', gm_notes: 'Private encounter preparation'
    });
    assert.deepEqual({ ...restored.db.prepare('SELECT encounter_id,status,revision FROM sessions WHERE id=?').get('session-1') },
      { encounter_id: 'ash-bridge', status: 'paused', revision: 2 });
    assert.equal(restored.db.prepare('SELECT current_session_id FROM session_state WHERE campaign_id=?').get('foundation-demo').current_session_id, 'session-1');
    assert.equal(restored.db.prepare('SELECT principal_id FROM session_operations WHERE operation_id=?').get('session-op-1').principal_id, 'gm');
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
  } finally { restored.close(); }
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

test('version 2 backups remain readable; absent newer fields receive explicit safe defaults', async () => withDirectory(async directory => {
  const source = join(directory, 'source.sqlite'), v3Path = join(directory, 'v3.json'),
    v2Path = join(directory, 'v2.json'), target = join(directory, 'restored.sqlite');
  const host = createHost({ databasePath: source });
  try {
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data,archived) VALUES(?,?,?,?,?,?)")
      .run('older-actor','example.system-a','0.1.0',1,'{}',0);
    exportCampaignBackup(source, v3Path);
  } finally { host.close(); }
  const original = JSON.parse(readFileSync(v3Path, 'utf8'));
  const older = structuredClone(original);
  older.schemaVersion = 2;
  older.manifest.potomacDataVersion = 2;
  for (const collection of ['sessions','session_state','session_operations']) {
    delete older.data[collection];
    older.manifest.includedCollections = older.manifest.includedCollections.filter(item => item !== collection);
  }
  for (const row of older.data.actors) delete row.archived;
  for (const row of older.data.encounters) { delete row.visibility; delete row.gm_notes; }
  const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
  older.integrity.sha256 = createHash('sha256').update(JSON.stringify(canonicalize({
    format: older.format, schemaVersion: older.schemaVersion, manifest: older.manifest, data: older.data
  }))).digest('hex');
  writeFileSync(v2Path, JSON.stringify(older));
  const manifest = restoreCampaignBackup(v2Path, target);
  assert.equal(manifest.potomacDataVersion, 2);
  const restored = createHost({ databasePath: target });
  try {
    assert.equal(restored.db.prepare('SELECT archived FROM actors WHERE id=?').get('older-actor').archived, 0);
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(restored.db.prepare('SELECT current_session_id FROM session_state').get().current_session_id, null);
  } finally { restored.close(); }
}));

test('backup rejects integrity-valid archives with broken session references before destination mutation', async () => withDirectory(async directory => {
  const source = join(directory, 'source.sqlite'), backup = join(directory, 'backup.json'), target = join(directory, 'dest.sqlite');
  const host = createHost({ databasePath: source });
  try { exportCampaignBackup(source, backup); } finally { host.close(); }
  const original = JSON.parse(readFileSync(backup, 'utf8'));
  original.data.session_state[0].current_session_id = 'missing-session';
  const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
  original.integrity.sha256 = createHash('sha256').update(JSON.stringify(canonicalize({
    format: original.format, schemaVersion: original.schemaVersion, manifest: original.manifest, data: original.data
  }))).digest('hex');
  writeFileSync(backup, JSON.stringify(original));
  assert.throws(() => restoreCampaignBackup(backup, target), /current session reference is invalid/);
  assert.equal(exists(target), false);
}));
