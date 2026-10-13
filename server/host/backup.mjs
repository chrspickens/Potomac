import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 4;
const V2_COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const PR45_V3_COLLECTIONS = [...V2_COLLECTIONS, 'sessions', 'session_state', 'session_operations'];
const V3_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'assets'];
const TABLE_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations'];
const COLLECTIONS = [...TABLE_COLLECTIONS, 'assets'];
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
  lore_entries: ['id', 'campaign_id', 'type', 'title', 'summary', 'body', 'gm_notes', 'tags', 'revision', 'archived', 'published', 'visibility', 'created_at', 'updated_at'],
  lore_operations: ['operation_id', 'principal_id', 'request_hash', 'response'],
  lore_links: ['id', 'campaign_id', 'source_id', 'target_kind', 'target_id', 'label', 'created_at'],
  lore_assets: ['id', 'campaign_id', 'entry_id', 'original_name', 'media_type', 'byte_size', 'sha256', 'created_by', 'created_at'],
  sessions: ['id', 'campaign_id', 'encounter_id', 'status', 'revision', 'started_at', 'updated_at', 'finished_at'],
  session_state: ['campaign_id', 'current_session_id', 'revision'],
  session_operations: ['operation_id', 'request_hash', 'principal_id', 'response']
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const checksumBytes = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };

function validateArchive(archive, modulesDirectory) {
  if (!archive || archive.format !== BACKUP_FORMAT || ![2, 3, BACKUP_SCHEMA_VERSION].includes(archive.schemaVersion)) fail('format or schema version is unsupported');
  const version = archive.schemaVersion;
  if (!archive.manifest || archive.manifest.potomacDataVersion !== version || typeof archive.manifest.campaignId !== 'string' || !archive.manifest.campaignId || !Array.isArray(archive.manifest.modules) || !Array.isArray(archive.manifest.includedCollections)) fail('manifest is invalid');
  if (!archive.data || checksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data }) !== archive.integrity?.sha256) fail('integrity check failed');
  const included = [...archive.manifest.includedCollections].sort();
  const matchesCollections = collections => JSON.stringify(included) === JSON.stringify([...collections].sort());
  // PR #45 published v3 with durable sessions and privacy fields. The short-lived
  // 0.6 implementation also emitted v3 with Lore collections. Recognize both
  // exact wire layouts; never infer a layout from the version number alone.
  const archiveLayout = version === 2 && matchesCollections(V2_COLLECTIONS) ? 'v2'
    : version === 3 && matchesCollections(PR45_V3_COLLECTIONS) ? 'pr45-v3'
      : version === 3 && matchesCollections(V3_COLLECTIONS) ? 'lore-v3'
        : version === BACKUP_SCHEMA_VERSION && matchesCollections(COLLECTIONS) ? 'v4' : null;
  if (!archiveLayout) fail('collection manifest is incomplete or does not match its schema');
  const expectedCollections = archiveLayout === 'v2' ? V2_COLLECTIONS
    : archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'lore-v3' ? V3_COLLECTIONS : COLLECTIONS;
  for (const collection of expectedCollections) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  if (Object.keys(archive.data).some(collection => !expectedCollections.includes(collection))) fail('archive contains an unsupported collection');
  if (archiveLayout !== 'v4') {
    for (const collection of COLLECTIONS) archive.data[collection] ??= [];
    for (const row of archive.data.actors) row.archived ??= 0;
    for (const row of archive.data.encounters) { row.visibility ??= 'public'; row.gm_notes ??= ''; }
    for (const row of archive.data.lore_entries) { row.type ??= 'note'; row.visibility ??= row.published === 1 || row.published === true ? 'shared' : 'gm'; row.published = row.visibility === 'shared' ? 1 : 0; }
    if (archiveLayout === 'v2' || archiveLayout === 'lore-v3')
      archive.data.session_state = [{ campaign_id: archive.manifest.campaignId, current_session_id: null, revision: 0 }];
  }
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
  if (archive.data.actors.some(row => ![0, 1].includes(row.archived)) || archive.data.encounters.some(row => !['public', 'gm'].includes(row.visibility) || typeof row.gm_notes !== 'string')) fail('actor or encounter privacy fields are invalid');
  const sessionIds = new Set(archive.data.sessions.map(row => row.id));
  if (sessionIds.size !== archive.data.sessions.length || archive.data.sessions.some(row => row.campaign_id !== archive.manifest.campaignId || row.encounter_id && !encounterIds.has(row.encounter_id) || !['active', 'paused', 'finished'].includes(row.status) || !Number.isInteger(row.revision) || row.revision < 1)) fail('session records are invalid');
  if (archive.data.session_state.length !== 1 || archive.data.session_state[0].campaign_id !== archive.manifest.campaignId || !Number.isInteger(archive.data.session_state[0].revision) || archive.data.session_state[0].revision < 0 || archive.data.session_state[0].current_session_id !== null && !sessionIds.has(archive.data.session_state[0].current_session_id)) fail('session state is invalid');
  if (new Set(archive.data.session_operations.map(row => row.operation_id)).size !== archive.data.session_operations.length) fail('session operation IDs are duplicated');
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
  for (const asset of archive.data.lore_assets) if (!loreIds.has(asset.entry_id) || asset.campaign_id !== archive.manifest.campaignId || !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) || !archive.data.assets.some(bytes => bytes.sha256 === asset.sha256 && bytes.size === asset.byte_size)) fail('Lore asset references unavailable metadata or bytes');
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
    const data = Object.fromEntries(TABLE_COLLECTIONS.map(table => [table, snapshot.prepare(`SELECT ${TABLES[table].join(',')} FROM ${table} ORDER BY rowid`).all()]));
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
    data.session_state = data.session_state.filter(row => row.campaign_id === data.campaign[0].id);
    const modules = data.modules.map(({ id, version }) => ({ id, version })).sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
    data.assets = data.assets || [];
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
    const archiveLayout = archive.schemaVersion === 2 ? 'v2'
      : archive.schemaVersion === 3 && JSON.stringify([...archive.manifest.includedCollections].sort()) === JSON.stringify([...PR45_V3_COLLECTIONS].sort()) ? 'pr45-v3'
        : archive.schemaVersion === 3 ? 'lore-v3' : 'v4';
    const collections = archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'v2' || archiveLayout === 'lore-v3' ? V2_COLLECTIONS.concat(archiveLayout === 'lore-v3' ? ['lore_entries','lore_operations','lore_links'] : [])
        : TABLE_COLLECTIONS;
    for (const table of collections) {
      const columns = TABLES[table];
      const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      for (const row of archive.data[table]) insert.run(...columns.map(column => {
        if (row[column] !== undefined) return row[column];
        if (column === 'archived') return 0;
        if (column === 'visibility') return table === 'encounters' ? 'public' : '{}';
        if (column === 'gm_notes') return '';
        return null;
      }));
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

