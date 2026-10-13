import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 5;
const V2_COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const PR45_V3_COLLECTIONS = [...V2_COLLECTIONS, 'sessions', 'session_state', 'session_operations'];
const V3_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'assets'];
const MAP_COLLECTIONS = ['map_scenes', 'map_pieces', 'map_links', 'map_encounter_scenes', 'map_assets', 'map_operations'];
const V4_TABLE_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations'];
const TABLE_COLLECTIONS = [...V4_TABLE_COLLECTIONS, ...MAP_COLLECTIONS];
const V4_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations', 'assets'];
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
  session_operations: ['operation_id', 'request_hash', 'principal_id', 'response'],
  map_scenes: ['id','campaign_id','name','kind','revision','width','height','grid','visibility','archived','gm_notes','background_id','created_at','updated_at'],
  map_pieces: ['id','scene_id','kind','actor_id','label','x','y','visible','revision'],
  map_links: ['id','campaign_id','source_scene_id','target_scene_id','piece_id','label'],
  map_encounter_scenes: ['campaign_id','encounter_id','scene_id'],
  map_assets: ['id','campaign_id','scene_id','original_name','media_type','byte_size','sha256','created_at'],
  map_operations: ['operation_id','principal_id','request_hash','response']
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const checksumBytes = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ASSETS = 10_000;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 384 * 1024 * 1024;

