import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { V2_HOST_LOCK_SCHEMA } from './v2-host.mjs';
import { V2_EFFECT_SCHEMA } from './v2-effects.mjs';
import { V2_EXTENSION_SCHEMA } from './v2-extensions.mjs';
import { V2_REACTION_SCHEMA } from './v2-reactions.mjs';
import { loadTrustedV2Catalog, lockForTrustedModule } from './v2-catalog.mjs';
import { createV2HostAdapter } from './v2-host.mjs';

export const BACKUP_FORMAT = 'potomac.campaign-backup';
export const BACKUP_SCHEMA_VERSION = 9;
const TRUSTED_V2_CATALOG = await loadTrustedV2Catalog();
const V2_COLLECTIONS = ['campaign', 'modules', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
const PR45_V3_COLLECTIONS = [...V2_COLLECTIONS, 'sessions', 'session_state', 'session_operations'];
const V3_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'assets'];
const MAP_COLLECTIONS = ['map_scenes', 'map_pieces', 'map_links', 'map_lore_links', 'map_encounter_scenes', 'map_assets', 'map_operations'];
const LEGACY_MAP_COLLECTIONS = MAP_COLLECTIONS.filter(name => name !== 'map_lore_links');
const V4_TABLE_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations'];
const TABLE_COLLECTIONS = [...V4_TABLE_COLLECTIONS, ...MAP_COLLECTIONS];
const LEGACY_TABLE_COLLECTIONS = [...V4_TABLE_COLLECTIONS, ...LEGACY_MAP_COLLECTIONS];
const V4_COLLECTIONS = [...V2_COLLECTIONS, 'lore_entries', 'lore_operations', 'lore_links', 'lore_assets', 'sessions', 'session_state', 'session_operations', 'assets'];
const COLLECTIONS = [...TABLE_COLLECTIONS, 'assets'];
const LEGACY_COLLECTIONS = [...LEGACY_TABLE_COLLECTIONS, 'assets'];
const TABLES = {
  campaign: ['id', 'context', 'name', 'system_module_id', 'system_module_version', 'revision'], modules: ['id', 'version', 'manifest'],
  encounters: ['id', 'name', 'summary', 'status', 'revision', 'created_at', 'updated_at', 'visibility', 'gm_notes'],
  catalog_entities: ['id', 'campaign_id', 'name', 'kind', 'revision', 'image_asset_id', 'created_at', 'updated_at'],
  entity_assets: ['id', 'campaign_id', 'entity_id', 'original_name', 'media_type', 'byte_size', 'sha256', 'created_at'],
  encounter_entities: ['encounter_id', 'entity_id', 'quantity', 'positions_json'],
  entity_operations: ['operation_id', 'principal_id', 'request_hash', 'response'],
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
  map_lore_links: ['id','campaign_id','source_scene_id','target_lore_entry_id','piece_id','label'],
  map_encounter_scenes: ['campaign_id','encounter_id','scene_id'],
  map_assets: ['id','campaign_id','scene_id','original_name','media_type','byte_size','sha256','created_at'],
  map_operations: ['operation_id','principal_id','request_hash','response'],
  v2_campaign_locks: ['campaign_id','lock_version','lock_digest','lock_json','root_module_id','root_module_version','root_module_digest','pinned_by','pinned_at'],
  v2_authority_versions: ['campaign_id','version'],
  v2_effect_entities: ['campaign_id','entity_id','entity_type','revision','visibility','data'],
  v2_effect_receipts: ['operation_id','campaign_id','principal_id','payload_hash','response','created_at'],
  v2_effect_events: ['event_id','operation_id','campaign_id','effect_id','entity_id','kind','visibility','payload','created_at'],
  v2_extension_entities: ['campaign_id','entity_id','descriptor_id','schema_version','migration_id','capability','owner_principal_id'],
  v2_extension_workflows: ['workflow_id','campaign_id','entity_id','workflow_type','capability','revision','state','state_data','continuation_id','participants','expires_at','status','created_by','updated_at'],
  v2_extension_receipts: ['operation_id','campaign_id','principal_id','payload_hash','response','created_at'],
  v2_extension_events: ['event_id','operation_id','campaign_id','entity_id','kind','visibility','payload','created_at'],
  v2_extension_pending_commands: ['operation_id','campaign_id','principal_id','command_id','entity_id','resolver','command_capability','lock','lock_digest','request','payload_hash','expected_revisions','continuation','suspension_transcript','window_id','authority_version','status','response','updated_at'],
  v2_reaction_windows: ['window_id','parent_operation_id','campaign_id','resolver','lock','eligible','ordering','expires_at','continuation','visibility','status','resolved_by','updated_at'],
  v2_reaction_submissions: ['operation_id','window_id','campaign_id','principal_id','action_id','input','decision','sequence','visibility','request_hash','created_at'],
  v2_reaction_events: ['event_id','window_id','campaign_id','kind','visibility','payload','created_at']
};
const V2_TABLE_COLLECTIONS = ['v2_campaign_locks','v2_authority_versions','v2_effect_entities','v2_effect_receipts','v2_effect_events','v2_extension_entities','v2_extension_workflows','v2_extension_receipts','v2_extension_events','v2_extension_pending_commands','v2_reaction_windows','v2_reaction_submissions','v2_reaction_events'];
const V6_TABLE_COLLECTIONS = [...TABLE_COLLECTIONS, ...V2_TABLE_COLLECTIONS];
const V6_COLLECTIONS = [...V6_TABLE_COLLECTIONS, 'assets'];
const ENTITY_TABLES = ['catalog_entities', 'entity_assets', 'encounter_entities', 'entity_operations'];
const V7_TABLE_COLLECTIONS = [...V6_TABLE_COLLECTIONS, ...ENTITY_TABLES];
const V7_COLLECTIONS = [...V7_TABLE_COLLECTIONS, 'assets'];
const V7_BASE_TABLE_COLLECTIONS = [...TABLE_COLLECTIONS, ...ENTITY_TABLES];
const V7_BASE_COLLECTIONS = [...V7_BASE_TABLE_COLLECTIONS, 'assets'];
const V8_TABLE_COLLECTIONS = V7_TABLE_COLLECTIONS;
const V8_COLLECTIONS = V7_COLLECTIONS;
const V8_BASE_TABLE_COLLECTIONS = V7_BASE_TABLE_COLLECTIONS;
const V8_BASE_COLLECTIONS = V7_BASE_COLLECTIONS;
const V9_TABLE_COLLECTIONS = V8_TABLE_COLLECTIONS;
const V9_COLLECTIONS = V8_COLLECTIONS;
const V9_BASE_TABLE_COLLECTIONS = V8_BASE_TABLE_COLLECTIONS;
const V9_BASE_COLLECTIONS = V8_BASE_COLLECTIONS;
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const checksumBytes = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`Backup ${message}`); };
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ASSETS = 10_000;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 384 * 1024 * 1024;

