import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 3;
const COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions', 'lore_entries', 'lore_operations', 'lore_links'];
const LEGACY_COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const TABLES = {
  campaign: ['id', 'context', 'name', 'system_module_id', 'system_module_version', 'revision'], modules: ['id', 'version', 'manifest'],
  encounters: ['id', 'name', 'summary', 'status', 'revision', 'created_at', 'updated_at'],
  encounter_participants: ['encounter_id', 'actor_id', 'initiative', 'status', 'activation_order'],
  actors: ['id', 'module_id', 'module_version', 'revision', 'data', 'visibility', 'owner_role', 'owner_member_id', 'legacy_shared'],
  members: ['id', 'display_name', 'credential_hash', 'created_at', 'revoked_at'],
  actor_grants: ['actor_id', 'member_id', 'can_read', 'can_act', 'granted_at'],
  events: ['cursor', 'id', 'operation_id', 'actor_id', 'kind', 'visibility', 'payload', 'created_at'],
  operations: ['id', 'response', 'actor_id', 'action_id', 'request_hash', 'principal_id'],
  offline_receipts: ['member_id', 'operation_id', 'campaign_id', 'request_hash', 'status', 'proposal_id', 'response', 'created_at', 'updated_at'],
  offline_proposals: ['id', 'operation_id', 'member_id', 'actor_id', 'action_id', 'request_hash', 'request', 'campaign_id', 'base_revision', 'rule_version', 'status', 'created_at', 'decided_at', 'decision_id', 'decision', 'decision_response'],
  offline_decisions: ['decision_id', 'proposal_id', 'request_hash', 'response', 'created_at'],
  lore_entries: ['id', 'campaign_id', 'type', 'title', 'summary', 'body', 'gm_notes', 'tags', 'revision', 'archived', 'published', 'visibility', 'created_at', 'updated_at'],
  lore_operations: ['operation_id', 'principal_id', 'request_hash', 'response'],
  lore_links: ['id', 'campaign_id', 'source_id', 'target_kind', 'target_id', 'label', 'created_at']
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const checksumBytes = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };

function validateArchive(archive, modulesDirectory) {
  if (!archive || archive.format !== BACKUP_FORMAT || ![2, BACKUP_SCHEMA_VERSION].includes(archive.schemaVersion)) fail('format or schema version is unsupported');
  const legacy = archive.schemaVersion === 2;
  if (!archive.manifest || archive.manifest.potomacDataVersion !== (legacy ? 2 : 3) || typeof archive.manifest.campaignId !== 'string' || !archive.manifest.campaignId || !Array.isArray(archive.manifest.modules) || !Array.isArray(archive.manifest.includedCollections)) fail('manifest is invalid');
  if (!archive.data || checksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) !== archive.integrity?.sha256) fail('integrity check failed');
  if (legacy) {
    if (JSON.stringify([...archive.manifest.includedCollections].sort()) !== JSON.stringify([...LEGACY_COLLECTIONS].sort())) fail('collection manifest is incomplete');
    for (const collection of LEGACY_COLLECTIONS) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
    archive.schemaVersion = BACKUP_SCHEMA_VERSION;
    archive.manifest.potomacDataVersion = 3;
    archive.manifest.includedCollections = [...COLLECTIONS, 'assets'];
    archive.data.lore_entries = [];
    archive.data.lore_operations = [];
    archive.data.lore_links = [];
    archive.data.assets = [];
  }
  if (JSON.stringify([...archive.manifest.includedCollections].sort()) !== JSON.stringify([...COLLECTIONS, 'assets'].sort())) fail('collection manifest is incomplete');
  for (const collection of COLLECTIONS) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  if (!Array.isArray(archive.data.assets)) fail('asset collection is missing or invalid');
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
  const pinned = archive.data.campaign[0];
  if (Boolean(pinned.system_module_id) !== Boolean(pinned.system_module_version)) fail('campaign system pin is incomplete');
  if (pinned.system_module_id && !available.has(`${pinned.system_module_id}@${pinned.system_module_version}`)) fail('pinned campaign module is unavailable');
  if (!Number.isInteger(pinned.revision) || pinned.revision < 1) fail('campaign revision is invalid');
  const encounterIds = new Set(archive.data.encounters.map(row => row.id));
  const context = JSON.parse(pinned.context);
  if (context.activeEncounter !== null && context.activeEncounter !== undefined && !encounterIds.has(context.activeEncounter)) fail('active encounter reference is invalid');
  const ids = (name, key) => new Set(archive.data[name].map(row => row[key]));
  const actors = ids('actors', 'id'), members = ids('members', 'id'), proposals = ids('offline_proposals', 'id');
  for (const participant of archive.data.encounter_participants)
    if (!encounterIds.has(participant.encounter_id) || !actors.has(participant.actor_id)) fail('participant references a missing encounter or actor');
  for (const grant of archive.data.actor_grants) if (!actors.has(grant.actor_id) || !members.has(grant.member_id)) fail('actor grant references a missing actor or member');
  for (const actor of archive.data.actors) if (actor.owner_member_id && !members.has(actor.owner_member_id)) fail('actor owner references a missing member');
  for (const row of archive.data.offline_receipts) if (!members.has(row.member_id) || row.campaign_id !== archive.manifest.campaignId || row.proposal_id && !proposals.has(row.proposal_id)) fail('receipt references missing campaign, member or proposal');
  for (const row of archive.data.offline_proposals) if (!members.has(row.member_id) || !actors.has(row.actor_id)) fail('proposal references a missing member or actor');
  for (const row of archive.data.offline_decisions) if (!proposals.has(row.proposal_id)) fail('decision references a missing proposal');
  for (const row of archive.data.events) if (row.actor_id && !actors.has(row.actor_id)) fail('event references a missing actor');
  for (const row of archive.data.operations) if (row.actor_id && !actors.has(row.actor_id)) fail('operation references a missing actor');
  const loreIds = ids('lore_entries', 'id');
  for (const row of archive.data.lore_entries) {
    // Older v3 archives predate explicit type/visibility columns. Derive their
    // equivalent state while retaining the original archive checksum contract.
    row.type ??= 'note';
    row.visibility ??= row.published === 1 || row.published === true ? 'shared' : 'gm';
    row.published = row.visibility === 'shared' ? 1 : 0;
    if (row.campaign_id !== archive.manifest.campaignId || !Number.isInteger(row.revision) || row.revision < 1
      || !['location','person','faction','quest','item','handout','note'].includes(row.type) || !['gm','shared'].includes(row.visibility)) fail('Lore entry has an invalid campaign, type, visibility or revision');
  }
  for (const row of archive.data.lore_links) if (row.campaign_id !== archive.manifest.campaignId || !loreIds.has(row.source_id) || !['lore', 'actor', 'encounter'].includes(row.target_kind) || (row.target_kind === 'lore' && !loreIds.has(row.target_id)) || (row.target_kind === 'actor' && !actors.has(row.target_id)) || (row.target_kind === 'encounter' && !encounterIds.has(row.target_id))) fail('Lore link references an unavailable record');
  for (const row of archive.data.assets) {
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0 || Buffer.from(row.bytes, 'base64').toString('base64') !== row.bytes || Buffer.from(row.bytes, 'base64').length !== row.size || checksumBytes(Buffer.from(row.bytes, 'base64')) !== row.sha256) fail('asset bytes failed validation');
  }
  return archive;
}

