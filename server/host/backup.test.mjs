import assert from 'node:assert/strict';
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
    host.db.prepare("INSERT INTO members(id,display_name,credential_hash,created_at) VALUES(?,?,?,?)").run('member-1', 'Player', 'sha256:credential-hash', '2026-01-01T00:00:00.000Z');
    host.db.prepare("INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,owner_member_id) VALUES(?,?,?,?,?,?,?,?)")
      .run('actor-1', 'example.system-a', '0.1.0', 4, JSON.stringify({ schemaVersion: 1, name: 'Ash' }), '{}', 'player', 'member-1');
    host.db.prepare('INSERT INTO actor_grants(actor_id,member_id,can_read,can_act,granted_at) VALUES(?,?,?,?,?)').run('actor-1', 'member-1', 1, 1, '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO events(id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?)').run('event-1', 'actor-1', 'actor.created', 'public', '{}', '2026-01-01T00:00:00.000Z');
    host.db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('member-1', 'op-1', 'foundation-demo', 'hash', 'applied', null, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    exportCampaignBackup(sourcePath, backupPath, { now: new Date('2026-02-03T04:05:06.000Z') });
  } finally { host.close(); }

  const manifest = restoreCampaignBackup(backupPath, restoredPath);
  assert.equal(manifest.campaignId, 'foundation-demo');
  const restored = createHost({ databasePath: restoredPath });
  try {
    assert.equal(restored.db.prepare('SELECT revision FROM actors WHERE id=?').get('actor-1').revision, 4);
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