function validateArchive(archive, modulesDirectory, trustedCatalog = TRUSTED_V2_CATALOG) {
  if (!archive || archive.format !== BACKUP_FORMAT || ![2, 3, 4, 5, 6, 7, 8, BACKUP_SCHEMA_VERSION].includes(archive.schemaVersion)) fail('format or schema version is unsupported');
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
          : version === 5 && matchesCollections(COLLECTIONS) ? 'v5'
          : version === 5 && matchesCollections(LEGACY_COLLECTIONS) ? 'v5-legacy'
              : version === 6 && matchesCollections(V6_COLLECTIONS) ? 'v6'
                : version === 7 && matchesCollections(V7_COLLECTIONS) ? 'v7'
                  : version === 7 && matchesCollections(V7_BASE_COLLECTIONS) ? 'v7-base'
                    : version === 8 && matchesCollections(V8_COLLECTIONS) ? 'v8'
                    : version === 8 && matchesCollections(V8_BASE_COLLECTIONS) ? 'v8-base'
                      : version === 9 && matchesCollections(V9_COLLECTIONS) ? 'v9'
                        : version === 9 && matchesCollections(V9_BASE_COLLECTIONS) ? 'v9-base' : null;
  if (!archiveLayout) fail('collection manifest is incomplete or does not match its schema');
  const expectedCollections = archiveLayout === 'v2' ? V2_COLLECTIONS
      : archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'lore-v3' ? V3_COLLECTIONS : archiveLayout === 'v4' ? V4_COLLECTIONS : archiveLayout === 'v5-legacy' ? LEGACY_COLLECTIONS : archiveLayout === 'v6' ? V6_COLLECTIONS : archiveLayout === 'v7' ? V7_COLLECTIONS : archiveLayout === 'v7-base' ? V7_BASE_COLLECTIONS : archiveLayout === 'v8' ? V8_COLLECTIONS : archiveLayout === 'v8-base' ? V8_BASE_COLLECTIONS : archiveLayout === 'v9' ? V9_COLLECTIONS : archiveLayout === 'v9-base' ? V9_BASE_COLLECTIONS : COLLECTIONS;
  for (const collection of expectedCollections) if (!Array.isArray(archive.data[collection])) fail(`collection ${collection} is missing or invalid`);
  if (Object.keys(archive.data).some(collection => !expectedCollections.includes(collection))) fail('archive contains an unsupported collection');
  if (archiveLayout === 'v5-legacy') archive.data.map_lore_links = [];
  if (archiveLayout !== 'v4' && archiveLayout !== 'v5' && archiveLayout !== 'v6' && archiveLayout !== 'v7' && archiveLayout !== 'v7-base') {
    for (const collection of COLLECTIONS) archive.data[collection] ??= [];
    for (const collection of MAP_COLLECTIONS) archive.data[collection] ??= [];
    for (const row of archive.data.actors) row.archived ??= 0;
    for (const row of archive.data.encounters) { row.visibility ??= 'public'; row.gm_notes ??= ''; }
    for (const row of archive.data.lore_entries) { row.type ??= 'note'; row.visibility ??= row.published === 1 || row.published === true ? 'shared' : 'gm'; row.published = row.visibility === 'shared' ? 1 : 0; }
    if (archiveLayout === 'v2' || archiveLayout === 'lore-v3')
      archive.data.session_state = [{ campaign_id: archive.manifest.campaignId, current_session_id: null, revision: 0 }];
  }
  for (const collection of ENTITY_TABLES) archive.data[collection] ??= [];
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
  if (['v6','v7','v8','v9'].includes(archiveLayout)) {
    const locks = archive.data.v2_campaign_locks;
    if (locks.length > 1 || Boolean(locks.length) !== Boolean(archive.manifest.v2)) fail('V2 campaign lock metadata is missing or inconsistent');
    if (locks.length) {
      const row = locks[0]; let lock;
      try { lock = JSON.parse(row.lock_json); } catch { fail('V2 campaign lock is malformed'); }
      const provider = trustedCatalog.byId.get(row.root_module_id);
      const expected = provider && lockForTrustedModule(trustedCatalog, pinned.id, row.root_module_id);
      if (row.campaign_id !== pinned.id || !provider || provider.version !== row.root_module_version || provider.digest !== row.root_module_digest
        || JSON.stringify(lock) !== JSON.stringify(expected) || `sha256:${checksum(lock)}` !== row.lock_digest
        || JSON.stringify(archive.manifest.v2.lock) !== JSON.stringify(lock)
        || archive.manifest.v2.lockDigest !== row.lock_digest
        || archive.manifest.v2.authorityVersion !== archive.data.v2_authority_versions[0]?.version
        || archive.data.v2_authority_versions.length !== 1 || archive.data.v2_authority_versions[0].campaign_id !== pinned.id || !Number.isSafeInteger(archive.data.v2_authority_versions[0].version) || archive.data.v2_authority_versions[0].version < 1
        || archive.data.v2_effect_entities.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_effect_receipts.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_effect_events.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_extension_entities.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_extension_workflows.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_extension_pending_commands.some(row => row.campaign_id !== pinned.id)
        || archive.data.v2_reaction_windows.some(row => row.campaign_id !== pinned.id)) fail('V2 lock, authority epoch, provenance or campaign references are invalid');
      const effectIds = new Set(archive.data.v2_effect_entities.map(row => row.entity_id));
      const memberIds = new Set(archive.data.members.map(member => member.id));
      const decode = (value, label) => { try { return JSON.parse(value); } catch { fail(`V2 ${label} is malformed`); } };
      const windows = new Map(archive.data.v2_reaction_windows.map(window => [window.window_id, window]));
      if (effectIds.size !== archive.data.v2_effect_entities.length
        || archive.data.v2_effect_entities.some(row => !Number.isInteger(row.revision) || row.revision < 1 || !['public','gm','private'].includes(row.visibility) || !decode(row.data, 'entity data'))
        || archive.data.v2_extension_entities.some(row => {
          const capability = decode(row.capability, 'entity capability');
          return row.campaign_id !== pinned.id || !effectIds.has(row.entity_id) || (row.owner_principal_id !== null && row.owner_principal_id !== 'gm' && !memberIds.has(row.owner_principal_id))
            || !Number.isInteger(row.schema_version) || row.schema_version < 1 || !lock.entries.some(entry => capability.id === entry.id && capability.digest === entry.digest && capability.implementationVersion === entry.implementationVersion);
        })
        || archive.data.v2_extension_workflows.some(row => row.campaign_id !== pinned.id || !effectIds.has(row.entity_id) || !Number.isInteger(row.revision) || !decode(row.capability, 'workflow capability') || !decode(row.state_data, 'workflow state') || !decode(row.participants, 'workflow participants'))
        || archive.data.v2_effect_receipts.some(row => row.campaign_id !== pinned.id || !memberIds.has(row.principal_id) && row.principal_id !== 'gm' || !/^sha256:[a-f0-9]{64}$/.test(row.payload_hash) || !decode(row.response, 'effect receipt'))
        || archive.data.v2_extension_receipts.some(row => row.campaign_id !== pinned.id || !memberIds.has(row.principal_id) && row.principal_id !== 'gm' || !/^sha256:[a-f0-9]{64}$/.test(row.payload_hash) || !decode(row.response, 'extension receipt'))
        || archive.data.v2_effect_events.some(row => !effectIds.has(row.entity_id) || !decode(row.payload, 'effect event payload'))
        || archive.data.v2_extension_events.some(row => row.campaign_id !== pinned.id || !effectIds.has(row.entity_id) || !decode(row.payload, 'extension event payload'))
        || archive.data.v2_reaction_windows.some(row => row.campaign_id !== pinned.id || !['pending','resolved','expired','cancelled'].includes(row.status) || !decode(row.resolver, 'reaction resolver') || !decode(row.lock, 'reaction lock') || !decode(row.eligible, 'reaction eligibility') || !decode(row.continuation, 'reaction continuation'))
        || archive.data.v2_reaction_submissions.some(row => {
          const window = windows.get(row.window_id);
          return !window || row.campaign_id !== pinned.id || !memberIds.has(row.principal_id) || !decode(row.input, 'reaction input')
            || !window.eligible.some(item => item.principalId === row.principal_id) || !/^sha256:[a-f0-9]{64}$/.test(row.request_hash);
        })
        || archive.data.v2_reaction_events.some(row => !windows.has(row.window_id) || row.campaign_id !== pinned.id || !decode(row.payload, 'reaction event payload'))
        || archive.data.v2_extension_pending_commands.some(row => {
          const window = windows.get(row.window_id);
          return row.lock_digest !== archive.manifest.v2.lockDigest || row.authority_version !== archive.manifest.v2.authorityVersion
            || !window || window.parent_operation_id !== row.operation_id || !effectIds.has(row.entity_id)
            || !memberIds.has(row.principal_id) || !decode(row.command_capability, 'pending command capability')
            || !decode(row.lock, 'pending lock') || !decode(row.request, 'pending request') || !decode(row.expected_revisions, 'pending revisions')
            || !decode(row.continuation, 'pending continuation') || !decode(row.suspension_transcript, 'pending transcript');
        })) fail('V2 entity provenance, payload, ownership or continuation references are invalid');
    } else if (V2_COLLECTIONS.some(name => archive.data[name].length)) fail('unlocked V2 records are not supported');
  }
  const encounterIds = new Set(archive.data.encounters.map(row => row.id));
  const context = JSON.parse(pinned.context);
  if (context.activeEncounter !== null && context.activeEncounter !== undefined && !encounterIds.has(context.activeEncounter)) fail('active encounter reference is invalid');
  const ids = (name, key) => new Set(archive.data[name].map(row => row[key]));
  const actors = ids('actors', 'id'), members = ids('members', 'id'), proposals = ids('offline_proposals', 'id');
  const v2GrantActors = new Set(['v6', 'v7', 'v8', 'v9', 'v9-base'].includes(archiveLayout) ? (archive.data.v2_effect_entities ?? []).map(row => `v2:${archive.manifest.campaignId}:${row.entity_id}`) : []);
  for (const participant of archive.data.encounter_participants)
    if (!encounterIds.has(participant.encounter_id) || !actors.has(participant.actor_id)) fail('participant references a missing encounter or actor');
  for (const grant of archive.data.actor_grants) if (!actors.has(grant.actor_id) && !v2GrantActors.has(grant.actor_id) || !members.has(grant.member_id)) fail('actor grant references a missing actor or member');
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
  if (['v7','v7-base','v8','v8-base','v9','v9-base'].includes(archiveLayout)) {
    const entityIds = new Set(archive.data.catalog_entities.map(row => row.id));
    const entityAssets = new Map(archive.data.entity_assets.map(row => [row.id, row]));
    if (entityIds.size !== archive.data.catalog_entities.length || archive.data.catalog_entities.some(row => typeof row.id !== 'string' || !row.id || row.id.length > 128 || row.campaign_id !== archive.manifest.campaignId || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160 || row.kind !== undefined && !['item','creature'].includes(row.kind) || archiveLayout.startsWith('v9') && !row.kind || !Number.isInteger(row.revision) || row.revision < 1 || typeof row.created_at !== 'string' || !row.created_at || typeof row.updated_at !== 'string' || !row.updated_at || row.image_asset_id != null && !entityAssets.has(row.image_asset_id))) fail('entity catalog records are invalid');
    for (const row of archive.data.catalog_entities) row.kind ??= 'creature';
    if (entityAssets.size !== archive.data.entity_assets.length || archive.data.entity_assets.some(asset => {
      const bytesRow = archive.data.assets.find(bytes => bytes.sha256 === asset.sha256 && bytes.size === asset.byte_size);
      const bytes = bytesRow && Buffer.from(bytesRow.bytes, 'base64');
      const validImage = asset.media_type === 'image/png' && bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || asset.media_type === 'image/jpeg' && bytes?.[0] === 255 && bytes?.[1] === 216 && bytes?.[2] === 255 || asset.media_type === 'image/gif' && ['GIF87a','GIF89a'].includes(bytes?.toString('ascii',0,6)) || asset.media_type === 'image/webp' && bytes?.toString('ascii',0,4) === 'RIFF' && bytes?.toString('ascii',8,12) === 'WEBP';
      return typeof asset.id !== 'string' || !asset.id || asset.campaign_id !== archive.manifest.campaignId || !entityIds.has(asset.entity_id) || typeof asset.original_name !== 'string' || asset.original_name.length < 1 || asset.original_name.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(asset.original_name) || asset.original_name.trim() !== asset.original_name || typeof asset.created_at !== 'string' || !asset.created_at || !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 1 || asset.byte_size > MAX_ASSET_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256) || !validImage || !archive.data.catalog_entities.some(row => row.id === asset.entity_id && row.image_asset_id === asset.id);
    })) fail('entity image metadata is invalid');
    if (new Set(archive.data.entity_operations.map(row => row.operation_id)).size !== archive.data.entity_operations.length || archive.data.entity_operations.some(row => typeof row.operation_id !== 'string' || !row.operation_id || typeof row.principal_id !== 'string' || !row.principal_id || !/^[a-f0-9]{64}$/.test(row.request_hash) || typeof row.response !== 'string')) fail('entity operation receipts are invalid');
    const encounterEntityKeys = new Set();
    for (const row of archive.data.encounter_entities) {
      const key = `${row.encounter_id}:${row.entity_id}`;
      if (!encounterIds.has(row.encounter_id) || !entityIds.has(row.entity_id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000 || encounterEntityKeys.has(key)) fail('encounter entity reference is invalid');
      encounterEntityKeys.add(key);
      if (archiveLayout === 'v8' || archiveLayout === 'v8-base') {
        let positions; try { positions = JSON.parse(row.positions_json); } catch { fail('encounter entity positions are malformed'); }
        if (!Array.isArray(positions) || positions.length !== row.quantity || positions.some(point => !point || Object.keys(point).some(key => !['x','y'].includes(key)) || !Number.isFinite(point.x) || point.x < 0 || point.x > 1 || !Number.isFinite(point.y) || point.y < 0 || point.y > 1)) fail('encounter entity positions are invalid');
      } else row.positions_json ??= '[]';
    }
  }
  for (const row of archive.data.assets) {
    if (!row || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > MAX_ASSET_BYTES || typeof row.bytes !== 'string' || Buffer.from(row.bytes, 'base64').toString('base64') !== row.bytes || Buffer.from(row.bytes, 'base64').length !== row.size || checksumBytes(Buffer.from(row.bytes, 'base64')) !== row.sha256) fail('asset bytes failed validation');
  }
  if (archive.data.assets.length > MAX_ASSETS || archive.data.assets.reduce((total, asset) => total + asset.size, 0) > MAX_TOTAL_ASSET_BYTES) fail('asset collection exceeds supported bounds');
  if (new Set(archive.data.assets.map(asset => asset.sha256)).size !== archive.data.assets.length) fail('asset objects are duplicated');
  const assetHashes = new Set(archive.data.assets.map(asset => asset.sha256));
  const referencedHashes = new Set(archive.data.lore_assets.map(asset => asset.sha256));
  if (archiveLayout === 'v4' && (assetHashes.size !== referencedHashes.size || [...assetHashes].some(hash => !referencedHashes.has(hash)))) fail('asset objects do not match Lore references');
  if (archiveLayout === 'v5' || archiveLayout === 'v5-legacy' || archiveLayout === 'v7' || archiveLayout === 'v7-base' || archiveLayout === 'v8' || archiveLayout === 'v8-base' || archiveLayout === 'v9' || archiveLayout === 'v9-base') {
    const scenes = ids('map_scenes','id'), pieces = ids('map_pieces','id');
    for (const scene of archive.data.map_scenes) {
      let grid; try { grid=JSON.parse(scene.grid); } catch { fail('map grid is malformed'); }
      if (scene.campaign_id !== archive.manifest.campaignId || !['world','battle'].includes(scene.kind) || !['gm','shared'].includes(scene.visibility) || ![0,1].includes(scene.archived) || !Number.isInteger(scene.revision) || scene.revision < 1 || !Number.isFinite(scene.width) || scene.width < 1 || scene.width > 100000 || !Number.isFinite(scene.height) || scene.height < 1 || scene.height > 100000 || !grid || !['none','square','hex'].includes(grid.type) || !Number.isFinite(grid.size) || grid.size<0 || grid.size>10000 || grid.units!==undefined&&(typeof grid.units!=='string'||grid.units.length>32) || grid.origin!==undefined&&(grid.type!=='square'||!grid.origin||Object.keys(grid.origin).some(key=>!['x','y'].includes(key))||!Number.isFinite(grid.origin.x)||grid.origin.x<0||grid.origin.x>=grid.size||!Number.isFinite(grid.origin.y)||grid.origin.y<0||grid.origin.y>=grid.size) || scene.background_id && !archive.data.map_assets.some(asset => asset.id === scene.background_id && asset.scene_id === scene.id)) fail('map scene is invalid');
    }
    const sceneRows=new Map(archive.data.map_scenes.map(row=>[row.id,row]));
    for (const piece of archive.data.map_pieces) { const scene=sceneRows.get(piece.scene_id); if (!scene || piece.kind === 'actor' && !actors.has(piece.actor_id) || piece.kind === 'actor' && !archive.data.actors.some(actor=>actor.id===piece.actor_id&&actor.module_id===pinned.system_module_id&&actor.module_version===pinned.system_module_version) || !['actor','pin'].includes(piece.kind) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y) || piece.x < 0 || piece.y < 0 || piece.x>scene.width || piece.y>scene.height || ![0,1].includes(piece.visible) || !Number.isInteger(piece.revision) || piece.revision < 1) fail('map piece is invalid'); }
    const pieceRows=new Map(archive.data.map_pieces.map(row=>[row.id,row]));
    for (const link of archive.data.map_links) if (link.campaign_id !== archive.manifest.campaignId || !scenes.has(link.source_scene_id) || !scenes.has(link.target_scene_id) || pieceRows.get(link.piece_id)?.scene_id!==link.source_scene_id || pieceRows.get(link.piece_id)?.kind!=='pin') fail('map link is invalid');
    const mapLinkedPieces = new Set(archive.data.map_links.map(link => link.piece_id));
    for (const link of archive.data.map_lore_links) if (link.campaign_id !== archive.manifest.campaignId || !scenes.has(link.source_scene_id) || !loreIds.has(link.target_lore_entry_id) || !archive.data.lore_entries.some(entry => entry.id === link.target_lore_entry_id && entry.campaign_id === link.campaign_id) || pieceRows.get(link.piece_id)?.scene_id!==link.source_scene_id || pieceRows.get(link.piece_id)?.kind!=='pin' || mapLinkedPieces.has(link.piece_id) || link.label !== null && link.label !== undefined && (typeof link.label !== 'string' || link.label.length > 200)) fail('map Lore link is invalid');
    for (const association of archive.data.map_encounter_scenes) if (association.campaign_id !== archive.manifest.campaignId || !encounterIds.has(association.encounter_id) || !scenes.has(association.scene_id)) fail('map encounter association is invalid');
    for (const asset of archive.data.map_assets) {
      const object=archive.data.assets.find(bytes=>bytes.sha256===asset.sha256&&bytes.size===asset.byte_size), bytes=object&&Buffer.from(object.bytes,'base64');
      const signature=asset.media_type==='image/png'&&bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || asset.media_type==='image/jpeg'&&bytes?.[0]===255&&bytes?.[1]===216&&bytes?.[2]===255 || asset.media_type==='image/gif'&&['GIF87a','GIF89a'].includes(bytes?.toString('ascii',0,6)) || asset.media_type==='image/webp'&&bytes?.toString('ascii',0,4)==='RIFF'&&bytes?.toString('ascii',8,12)==='WEBP';
      if (asset.campaign_id !== archive.manifest.campaignId || !scenes.has(asset.scene_id) || !archive.data.map_scenes.some(scene=>scene.id===asset.scene_id&&scene.background_id===asset.id) || !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) || !object || !signature) fail('map asset reference is invalid');
    }
    const referencedMapHashes = archive.data.map_assets.map(asset => asset.sha256);
    const referencedEntityHashes = ['v7','v7-base','v8','v8-base','v9','v9-base'].includes(archiveLayout) ? archive.data.entity_assets.map(asset => asset.sha256) : [];
    if (assetHashes.size !== new Set([...referencedHashes, ...referencedMapHashes, ...referencedEntityHashes]).size || [...assetHashes].some(hash => !referencedHashes.has(hash) && !referencedMapHashes.includes(hash) && !referencedEntityHashes.includes(hash))) fail('asset objects do not match Lore, map or entity references');
  }
  return archive;
}