function validateArchive(archive, modulesDirectory) {
  if (!archive || archive.format !== BACKUP_FORMAT || ![2, 3, 4, BACKUP_SCHEMA_VERSION].includes(archive.schemaVersion)) fail('format or schema version is unsupported');
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
        : version === 4 && matchesCollections(V4_COLLECTIONS) ? 'v4'
          : version === BACKUP_SCHEMA_VERSION && matchesCollections(COLLECTIONS) ? 'v5' : null;
  if (!archiveLayout) fail('collection manifest is incomplete or does not match its schema');
  const expectedCollections = archiveLayout === 'v2' ? V2_COLLECTIONS
      : archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'lore-v3' ? V3_COLLECTIONS : archiveLayout === 'v4' ? V4_COLLECTIONS : COLLECTIONS;
  for (const collection of expectedCollections) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  if (Object.keys(archive.data).some(collection => !expectedCollections.includes(collection))) fail('archive contains an unsupported collection');
  if (archiveLayout !== 'v4' && archiveLayout !== 'v5') {
    for (const collection of COLLECTIONS) archive.data[collection] ??= [];
    for (const collection of MAP_COLLECTIONS) archive.data[collection] ??= [];
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
    if (!row || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > MAX_ASSET_BYTES || typeof row.bytes !== 'string' || Buffer.from(row.bytes, 'base64').toString('base64') !== row.bytes || Buffer.from(row.bytes, 'base64').length !== row.size || checksumBytes(Buffer.from(row.bytes, 'base64')) !== row.sha256) fail('asset bytes failed validation');
  }
  if (archive.data.assets.length > MAX_ASSETS || archive.data.assets.reduce((total, asset) => total + asset.size, 0) > MAX_TOTAL_ASSET_BYTES) fail('asset collection exceeds supported bounds');
  if (new Set(archive.data.assets.map(asset => asset.sha256)).size !== archive.data.assets.length) fail('asset objects are duplicated');
  const assetHashes = new Set(archive.data.assets.map(asset => asset.sha256));
  const referencedHashes = new Set(archive.data.lore_assets.map(asset => asset.sha256));
  if (archiveLayout === 'v4' && (assetHashes.size !== referencedHashes.size || [...assetHashes].some(hash => !referencedHashes.has(hash)))) fail('asset objects do not match Lore references');
  if (archiveLayout === 'v5') {
    const scenes = ids('map_scenes','id'), pieces = ids('map_pieces','id');
    for (const scene of archive.data.map_scenes) {
      let grid; try { grid=JSON.parse(scene.grid); } catch { fail('map grid is malformed'); }
      if (scene.campaign_id !== archive.manifest.campaignId || !['world','battle'].includes(scene.kind) || !['gm','shared'].includes(scene.visibility) || ![0,1].includes(scene.archived) || !Number.isInteger(scene.revision) || scene.revision < 1 || !Number.isFinite(scene.width) || scene.width < 1 || scene.width > 100000 || !Number.isFinite(scene.height) || scene.height < 1 || scene.height > 100000 || !grid || !['none','square','hex'].includes(grid.type) || !Number.isFinite(grid.size) || grid.size<0 || grid.size>10000 || grid.units!==undefined&&(typeof grid.units!=='string'||grid.units.length>32) || scene.background_id && !archive.data.map_assets.some(asset => asset.id === scene.background_id && asset.scene_id === scene.id)) fail('map scene is invalid');
    }
    const sceneRows=new Map(archive.data.map_scenes.map(row=>[row.id,row]));
    for (const piece of archive.data.map_pieces) { const scene=sceneRows.get(piece.scene_id); if (!scene || piece.kind === 'actor' && !actors.has(piece.actor_id) || piece.kind === 'actor' && !archive.data.actors.some(actor=>actor.id===piece.actor_id&&actor.module_id===pinned.system_module_id&&actor.module_version===pinned.system_module_version) || !['actor','pin'].includes(piece.kind) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y) || piece.x < 0 || piece.y < 0 || piece.x>scene.width || piece.y>scene.height || ![0,1].includes(piece.visible) || !Number.isInteger(piece.revision) || piece.revision < 1) fail('map piece is invalid'); }
    const pieceRows=new Map(archive.data.map_pieces.map(row=>[row.id,row]));
    for (const link of archive.data.map_links) if (link.campaign_id !== archive.manifest.campaignId || !scenes.has(link.source_scene_id) || !scenes.has(link.target_scene_id) || pieceRows.get(link.piece_id)?.scene_id!==link.source_scene_id || pieceRows.get(link.piece_id)?.kind!=='pin') fail('map link is invalid');
    for (const association of archive.data.map_encounter_scenes) if (association.campaign_id !== archive.manifest.campaignId || !encounterIds.has(association.encounter_id) || !scenes.has(association.scene_id)) fail('map encounter association is invalid');
    for (const asset of archive.data.map_assets) {
      const object=archive.data.assets.find(bytes=>bytes.sha256===asset.sha256&&bytes.size===asset.byte_size), bytes=object&&Buffer.from(object.bytes,'base64');
      const signature=asset.media_type==='image/png'&&bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || asset.media_type==='image/jpeg'&&bytes?.[0]===255&&bytes?.[1]===216&&bytes?.[2]===255 || asset.media_type==='image/gif'&&['GIF87a','GIF89a'].includes(bytes?.toString('ascii',0,6)) || asset.media_type==='image/webp'&&bytes?.toString('ascii',0,4)==='RIFF'&&bytes?.toString('ascii',8,12)==='WEBP';
      if (asset.campaign_id !== archive.manifest.campaignId || !scenes.has(asset.scene_id) || !archive.data.map_scenes.some(scene=>scene.id===asset.scene_id&&scene.background_id===asset.id) || !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) || !object || !signature) fail('map asset reference is invalid');
    }
    const referencedMapHashes = archive.data.map_assets.map(asset => asset.sha256);
    if (assetHashes.size !== new Set([...referencedHashes, ...referencedMapHashes]).size || [...assetHashes].some(hash => !referencedHashes.has(hash) && !referencedMapHashes.includes(hash))) fail('asset objects do not match Lore or map references');
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
    const requiredHashes = [...new Set(data.lore_assets.map(asset => asset.sha256))].sort();
    if (existsSync(assetsDirectory)) {
      if (!lstatSync(assetsDirectory).isDirectory()) fail('asset directory is not a regular directory');
      for (const name of readdirSync(assetsDirectory)) {
        if (!/^[a-f0-9]{64}$/.test(name) || !lstatSync(resolve(assetsDirectory, name)).isFile())
          fail('asset store contains an unsafe file');
      }
    }
    // The DB snapshot defines the portable asset set. Orphan files are not
    // included, while missing, modified or symlinked referenced files fail
    // the export rather than producing an incomplete backup.
    for (const name of requiredHashes) {
      const path = resolve(assetsDirectory, name);
      if (!existsSync(path) || !lstatSync(path).isFile()) fail(`referenced asset ${name} is missing or unsafe`);
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

export function restoreCampaignBackup(inputPath, destinationPath, { modulesDirectory = bundledModulesDirectory, assetsDirectory = `${resolve(destinationPath)}.assets`, assetWriter = writeFileSync } = {}) {
  let archive;
  try {
    if (statSync(resolve(inputPath)).size > MAX_ARCHIVE_BYTES) fail('archive exceeds supported size');
    const archiveBytes = readFileSync(resolve(inputPath));
    if (archiveBytes.length > MAX_ARCHIVE_BYTES) fail('archive exceeds supported size');
    archive = JSON.parse(archiveBytes.toString('utf8'));
  } catch (error) { if (error.message?.startsWith('Backup archive exceeds')) throw error; fail('archive is unreadable or malformed JSON'); }
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
  const stageId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagedTarget = `${target}.restore-${stageId}`;
  const stagedAssets = `${assetsDirectory}.restore-${stageId}`;
  const previousAssets = `${assetsDirectory}.previous-${stageId}`;
  const previousTarget = `${target}.previous-${stageId}`;
  let stagedDb;
  let movedOldAssets = false;
  let movedOldTarget = false;
  let publishedAssets = false;
  try {
    stagedDb = new DatabaseSync(stagedTarget);
    const db = stagedDb;
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    const schemaSql = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8').match(/const schema = `([\s\S]*?)`;/)?.[1];
    if (!schemaSql) fail('host schema could not be loaded');
    db.exec(schemaSql);
    const archiveLayout = archive.schemaVersion === 2 ? 'v2'
      : archive.schemaVersion === 3 && JSON.stringify([...archive.manifest.includedCollections].sort()) === JSON.stringify([...PR45_V3_COLLECTIONS].sort()) ? 'pr45-v3'
        : archive.schemaVersion === 3 ? 'lore-v3' : archive.schemaVersion === 4 ? 'v4' : 'v5';
    const collections = archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'v2' || archiveLayout === 'lore-v3' ? V2_COLLECTIONS.concat(archiveLayout === 'lore-v3' ? ['lore_entries','lore_operations','lore_links'] : [])
        : archiveLayout === 'v4' ? V4_TABLE_COLLECTIONS : TABLE_COLLECTIONS;
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
    db.close(); stagedDb = undefined;
    mkdirSync(stagedAssets);
    for (const asset of archive.data.assets) assetWriter(resolve(stagedAssets, asset.sha256), Buffer.from(asset.bytes, 'base64'), { flag: 'wx' });
    if (existsSync(assetsDirectory)) { renameSync(assetsDirectory, previousAssets); movedOldAssets = true; }
    renameSync(stagedAssets, assetsDirectory); publishedAssets = true;
    if (existsSync(target)) { renameSync(target, previousTarget); movedOldTarget = true; }
    renameSync(stagedTarget, target);
    if (movedOldAssets) { try { rmSync(previousAssets, { recursive: true, force: true }); } catch { /* restore is committed; retain recoverable backup if cleanup fails */ } }
    if (movedOldTarget) { try { rmSync(previousTarget, { force: true }); } catch { /* restore is committed; retain recoverable backup if cleanup fails */ } }
  } catch (error) {
    try { stagedDb?.exec('ROLLBACK;'); } catch { /* transaction may already have rolled back */ }
    try { stagedDb?.close(); } catch { /* database may already be closed */ }
    rmSync(stagedTarget, { force: true }); rmSync(`${stagedTarget}-wal`, { force: true }); rmSync(`${stagedTarget}-shm`, { force: true });
    rmSync(stagedAssets, { recursive: true, force: true });
    if (publishedAssets) rmSync(assetsDirectory, { recursive: true, force: true });
    if (movedOldAssets) renameSync(previousAssets, assetsDirectory);
    if (movedOldTarget) renameSync(previousTarget, target);
    throw error;
  }
  return archive.manifest;
}