const bundledModulesDirectory = fileURLToPath(new URL('../../modules/', import.meta.url));

export function exportCampaignBackup(databasePath, outputPath, { modulesDirectory = bundledModulesDirectory, assetsDirectory = `${resolve(databasePath)}.assets`, now = new Date() } = {}) {
  const source = new DatabaseSync(resolve(databasePath), { readOnly: true });
  const snapshotPath = resolve(dirname(outputPath), `.potomac-backup-${process.pid}-${Date.now()}.sqlite`);
  let snapshot;
  try {
    source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const data = Object.fromEntries(COLLECTIONS.map(table => [table, snapshot.prepare(`SELECT ${TABLES[table].join(',')} FROM ${table} ORDER BY rowid`).all()]));
    data.assets = [];
    if (existsSync(assetsDirectory)) for (const name of readdirSync(assetsDirectory).sort()) {
      if (!/^[a-f0-9]{64}$/.test(name)) fail('asset store contains an invalid filename');
      const path = resolve(assetsDirectory, name);
      if (!statSync(path).isFile()) fail('asset store contains a non-file entry');
      const bytes = readFileSync(path);
      if (checksumBytes(bytes) !== name) fail(`asset ${name} failed validation`);
      data.assets.push({ sha256: name, size: bytes.length, bytes: bytes.toString('base64') });
    }
    if (data.campaign.length !== 1) fail('export requires a single-campaign host database');
    const modules = data.modules.map(({ id, version }) => ({ id, version })).sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
    const manifest = { potomacDataVersion: 3, campaignId: data.campaign[0].id, modules, createdAt: now.toISOString(), includedCollections: [...COLLECTIONS, 'assets'], excludedData: ['browser layouts', 'browser caches', 'private browser drafts'] };
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

export function restoreCampaignBackup(inputPath, destinationPath, { modulesDirectory = bundledModulesDirectory, assetsDirectory = `${resolve(destinationPath)}.assets` } = {}) {
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
  if (existsSync(assetsDirectory) && readdirSync(assetsDirectory).length) fail('asset destination is not empty');
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
    mkdirSync(assetsDirectory, { recursive: true });
    for (const asset of archive.data.assets) writeFileSync(resolve(assetsDirectory, asset.sha256), Buffer.from(asset.bytes, 'base64'), { flag: 'wx' });
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* transaction may already have rolled back */ }
    db.close();
    rmSync(target, { force: true }); rmSync(`${target}-wal`, { force: true }); rmSync(`${target}-shm`, { force: true });
    if (existsSync(assetsDirectory) && !readdirSync(assetsDirectory).length) rmSync(assetsDirectory, { recursive: true, force: true });
    throw error;
  }
  db.close();
  return archive.manifest;
}

