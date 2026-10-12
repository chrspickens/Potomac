import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 1;
const COLLECTIONS = ['campaign', 'modules', 'actors', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const TABLES = {
  campaign: ['id', 'context'], modules: ['id', 'version', 'manifest'],
  actors: ['id', 'module_id', 'module_version', 'revision', 'data', 'visibility', 'owner_role', 'owner_member_id', 'legacy_shared'],
  members: ['id', 'display_name', 'credential_hash', 'created_at', 'revoked_at'],
  actor_grants: ['actor_id', 'member_id', 'can_read', 'can_act', 'granted_at'],
  events: ['cursor', 'id', 'operation_id', 'actor_id', 'kind', 'visibility', 'payload', 'created_at'],
  operations: ['id', 'response', 'actor_id', 'action_id', 'request_hash', 'principal_id'],
  offline_receipts: ['member_id', 'operation_id', 'campaign_id', 'request_hash', 'status', 'proposal_id', 'response', 'created_at', 'updated_at'],
  offline_proposals: ['id', 'operation_id', 'member_id', 'actor_id', 'action_id', 'request_hash', 'request', 'campaign_id', 'base_revision', 'rule_version', 'status', 'created_at', 'decided_at', 'decision_id', 'decision', 'decision_response'],
  offline_decisions: ['decision_id', 'proposal_id', 'request_hash', 'response', 'created_at']
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };

function validateArchive(archive, modulesDirectory) {
  if (!archive || archive.format !== BACKUP_FORMAT || archive.schemaVersion !== BACKUP_SCHEMA_VERSION) fail('format or schema version is unsupported');
  if (!archive.manifest || archive.manifest.potomacDataVersion !== 1 || typeof archive.manifest.campaignId !== 'string' || !archive.manifest.campaignId || !Array.isArray(archive.manifest.modules) || !Array.isArray(archive.manifest.includedCollections)) fail('manifest is invalid');
  if (!archive.data || checksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) !== archive.integrity?.sha256) fail('integrity check failed');
  if (JSON.stringify([...archive.manifest.includedCollections].sort()) !== JSON.stringify([...COLLECTIONS].sort())) fail('collection manifest is incomplete');
  for (const collection of COLLECTIONS) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  if (archive.data.campaign.length !== 1 || archive.data.campaign[0].id !== archive.manifest.campaignId) fail('campaign metadata does not match manifest');
  const modules = new Map(archive.data.modules.map(row => [`${row.id}@${row.version}`, row]));
  const declared = [...modules.keys()].sort();
  if (JSON.stringify(declared) !== JSON.stringify(archive.manifest.modules.map(item => `${item.id}@${item.version}`).sort())) fail('module manifest does not match collections');
  const available = new Set();
  for (const key of modules.keys()) {
    const row = modules.get(key);
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(row.id)) fail(`module ${key} has an invalid identifier`);
    let manifest;
    try { manifest = JSON.parse(row.manifest); } catch { fail(`module ${key} manifest is malformed`); }
    if (manifest.id !== row.id || manifest.version !== row.version) fail(`module ${key} identity does not match`);
    try {
      for (const entry of readdirSync(modulesDirectory, { withFileTypes: true }).filter(item => item.isDirectory())) {
        const bundled = JSON.parse(readFileSync(resolve(modulesDirectory, entry.name, 'manifest.json'), 'utf8'));
        if (bundled.id === row.id && bundled.version === row.version) { available.add(key); break; }
      }
    } catch { /* handled below */ }
  }
  for (const actor of archive.data.actors) if (!modules.has(`${actor.module_id}@${actor.module_version}`) || !available.has(`${actor.module_id}@${actor.module_version}`)) fail(`required module ${actor.module_id}@${actor.module_version} is unavailable`);
  const ids = (name, key) => new Set(archive.data[name].map(row => row[key]));
  const actors = ids('actors', 'id'), members = ids('members', 'id'), proposals = ids('offline_proposals', 'id');
  for (const grant of archive.data.actor_grants) if (!actors.has(grant.actor_id) || !members.has(grant.member_id)) fail('actor grant references a missing actor or member');
  for (const actor of archive.data.actors) if (actor.owner_member_id && !members.has(actor.owner_member_id)) fail('actor owner references a missing member');
  for (const row of archive.data.offline_receipts) if (!members.has(row.member_id) || row.campaign_id !== archive.manifest.campaignId || row.proposal_id && !proposals.has(row.proposal_id)) fail('receipt references missing campaign, member or proposal');
  for (const row of archive.data.offline_proposals) if (!members.has(row.member_id) || !actors.has(row.actor_id)) fail('proposal references a missing member or actor');
  for (const row of archive.data.offline_decisions) if (!proposals.has(row.proposal_id)) fail('decision references a missing proposal');
  for (const row of archive.data.events) if (row.actor_id && !actors.has(row.actor_id)) fail('event references a missing actor');
  for (const row of archive.data.operations) if (row.actor_id && !actors.has(row.actor_id)) fail('operation references a missing actor');
  return archive;
}