const bundledModulesDirectory = fileURLToPath(new URL('../../modules/', import.meta.url));

export function exportCampaignBackup(databasePath, outputPath, { modulesDirectory = bundledModulesDirectory, assetsDirectory = `${resolve(databasePath)}.assets`, now = new Date(), trustedCatalog = TRUSTED_V2_CATALOG } = {}) {
  const source = new DatabaseSync(resolve(databasePath), { readOnly: true });
  const snapshotPath = resolve(dirname(outputPath), `.potomac-backup-${process.pid}-${Date.now()}.sqlite`);
  let snapshot;
  try {
    source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const hasV2Tables = snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v2_campaign_locks'").get() !== undefined;
    const hasV2 = hasV2Tables && snapshot.prepare('SELECT 1 FROM v2_campaign_locks LIMIT 1').get() !== undefined;
    if (hasV2Tables && !hasV2 && V2_TABLE_COLLECTIONS.some(table => table !== 'v2_campaign_locks' && table !== 'v2_authority_versions' && snapshot.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) fail('V2 records exist without a campaign lock');
    const collections = hasV2 ? V9_TABLE_COLLECTIONS : V9_BASE_TABLE_COLLECTIONS;
    const data = Object.fromEntries(collections.map(table => [table, snapshot.prepare(`SELECT ${TABLES[table].join(',')} FROM ${table} ORDER BY rowid`).all()]));
    data.assets = [];
    const requiredHashes = [...new Set([...data.lore_assets, ...data.map_assets, ...data.entity_assets].map(asset => asset.sha256))].sort();
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
    const v2Lock = hasV2 ? data.v2_campaign_locks[0] : undefined;
    if (hasV2 && (!v2Lock || data.v2_campaign_locks.length !== 1)) fail('V2 export requires one pinned campaign capability lock');
    const manifest = { potomacDataVersion: BACKUP_SCHEMA_VERSION, campaignId: data.campaign[0].id, modules, createdAt: now.toISOString(), includedCollections: hasV2 ? [...V9_COLLECTIONS] : [...V9_BASE_COLLECTIONS], excludedData: ['browser layouts', 'browser caches', 'private browser drafts'] };
    if (v2Lock) manifest.v2 = { lock: JSON.parse(v2Lock.lock_json), lockDigest: v2Lock.lock_digest, authorityVersion: data.v2_authority_versions[0]?.version };
    const content = { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, manifest, data };
    const archive = { ...content, integrity: { algorithm: 'sha256', sha256: checksum(content) } };
    validateArchive(archive, modulesDirectory, trustedCatalog);
    archive.integrity.sha256 = checksum({ format: archive.format, schemaVersion: archive.schemaVersion, manifest: archive.manifest, data: archive.data });
    writeFileSync(resolve(outputPath), `${JSON.stringify(archive, null, 2)}\n`, { flag: 'wx' });
    return archive.manifest;
  } finally {
    snapshot?.close(); source.close();
    rmSync(snapshotPath, { force: true });
    rmSync(`${snapshotPath}-wal`, { force: true }); rmSync(`${snapshotPath}-shm`, { force: true });
  }
}

export function restoreCampaignBackup(inputPath, destinationPath, { modulesDirectory = bundledModulesDirectory, assetsDirectory = `${resolve(destinationPath)}.assets`, assetWriter = writeFileSync, trustedCatalog = TRUSTED_V2_CATALOG, onRestoreStage } = {}) {
  let archive;
  try {
    if (statSync(resolve(inputPath)).size > MAX_ARCHIVE_BYTES) fail('archive exceeds supported size');
    const archiveBytes = readFileSync(resolve(inputPath));
    if (archiveBytes.length > MAX_ARCHIVE_BYTES) fail('archive exceeds supported size');
    archive = JSON.parse(archiveBytes.toString('utf8'));
  } catch (error) { if (error.message?.startsWith('Backup archive exceeds')) throw error; fail('archive is unreadable or malformed JSON'); }
  validateArchive(archive, modulesDirectory, trustedCatalog);
  onRestoreStage?.('after-validation');
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
    const hasV2Archive = archive.schemaVersion === 6 || [7, 8, 9].includes(archive.schemaVersion) && (archive.data.v2_campaign_locks?.length || 0) > 0;
    if (hasV2Archive) db.exec(`${V2_HOST_LOCK_SCHEMA}\n${V2_EFFECT_SCHEMA}\n${V2_EXTENSION_SCHEMA}\n${V2_REACTION_SCHEMA}`);
    const archiveLayout = archive.schemaVersion === 2 ? 'v2'
      : archive.schemaVersion === 3 && JSON.stringify([...archive.manifest.includedCollections].sort()) === JSON.stringify([...PR45_V3_COLLECTIONS].sort()) ? 'pr45-v3'
        : archive.schemaVersion === 3 ? 'lore-v3' : archive.schemaVersion === 4 ? 'v4' : archive.schemaVersion === 6 ? 'v6' : archive.schemaVersion === 7 ? archive.data.v2_campaign_locks?.length ? 'v7' : 'v7-base' : archive.schemaVersion === 8 ? archive.data.v2_campaign_locks?.length ? 'v8' : 'v8-base' : archive.schemaVersion === 9 ? archive.data.v2_campaign_locks?.length ? 'v9' : 'v9-base' : 'v5';
    const collections = archiveLayout === 'pr45-v3' ? PR45_V3_COLLECTIONS
      : archiveLayout === 'v2' || archiveLayout === 'lore-v3' ? V2_COLLECTIONS.concat(archiveLayout === 'lore-v3' ? ['lore_entries','lore_operations','lore_links'] : [])
        : archiveLayout === 'v4' ? V4_TABLE_COLLECTIONS : archiveLayout === 'v6' ? V6_TABLE_COLLECTIONS : archiveLayout === 'v7' ? V7_TABLE_COLLECTIONS : archiveLayout === 'v7-base' ? V7_BASE_TABLE_COLLECTIONS : archiveLayout === 'v8' ? V8_TABLE_COLLECTIONS : archiveLayout === 'v8-base' ? V8_BASE_TABLE_COLLECTIONS : archiveLayout === 'v9' ? V9_TABLE_COLLECTIONS : archiveLayout === 'v9-base' ? V9_BASE_TABLE_COLLECTIONS : TABLE_COLLECTIONS;
    for (const table of collections) {
      const columns = TABLES[table];
      const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      for (const row of archive.data[table]) insert.run(...columns.map(column => {
        if (row[column] !== undefined) return row[column];
        if (column === 'archived') return 0;
        if (column === 'visibility') return table === 'encounters' ? 'public' : '{}';
        if (column === 'gm_notes') return '';
        if (column === 'positions_json') return '[]';
        if (column === 'kind' && table === 'catalog_entities') return 'creature';
        return null;
      }));
      if (table === collections[0]) onRestoreStage?.('during-row-import');
    }
    if (hasV2Archive) createV2HostAdapter({ db, campaignId: archive.manifest.campaignId, authenticateBearer: () => true, reauthorizePrincipal: () => true });
    db.exec('COMMIT;');
    db.close(); stagedDb = undefined;
    mkdirSync(stagedAssets);
    for (const asset of archive.data.assets) assetWriter(resolve(stagedAssets, asset.sha256), Buffer.from(asset.bytes, 'base64'), { flag: 'wx' });
    onRestoreStage?.('during-asset-publication');
    if (existsSync(assetsDirectory)) { renameSync(assetsDirectory, previousAssets); movedOldAssets = true; }
    renameSync(stagedAssets, assetsDirectory); publishedAssets = true;
    if (existsSync(target)) { renameSync(target, previousTarget); movedOldTarget = true; }
    onRestoreStage?.('before-destination-publication');
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

