import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 3;
const LEGACY_BACKUP_SCHEMA_VERSION = 2;
const LEGACY_COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const COLLECTIONS = [...LEGACY_COLLECTIONS, 'sessions', 'session_state', 'session_operations'];
const TABLES = {
  campaign: ['id', 'context', 'name', 'system_module_id', 'system_module_version', 'revision'], modules: ['id', 'version', 'manifest'],
  encounters: ['id', 'name', 'summary', 'status', 'revision', 'created_at', 'updated_at', 'visibility', 'gm_notes'],
  encounter_participants: ['encounter_id', 'actor_id', 'initiative', 'status', 'activation_order'],
  actors: ['id', 'module_id', 'module_version', 'revision', 'data', 'visibility', 'owner_role', 'owner_member_id', 'legacy_shared', 'archived'],
  members: ['id', 'display_name', 'credential_hash', 'created_at', 'revoked_at'],
  actor_grants: ['actor_id', 'member_id', 'can_read', 'can_act', 'granted_at'],
  events: ['cursor', 'id', 'operation_id', 'actor_id', 'kind', 'visibility', 'payload', 'created_at'],
  operations: ['id', 'response', 'actor_id', 'action_id', 'request_hash', 'principal_id'],
  offline_receipts: ['member_id', 'operation_id', 'campaign_id', 'request_hash', 'status', 'proposal_id', 'response', 'created_at', 'updated_at'],
  offline_proposals: ['id', 'operation_id', 'member_id', 'actor_id', 'action_id', 'request_hash', 'request', 'campaign_id', 'base_revision', 'rule_version', 'status', 'created_at', 'decided_at', 'decision_id', 'decision', 'decision_response'],
  offline_decisions: ['decision_id', 'proposal_id', 'request_hash', 'response', 'created_at'],
  sessions: ['id', 'campaign_id', 'encounter_id', 'status', 'revision', 'started_at', 'updated_at', 'finished_at'],
  session_state: ['campaign_id', 'current_session_id', 'revision'],
  session_operations: ['operation_id', 'request_hash', 'principal_id', 'response']
};
// Version 2 archives predate session persistence, actor archival and private encounter
// fields. Keep their original wire shape readable without pretending missing data
// existed at export time. Version 3 preserves all currently host-owned state.
const legacyColumns = {
  ...TABLES,
  encounters: TABLES.encounters.filter(column => !['visibility', 'gm_notes'].includes(column)),
  actors: TABLES.actors.filter(column => column !== 'archived')
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };

function validateArchive(archive, modulesDirectory) {
  if (!archive || archive.format !== BACKUP_FORMAT || ![LEGACY_BACKUP_SCHEMA_VERSION, BACKUP_SCHEMA_VERSION].includes(archive.schemaVersion)) fail('format or schema version is unsupported');
  const version = archive.schemaVersion;
  if (!archive.manifest || archive.manifest.potomacDataVersion !== version || typeof archive.manifest.campaignId !== 'string' || !archive.manifest.campaignId || !Array.isArray(archive.manifest.modules) || !Array.isArray(archive.manifest.includedCollections)) fail('manifest is invalid');
  const expectedCollections = version === LEGACY_BACKUP_SCHEMA_VERSION ? LEGACY_COLLECTIONS : COLLECTIONS;
  if (!archive.data || checksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) !== archive.integrity?.sha256) fail('integrity check failed');
  if (JSON.stringify([...archive.manifest.includedCollections].sort()) !== JSON.stringify([...expectedCollections].sort())) fail('collection manifest is incomplete');
  for (const collection of expectedCollections) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  // Unknown top-level collections would silently be discarded during restoration.
  if (Object.keys(archive.data).some(collection => !expectedCollections.includes(collection))) fail('archive contains an unsupported collection');
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
  if (version === BACKUP_SCHEMA_VERSION) {
    const sessionIds = new Set(archive.data.sessions.map(row => row.id));
    if (sessionIds.size !== archive.data.sessions.length) fail('session identifiers are duplicated');
    const sessionRows = new Map(archive.data.sessions.map(row => [row.id, row]));
    for (const row of archive.data.actors) if (![0, 1].includes(row.archived)) fail('actor archived status is invalid');
    for (const row of archive.data.encounters) {
      if (!['public', 'gm'].includes(row.visibility) || typeof row.gm_notes !== 'string') fail('encounter visibility or GM notes are invalid');
    }
    for (const session of archive.data.sessions) {
      if (session.campaign_id !== archive.manifest.campaignId || session.encounter_id && !encounterIds.has(session.encounter_id)
        || !['active', 'paused', 'finished'].includes(session.status) || !Number.isInteger(session.revision) || session.revision < 1)
        fail('session has an invalid campaign, encounter or lifecycle');
    }
    if (archive.data.session_state.length !== 1 || archive.data.session_state[0].campaign_id !== archive.manifest.campaignId
      || !Number.isInteger(archive.data.session_state[0].revision) || archive.data.session_state[0].revision < 0)
      fail('session state is invalid');
    const state = archive.data.session_state[0];
    if (state.current_session_id !== null && (!sessionIds.has(state.current_session_id) || sessionRows.get(state.current_session_id).status === 'finished' && state.revision === 0))
      fail('current session reference is invalid');
    if (new Set(archive.data.session_operations.map(row => row.operation_id)).size !== archive.data.session_operations.length)
      fail('session operation IDs are duplicated');
  }
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
    const manifest = { potomacDataVersion: BACKUP_SCHEMA_VERSION, campaignId: data.campaign[0].id, modules, createdAt: now.toISOString(), includedCollections: [...COLLECTIONS], excludedData: ['browser layouts', 'browser caches', 'private browser drafts'] };
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
    const version = archive.schemaVersion;
    const collections = version === LEGACY_BACKUP_SCHEMA_VERSION ? LEGACY_COLLECTIONS : COLLECTIONS;
    const columnsByTable = version === LEGACY_BACKUP_SCHEMA_VERSION ? legacyColumns : TABLES;
    for (const table of collections) {
      const columns = columnsByTable[table];
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