const bundledModulesDirectory = fileURLToPath(new URL('../../modules/', import.meta.url));

export function exportCampaignBackup(databasePath, outputPath, { modulesDirectory = bundledModulesDirectory, now = new Date() } = {}) {
  const source = new DatabaseSync(resolve(databasePath), { readOnly: true });
  const snapshotPath = resolve(dirname(outputPath), `.potomac-backup-${process.pid}-${Date.now()}.sqlite`);
  let snapshot;
  try {
    source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const data = Object.fromEntries(COLLECTIONS.map(table => [table, snapshot.prepare(`SELECT ${TABLES[table].join(',')} FROM ${table} ORDER BY rowid`).all()]));
    if (data.campaign.length !== 1) fail('export requires a single-campaign host database');
    const modules = data.modules.map(({ id, version }) => ({ id, version })).sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
    const manifest = { potomacDataVersion: 1, campaignId: data.campaign[0].id, modules, createdAt: now.toISOString(), includedCollections: [...COLLECTIONS], excludedData: ['browser layouts', 'browser caches', 'private browser drafts'] };
    const content = { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, manifest, data };
    const archive = { ...content, integrity: { algorithm: 'sha256', sha256: checksum(content) } };
    validateArchive(archive, modulesDirectory);
    writeFileSync(resolve(outputPath), `${JSON.stringify(archive, null, 2)}\n`, { flag: 'wx' });
    return archive.manifest;
  } finally {
    snapshot?.close(); source.close();
    rmSync(snapshotPath, { force: true });
    rmSync(`${snapshotPath}-wal`, { force: true }); rmSync(`${snapshotPath}-shm`, { force: true });
  }
}

export function restoreCampaignBackup(inputPath, destinationPath, { modulesDirectory = bundledModulesDirectory } = {}) {
  let archive;
  try { archive = JSON.parse(readFileSync(resolve(inputPath), 'utf8')); } catch { fail('archive is unreadable or malformed JSON'); }
  validateArchive(archive, modulesDirectory);
  const target = resolve(destinationPath);
  if (existsSync(target)) {
    let check;
    try { check = new DatabaseSync(target); } catch { fail('destination is not empty'); }
    try {
      const occupied = check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length > 0;
      if (occupied) fail('destination is not empty');
    } catch (error) {
      if (error.message?.includes('not a database')) fail('destination is not empty');
      throw error;
    } finally { check.close(); }
  }
  const db = new DatabaseSync(target);
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    const schemaSql = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8').match(/const schema = `([\s\S]*?)`;/)?.[1];
    if (!schemaSql) fail('host schema could not be loaded');
    db.exec(schemaSql);
    for (const table of COLLECTIONS) {
      const columns = TABLES[table];
      const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      for (const row of archive.data[table]) insert.run(...columns.map(column => row[column] ?? null));
    }
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* transaction may already have rolled back */ }
    db.close();
    rmSync(target, { force: true }); rmSync(`${target}-wal`, { force: true }); rmSync(`${target}-shm`, { force: true });
    throw error;
  }
  db.close();
  return archive.manifest;
}

