import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, lstatSync, existsSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, executeAction, getActionPolicy, getRequiredRollCount } from '../../packages/rules-engine/src/index.ts';

const schema = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS modules (id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, module_version TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT '{}', owner_role TEXT NOT NULL DEFAULT 'player', owner_member_id TEXT, legacy_shared INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation_id TEXT UNIQUE, actor_id TEXT, kind TEXT NOT NULL, visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, response TEXT NOT NULL, actor_id TEXT, action_id TEXT, request_hash TEXT, principal_id TEXT);
CREATE TABLE IF NOT EXISTS offline_receipts (member_id TEXT NOT NULL, operation_id TEXT NOT NULL, campaign_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, proposal_id TEXT, response TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(member_id, operation_id));
CREATE TABLE IF NOT EXISTS offline_proposals (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, member_id TEXT NOT NULL, actor_id TEXT NOT NULL, action_id TEXT NOT NULL, request_hash TEXT NOT NULL, request TEXT NOT NULL, campaign_id TEXT, base_revision INTEGER, rule_version INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decision_id TEXT UNIQUE, decision TEXT, decision_response TEXT);
CREATE TABLE IF NOT EXISTS offline_decisions (decision_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS offline_proposals_status_created ON offline_proposals(status, created_at);
CREATE INDEX IF NOT EXISTS offline_proposals_member_created ON offline_proposals(member_id, created_at);
CREATE TABLE IF NOT EXISTS campaign (id TEXT PRIMARY KEY, context TEXT NOT NULL DEFAULT '{}', name TEXT NOT NULL DEFAULT '', system_module_id TEXT, system_module_version TEXT, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS encounters (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'prepared', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'public', gm_notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, encounter_id TEXT, status TEXT NOT NULL CHECK(status IN ('active','paused','finished')), revision INTEGER NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS session_state (campaign_id TEXT PRIMARY KEY, current_session_id TEXT REFERENCES sessions(id), revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS session_operations (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, principal_id TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS encounter_participants (encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES actors(id), initiative INTEGER, status TEXT NOT NULL DEFAULT 'active', activation_order INTEGER, PRIMARY KEY(encounter_id,actor_id));
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS actor_grants (actor_id TEXT NOT NULL, member_id TEXT NOT NULL, can_read INTEGER NOT NULL, can_act INTEGER NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(actor_id, member_id));
CREATE TABLE IF NOT EXISTS lore_entries (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'note', title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', gm_notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'gm', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_operations (operation_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_links (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES lore_entries(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('lore','actor','encounter')), target_id TEXT NOT NULL, label TEXT, created_at TEXT NOT NULL, UNIQUE(source_id,target_kind,target_id,label));
CREATE TABLE IF NOT EXISTS lore_assets (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES lore_entries(id), original_name TEXT NOT NULL, media_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lore_assets_entry ON lore_assets(campaign_id,entry_id,created_at);
CREATE TABLE IF NOT EXISTS map_scenes (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('world','battle')), revision INTEGER NOT NULL, width REAL NOT NULL, height REAL NOT NULL, grid TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'gm' CHECK(visibility IN ('gm','shared')), archived INTEGER NOT NULL DEFAULT 0, gm_notes TEXT NOT NULL DEFAULT '', background_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS map_scenes_campaign_visibility ON map_scenes(campaign_id,archived,visibility,kind);
CREATE TABLE IF NOT EXISTS map_pieces (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES map_scenes(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('actor','pin')), actor_id TEXT, label TEXT NOT NULL DEFAULT '', x REAL NOT NULL, y REAL NOT NULL, visible INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS map_pieces_scene ON map_pieces(scene_id,id);
CREATE TABLE IF NOT EXISTS map_links (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, source_scene_id TEXT NOT NULL REFERENCES map_scenes(id) ON DELETE CASCADE, target_scene_id TEXT NOT NULL REFERENCES map_scenes(id), piece_id TEXT NOT NULL REFERENCES map_pieces(id) ON DELETE CASCADE, label TEXT NOT NULL DEFAULT '', UNIQUE(source_scene_id,piece_id));
CREATE INDEX IF NOT EXISTS map_links_target ON map_links(campaign_id,target_scene_id);
CREATE TABLE IF NOT EXISTS map_lore_links (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, source_scene_id TEXT NOT NULL REFERENCES map_scenes(id) ON DELETE CASCADE, target_lore_entry_id TEXT NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE, piece_id TEXT NOT NULL REFERENCES map_pieces(id) ON DELETE CASCADE, label TEXT NOT NULL DEFAULT '', UNIQUE(source_scene_id,piece_id));
CREATE INDEX IF NOT EXISTS map_lore_links_target ON map_lore_links(campaign_id,target_lore_entry_id);
CREATE TABLE IF NOT EXISTS map_encounter_scenes (campaign_id TEXT NOT NULL, encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE, scene_id TEXT NOT NULL REFERENCES map_scenes(id), PRIMARY KEY(campaign_id,encounter_id));
CREATE TABLE IF NOT EXISTS map_assets (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, scene_id TEXT NOT NULL REFERENCES map_scenes(id), original_name TEXT NOT NULL, media_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS map_assets_scene ON map_assets(campaign_id,scene_id);
CREATE TABLE IF NOT EXISTS map_operations (operation_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL);
`;

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_CAMPAIGN_ASSET_BYTES = 100 * 1024 * 1024;
const ASSET_TYPES = {
  'image/png': { extension: '.png', signature: bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { extension: '.jpg', signature: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/gif': { extension: '.gif', signature: bytes => bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) },
  'image/webp': { extension: '.webp', signature: bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }
};

const readRawBody = (req, limit) => new Promise((resolveBody, reject) => {
  const chunks = []; let size = 0; let tooLarge = false;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > limit) { tooLarge = true; chunks.length = 0; return; }
    if (!tooLarge) chunks.push(chunk);
  });
  req.on('end', () => tooLarge ? reject(Object.assign(new Error('Asset exceeds the 5 MiB limit'), { statusCode: 413 })) : resolveBody(Buffer.concat(chunks)));
  req.on('error', reject);
});

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, fail) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) fail(new Error('Request body too large')); });
  req.on('end', () => { try { ok(JSON.parse(raw || '{}')); } catch { fail(new Error('Invalid JSON')); } });
  req.on('error', fail);
});
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
    : value;
const canonicalJson = value => JSON.stringify(canonicalize(value));
const referencedFields = values => {
  const pending = values.map(value => ({ value, depth: 0 }));
  const result = [];
  let visited = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (++visited > 256 || depth > 32) throw new Error('Action definition exceeds the rules budget');
    if (typeof value.ref === 'string') result.push(value.ref);
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push({ value: child, depth: depth + 1 });
  }
  return result;
};

const legacyEncounters = [
  { id: 'encounter-a', name: 'The Glass Bridge', summary: 'A narrow crossing over a deep ravine.' },
  { id: 'encounter-b', name: 'The Sunken Archive', summary: 'A flooded chamber of forgotten records.' }
];
function validateSchema(value, schema, root = schema, path = '$', depth = 0) {
  if (depth > 32) throw new Error('Schema nesting limit exceeded');
  if (schema.$ref) {
    const ref = schema.$ref.replace(/^#\//, '').split('/').reduce((part, key) => part?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
    if (!ref) throw new Error(`Unsupported schema reference at ${path}`);
    return validateSchema(value, ref, root, path, depth + 1);
  }
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} must equal its declared constant`);
  const validType = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'integer' ? Number.isInteger(value)
    : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : schema.type === 'string' ? typeof value === 'string'
    : schema.type === 'boolean' ? typeof value === 'boolean'
    : true;
  if (!validType) throw new Error(`${path} must be ${schema.type}`);
  if (typeof value === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength)) throw new Error(`${path} has an invalid string length`);
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) throw new Error(`${path} is outside its numeric bounds`);
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) throw new Error(`${path}.${key} is not allowed`);
    for (const [key, childSchema] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchema(value[key], childSchema, root, `${path}.${key}`, depth + 1);
  }
}

function applyRuleAction(action, state, parameters) {
  for (const key of action.input?.required || []) if (!Object.hasOwn(parameters, key)) throw new Error(`Action parameter ${key} is required`);
  for (const [key, definition] of Object.entries(action.input?.properties || {})) if (parameters[key] !== undefined) validateSchema(parameters[key], definition, action.input, `parameters.${key}`);
  if (action.input?.additionalProperties === false) for (const key of Object.keys(parameters)) if (!Object.hasOwn(action.input.properties || {}, key)) throw new Error(`Unknown action parameter: ${key}`);
  let resolution;
  const dice = action.resolution?.dice || (action.roll ? [{ count: action.roll.dice, sides: action.roll.sides }] : []);
  getRequiredRollCount(action);
  const rolls = dice.flatMap(group => Array.from({ length: group.count }, () => randomInt(1, group.sides + 1)));
  const { state: next } = executeAction(action, state, rolls);
  if (action.resolution) {
    let cursor = 0;
    const groups = action.resolution.dice.map(group => {
      const dice = rolls.slice(cursor, cursor += group.count);
      return { role: group.role || 'dice', dice, total: dice.reduce((sum, die) => sum + die, 0) };
    });
    const modifier = action.resolution.modifier ? evaluate(action.resolution.modifier, state) : 0;
    const difficulty = action.resolution.targetInput ? parameters[action.resolution.targetInput] : 0;
    const totals = groups.map(group => group.total);
    const total = action.resolution.compareTotals ? null : (totals[0] || 0) + modifier;
    const success = action.resolution.compareTotals
      ? (totals[0] || 0) + modifier >= (totals[1] || 0) + difficulty
      : action.resolution.comparison === 'gte' ? total >= difficulty : action.resolution.comparison === 'gt' ? total > difficulty : null;
    resolution = { groups, modifier, difficulty, total, success };
  } else if (action.roll) {
    const groupDice = rolls.slice(0, action.roll.dice);
    resolution = { groups: [{ role: action.roll.label || 'dice', dice: groupDice, total: groupDice.reduce((sum, die) => sum + die, 0) }] };
  }
  return { state: next, resolution };
}

// These fixed role tokens are development fixtures; authentication accepts them only on loopback listeners.
export function createHost({ databasePath = './data/potomac.sqlite', gmToken = 'local-gm', playerToken = 'local-player', campaignId = 'foundation-demo', seedDemo = false } = {}) {
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const assetDirectory = `${resolve(databasePath)}.assets`;
  mkdirSync(assetDirectory, { recursive: true });
  if (!lstatSync(assetDirectory).isDirectory() || lstatSync(assetDirectory).isSymbolicLink()) throw new Error('Asset storage path must be a real directory');
  const db = new DatabaseSync(databasePath);
  db.exec(schema);
  const loreColumns = new Set(db.prepare('PRAGMA table_info(lore_entries)').all().map(column => column.name));
  db.exec('BEGIN IMMEDIATE;');
  try {
    if (!loreColumns.has('type')) db.exec("ALTER TABLE lore_entries ADD COLUMN type TEXT NOT NULL DEFAULT 'note'");
    if (!loreColumns.has('visibility')) {
      db.exec("ALTER TABLE lore_entries ADD COLUMN visibility TEXT NOT NULL DEFAULT 'gm'");
      db.exec("UPDATE lore_entries SET visibility=CASE WHEN published=1 THEN 'shared' ELSE 'gm' END");
    }
    db.exec('DROP INDEX IF EXISTS lore_entries_campaign');
    db.exec('CREATE INDEX lore_entries_campaign ON lore_entries(campaign_id, archived, visibility)');
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* transaction may not be active */ }
    throw error;
  }
  // These tables are additive: opening a pre-Lore 0.5 database preserves all
  // existing host records and starts the new campaign-scoped collection empty.
  const actorColumns = new Set(db.prepare('PRAGMA table_info(actors)').all().map(column => column.name));
  if (!actorColumns.has('archived')) db.exec('ALTER TABLE actors ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  const encounterColumns = new Set(db.prepare('PRAGMA table_info(encounters)').all().map(column => column.name));
  if (!encounterColumns.has('visibility')) db.exec("ALTER TABLE encounters ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
  if (!encounterColumns.has('gm_notes')) db.exec("ALTER TABLE encounters ADD COLUMN gm_notes TEXT NOT NULL DEFAULT ''");
  const sessionColumns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
  if (!sessionColumns.has('encounter_id')) db.exec('ALTER TABLE sessions ADD COLUMN encounter_id TEXT');
  if (!actorColumns.has('owner_member_id')) db.exec('ALTER TABLE actors ADD COLUMN owner_member_id TEXT');
  if (!actorColumns.has('legacy_shared')) {
    db.exec('ALTER TABLE actors ADD COLUMN legacy_shared INTEGER NOT NULL DEFAULT 0');
    // Preserve access for 0.2 rows only. New actors never inherit the shared player token.
    db.exec("UPDATE actors SET legacy_shared=1 WHERE owner_role='player' AND owner_member_id IS NULL");
  }
  const operationColumns = new Set(db.prepare('PRAGMA table_info(operations)').all().map(column => column.name));
  for (const [column, type] of [['actor_id', 'TEXT'], ['action_id', 'TEXT'], ['request_hash', 'TEXT'], ['principal_id', 'TEXT']]) if (!operationColumns.has(column)) db.exec(`ALTER TABLE operations ADD COLUMN ${column} ${type}`);
  const proposalColumns = new Set(db.prepare('PRAGMA table_info(offline_proposals)').all().map(column => column.name));
  for (const [column, type] of [['campaign_id', 'TEXT'], ['base_revision', 'INTEGER'], ['rule_version', 'INTEGER']]) if (!proposalColumns.has(column)) db.exec(`ALTER TABLE offline_proposals ADD COLUMN ${column} ${type}`);
  const campaignColumns = new Set(db.prepare('PRAGMA table_info(campaign)').all().map(column => column.name));
  for (const [column, definition] of [['name', "TEXT NOT NULL DEFAULT ''"], ['system_module_id', 'TEXT'], ['system_module_version', 'TEXT'], ['revision', 'INTEGER NOT NULL DEFAULT 1']]) {
    if (!campaignColumns.has(column)) db.exec(`ALTER TABLE campaign ADD COLUMN ${column} ${definition}`);
  }
  db.prepare('INSERT OR IGNORE INTO campaign(id,context,name,revision) VALUES(?,?,?,1)').run(campaignId, '{}', '');
  db.prepare('INSERT OR IGNORE INTO session_state(campaign_id,current_session_id,revision) VALUES(?,NULL,0)').run(campaignId);
  const now = new Date().toISOString();
  if (seedDemo) for (const encounter of legacyEncounters) db.prepare('INSERT OR IGNORE INTO encounters(id,name,summary,status,revision,created_at,updated_at) VALUES(?,?,? ,\'prepared\',1,?,?)')
    .run(encounter.id, encounter.name, encounter.summary, now, now);
  const modulesDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../modules');
  // Modules are always registered so a fresh host can be configured against a
  // bundled system. Demo mode controls only fixture content, not availability
  // of the versioned module contracts.
  for (const folder of readdirSync(modulesDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    try {
      const directory = resolve(modulesDirectory, folder.name);
      const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
      const schemaDefinition = JSON.parse(readFileSync(resolve(directory, manifest.provides.actorSchema), 'utf8'));
      const view = JSON.parse(readFileSync(resolve(directory, manifest.provides.actorView), 'utf8'));
      const rules = JSON.parse(readFileSync(resolve(directory, manifest.provides.rules), 'utf8'));
      db.prepare('INSERT OR IGNORE INTO modules(id,version,manifest) VALUES(?,?,?)').run(manifest.id, manifest.version, JSON.stringify({ ...manifest, schema: schemaDefinition, view, actions: rules.actions, derivedValues: rules.derivedValues || [], rulesVersion: rules.rulesVersion || 1 }));
    } catch (error) {
      throw new Error(`Cannot load bundled module ${folder.name}: ${error.message}`);
    }
  }
  const clients = new Set();
  const moduleRow = db.prepare('SELECT manifest FROM modules WHERE id=? AND version=?');
  const actorRow = db.prepare('SELECT * FROM actors WHERE id=?');
  const loreRow = db.prepare('SELECT * FROM lore_entries WHERE id=? AND campaign_id=?');
  const assetPath = hash => resolve(assetDirectory, hash);
  const loreAssetRow = db.prepare('SELECT * FROM lore_assets WHERE id=? AND campaign_id=?');
  const mapSceneRow = db.prepare('SELECT * FROM map_scenes WHERE id=? AND campaign_id=?');
  const canReadMap = (scene, auth) => Boolean(scene && scene.campaign_id === campaignId && (auth.role === 'gm' || !scene.archived && scene.visibility === 'shared' && memberIsActive(auth.memberId)));
  const mapProjection = (scene, auth) => ({ id: scene.id, campaignId: scene.campaign_id, name: scene.name, kind: scene.kind,
    revision: scene.revision, width: scene.width, height: scene.height, grid: JSON.parse(scene.grid), visibility: scene.visibility,
    archived: Boolean(scene.archived), createdAt: scene.created_at, updatedAt: scene.updated_at,
    encounterId: (() => { const association=db.prepare('SELECT encounter_id FROM map_encounter_scenes WHERE campaign_id=? AND scene_id=? ORDER BY encounter_id LIMIT 1').get(campaignId,scene.id); const encounter=association&&db.prepare('SELECT * FROM encounters WHERE id=?').get(association.encounter_id); return encounter&&(auth.role==='gm'||encounter.visibility==='public')?encounter.id:null; })(),
    ...(auth.role === 'gm' ? { gmNotes: scene.gm_notes } : {}),
    background: scene.background_id ? (() => { const asset = db.prepare('SELECT * FROM map_assets WHERE id=? AND scene_id=?').get(scene.background_id, scene.id); return asset && { id: asset.id, name: asset.original_name, mediaType: asset.media_type, byteSize: asset.byte_size, sha256: asset.sha256 }; })() : null });
  const mapLoreLink = piece => db.prepare('SELECT target_lore_entry_id,label FROM map_lore_links WHERE piece_id=?').get(piece.id);
  const canReadMapDestination = (piece, auth) => {
    const loreLink = mapLoreLink(piece);
    if (loreLink) return canReadLore(loreRow.get(loreLink.target_lore_entry_id, campaignId), auth);
    const mapLink = db.prepare('SELECT target_scene_id FROM map_links WHERE piece_id=?').get(piece.id);
    return !mapLink || canReadMap(mapSceneRow.get(mapLink.target_scene_id, campaignId), auth);
  };
  const mapPieces = (scene, auth) => db.prepare('SELECT * FROM map_pieces WHERE scene_id=? ORDER BY id').all(scene.id)
    // The visible pin is independent of its Lore target. Keep the pin in the
    // projection but omit its destination below when the Lore policy rejects it.
    .filter(piece => auth.role === 'gm' || piece.visible === 1 && (piece.kind !== 'actor' || canReadActor(actorRow.get(piece.actor_id), auth)) && (mapLoreLink(piece) || canReadMapDestination(piece, auth)))
    .map(piece => ({ id: piece.id, sceneId: piece.scene_id, kind: piece.kind, x: piece.x, y: piece.y, visible: Boolean(piece.visible), revision: piece.revision,
      ...(piece.kind === 'actor' ? { actorId: piece.actor_id } : { label: piece.label }),
      ...(piece.kind === 'pin' && mapLoreLink(piece) ? { destination: (() => { const link = mapLoreLink(piece); const target = loreRow.get(link.target_lore_entry_id, campaignId); return canReadLore(target, auth) ? { kind: 'lore_entry', entryId: target.id, title: target.title, label: link.label ?? '' } : undefined; })() }
        : piece.kind === 'pin' && db.prepare('SELECT target_scene_id,label FROM map_links WHERE piece_id=?').get(piece.id) ? { destination: (() => { const link = db.prepare('SELECT target_scene_id,label FROM map_links WHERE piece_id=?').get(piece.id); const target = mapSceneRow.get(link.target_scene_id, campaignId); return canReadMap(target, auth) ? { kind: 'map_scene', sceneId: target.id, name: target.name, label: link.label } : undefined; })() } : {}) }));
  const mapsFor = auth => db.prepare('SELECT * FROM map_scenes WHERE campaign_id=? AND archived=0 ORDER BY id').all(campaignId).filter(scene => canReadMap(scene, auth)).map(scene => ({ ...mapProjection(scene, auth), pieces: mapPieces(scene, auth) }));
  const latest = () => Number(db.prepare('SELECT COALESCE(MAX(cursor),0) AS n FROM events').get().n);
  const loopbackOnly = () => {
    const address = server.address()?.address;
    return address === '::1' || address === '::ffff:127.0.0.1' || typeof address === 'string' && address.startsWith('127.');
  };
  const authFor = req => {
    if (!loopbackOnly()) return null;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (same(token, gmToken)) return { role: 'gm', memberId: null, principalId: 'gm' };
    if (same(token, playerToken)) return { role: 'player', memberId: null, principalId: 'legacy-player', legacy: true };
    const credentialHash = createHash('sha256').update(token).digest('hex');
    const member = db.prepare('SELECT id FROM members WHERE credential_hash=? AND revoked_at IS NULL').get(credentialHash);
    if (member) return { role: 'player', memberId: member.id, principalId: member.id };
    return null;
  };
  const projectActor = (row, auth) => {
    const actor = { id: row.id, moduleId: row.module_id, moduleVersion: row.module_version, revision: row.revision, data: JSON.parse(row.data) };
    const moduleRecord = moduleRow.get(row.module_id, row.module_version);
    const module = moduleRecord ? JSON.parse(moduleRecord.manifest) : { derivedValues: [] };
    const visibility = JSON.parse(row.visibility);
    const hiddenPaths = auth.role === 'player' ? visibility.gmOnly || [] : [];
    if (hiddenPaths.length) {
      for (const path of hiddenPaths) {
        const parts = path.split('.'); let parent = actor.data;
        for (const p of parts.slice(0, -1)) parent = parent?.[p];
        if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
      }
    }
    actor.data.derived = {};
    const references = (expression, result = []) => {
      if (!expression || typeof expression !== 'object') return result;
      if (typeof expression.ref === 'string') result.push(expression.ref);
      for (const value of Object.values(expression)) if (value && typeof value === 'object') references(value, result);
      return result;
    };
    for (const item of module.derivedValues || []) {
      const dependsOnHidden = hiddenPaths.some(hidden => references(item.value).some(ref => ref === hidden || ref.startsWith(`${hidden}.`) || hidden.startsWith(`${ref}.`)));
      if (!dependsOnHidden) actor.data.derived[item.id] = evaluate(item.value, actor.data);
    }
    return actor;
  };
  const memberIsActive = memberId => Boolean(db.prepare('SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL').get(memberId));
  const isOwner = (row, auth) => auth.memberId !== null && row.owner_member_id === auth.memberId;
  const hasGrant = (row, auth, permission) => auth.memberId !== null && Boolean(db.prepare(`SELECT 1 FROM actor_grants WHERE actor_id=? AND member_id=? AND can_${permission}=1`).get(row.id, auth.memberId));
  const canReadActor = (row, auth) => auth.role === 'gm'
    || auth.legacy && row.legacy_shared === 1 && row.owner_member_id === null && row.owner_role === 'player'
    || auth.memberId !== null && memberIsActive(auth.memberId) && (isOwner(row, auth) || hasGrant(row, auth, 'read') || hasGrant(row, auth, 'act'));
  const canActOnActor = (row, auth) => auth.role === 'gm'
    || auth.memberId !== null && memberIsActive(auth.memberId) && (isOwner(row, auth) || hasGrant(row, auth, 'act'))
    || auth.legacy && row.legacy_shared === 1 && row.owner_member_id === null && row.owner_role === 'player';
  const canReadLore = (row, auth) => Boolean(row && row.campaign_id === campaignId && !row.archived && (auth.role === 'gm' || row.visibility === 'shared' && memberIsActive(auth.memberId)));
  const loreProjection = (row, auth) => ({
    id: row.id, campaignId: row.campaign_id, type: row.type || 'note', title: row.title, summary: row.summary, bodyMarkdown: row.body,
    revision: row.revision, archived: Boolean(row.archived), visibility: row.visibility || (row.published ? 'shared' : 'gm'),
    // Legacy aliases remain available while clients migrate to the 0.6 contract.
    body: row.body, published: (row.visibility || (row.published ? 'shared' : 'gm')) === 'shared',
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(auth.role === 'gm' ? { gmNotes: row.gm_notes } : {}),
    ...((auth.role === 'gm' || row.visibility === 'shared' || row.published === 1) ? { tags: JSON.parse(row.tags) } : {})
  });
  const linkTargetReadable = (kind, id, auth) => {
    if (kind === 'lore') return canReadLore(loreRow.get(id, campaignId), auth);
    if (kind === 'actor') { const actor = actorRow.get(id); return Boolean(actor && !actor.archived && canReadActor(actor, auth)); }
    if (kind === 'encounter') { const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(id); return Boolean(encounter && (auth.role === 'gm' || encounter.visibility === 'public')); }
    return false;
  };
  const loreLinks = (sourceId, auth) => db.prepare('SELECT * FROM lore_links WHERE campaign_id=? AND source_id=? ORDER BY id').all(campaignId, sourceId)
    .filter(link => linkTargetReadable(link.target_kind, link.target_id, auth))
    .map(link => {
      const target = link.target_kind === 'lore' ? loreRow.get(link.target_id, campaignId)
        : link.target_kind === 'actor' ? actorRow.get(link.target_id)
          : db.prepare('SELECT * FROM encounters WHERE id=?').get(link.target_id);
      const title = link.target_kind === 'lore' ? target.title : link.target_kind === 'actor' ? projectActor(target, auth).data.name || target.id : target.name;
      return { id: link.id, targetKind: link.target_kind, targetId: link.target_id, targetTitle: title, ...(link.label ? { label: link.label } : {}) };
    });
  const loreMapRefreshVisible = (event, auth) => {
    if (auth.role === 'gm' || !auth.memberId || !['lore.created','lore.updated','lore.published','lore.revoked','lore.archived','lore.restored'].includes(event.kind)) return false;
    let entryId;
    try { entryId = JSON.parse(event.payload).entryId; } catch { return false; }
    if (typeof entryId !== 'string') return false;
    return db.prepare('SELECT source_scene_id FROM map_lore_links WHERE campaign_id=? AND target_lore_entry_id=?').all(campaignId, entryId)
      .some(link => canReadMap(mapSceneRow.get(link.source_scene_id, campaignId), auth));
  };
  const actionUsesHiddenFields = (action, actor) => {
    const hiddenPaths = JSON.parse(actor.visibility).gmOnly || [];
    const expressions = [action.requires, action.resolution?.modifier, ...(action.effects || []).map(effect => effect.amount)];
    return hiddenPaths.some(hidden => referencedFields(expressions).some(ref => ref === hidden || ref.startsWith(`${hidden}.`) || hidden.startsWith(`${ref}.`)));
  };
  const visibleEncounter = (encounterId, auth) => !encounterId || auth.role === 'gm'
    || Boolean(db.prepare("SELECT 1 FROM encounters WHERE id=? AND visibility='public'").get(encounterId));
  const visibleEvent = (event, auth) => {
    if (auth.role === 'gm') return true;
    if (loreMapRefreshVisible(event, auth)) return true;
    if (event.kind.startsWith('lore.')) {
      const payload = JSON.parse(event.payload);
      const entry = payload.entryId ? loreRow.get(payload.entryId, campaignId) : null;
      if (event.kind === 'lore.link.created' || event.kind === 'lore.link.removed') {
        return Boolean(entry && canReadLore(entry, auth) && linkTargetReadable(payload.targetKind, payload.targetId, auth));
      }
      return Boolean(entry && canReadLore(entry, auth));
    }
    let payload;
    try { payload = JSON.parse(event.payload); } catch { return false; }
    if (event.kind.startsWith('map.')) {
      const sceneId = payload.sceneId || payload.sourceSceneId;
      if (sceneId && !canReadMap(mapSceneRow.get(sceneId, campaignId), auth)) return false;
      if (payload.targetSceneId && !canReadMap(mapSceneRow.get(payload.targetSceneId, campaignId), auth)) return false;
      return Boolean(sceneId && canReadMap(mapSceneRow.get(sceneId, campaignId), auth));
    }
    if (event.visibility !== 'public') return false;
    if (payload.sessionId) {
      const session = db.prepare('SELECT encounter_id FROM sessions WHERE id=? AND campaign_id=?').get(payload.sessionId, campaignId);
      if (!session || !visibleEncounter(session.encounter_id, auth)) return false;
    }
    if (event.actor_id) {
      const actor = actorRow.get(event.actor_id);
      if (!actor || actor.archived || !canReadActor(actor, auth)) return false;
    }
    return true;
  };
  const eventJson = (event, auth) => {
    const loreLifecycleEvent = ['lore.created','lore.updated','lore.published','lore.revoked','lore.archived','lore.restored'].includes(event.kind);
    let opaqueLoreRefresh = auth.role !== 'gm' && event.kind.startsWith('map.lore-link.');
    if (auth.role !== 'gm' && loreLifecycleEvent) {
      let entry;
      try { const entryId = JSON.parse(event.payload).entryId; if (typeof entryId === 'string') entry = loreRow.get(entryId, campaignId); } catch {}
      // Keep the established, minimal lifecycle event for Lore a player can
      // currently read. An inaccessible target referenced by a shared pin
      // yields only an opaque refresh, including on revocation/archive.
      opaqueLoreRefresh ||= Boolean(entry && !canReadLore(entry, auth) && loreMapRefreshVisible(event, auth));
    }
    if (opaqueLoreRefresh)
      return { cursor: event.cursor, id: event.id, kind: 'permissions.refresh', visibility: 'public', payload: {}, createdAt: event.created_at };
    const payload = JSON.parse(event.payload);
    // Action parameters are client supplied and may contain values copied from GM-only fields.
    if (auth.role === 'player') {
      delete payload.parameters;
      delete payload.memberId;
      delete payload.proposalId;
      delete payload.decisionId;
      const actor = event.actor_id && actorRow.get(event.actor_id);
      const manifestRecord = payload.moduleId && payload.moduleVersion ? moduleRow.get(payload.moduleId, payload.moduleVersion) : null;
      const action = manifestRecord && JSON.parse(manifestRecord.manifest).actions?.find(item => item.id === payload.actionId);
      if (actor && action && actionUsesHiddenFields(action, actor)) {
        if (payload.resolution) payload.resolution = {
          verified: true,
          groups: payload.resolution.groups.map(group => ({ role: group.role, dice: group.dice }))
        };
        delete payload.total;
        delete payload.success;
        delete payload.outcome;
      }
    }
    return { cursor: event.cursor, id: event.id, actorId: event.actor_id, kind: event.kind, visibility: event.visibility, payload, createdAt: event.created_at };
  };
  const currentContext = (auth) => {
    const stored = JSON.parse(db.prepare('SELECT context FROM campaign WHERE id=?').get(campaignId).context);
    const active = stored?.activeEncounter;
    const encounterId = (typeof active === 'string' ? db.prepare("SELECT id FROM encounters WHERE id=? AND status!='completed'").get(active)?.id : null)
      || legacyEncounters.find(encounter => encounter.name === active)?.id || null;
    if (auth?.role !== 'gm' && encounterId && db.prepare("SELECT 1 FROM encounters WHERE id=? AND visibility='public'").get(encounterId) === undefined) return { activeEncounter: null };
    return { activeEncounter: encounterId };
  };
  const campaignJson = () => {
    const row = db.prepare('SELECT * FROM campaign WHERE id=?').get(campaignId);
    return { id: row.id, name: row.name, systemModuleId: row.system_module_id, systemModuleVersion: row.system_module_version, revision: row.revision };
  };
  const encounterJson = (row, auth) => ({
    id: row.id, name: row.name, summary: row.summary, status: row.status, revision: row.revision,
    ...(auth.role === 'gm' ? { gmNotes: row.gm_notes || '' } : {}),
    participants: db.prepare('SELECT encounter_participants.actor_id, encounter_participants.initiative, encounter_participants.status, encounter_participants.activation_order FROM encounter_participants JOIN actors ON actors.id=encounter_participants.actor_id WHERE encounter_id=? ORDER BY COALESCE(activation_order,2147483647), actor_id')
      .all(row.id).filter(participant => {
        const actor = actorRow.get(participant.actor_id);
        return actor && !actor.archived && canReadActor(actor, auth);
      }).map(({ actor_id, initiative, status, activation_order }) => ({ actorId: actor_id, initiative, status, activationOrder: activation_order }))
  });
  const publicEncounters = (auth) => db.prepare('SELECT * FROM encounters ORDER BY id').all().filter(row => auth.role === 'gm' || row.visibility === 'public').map(row => ({ id: row.id, name: row.name, summary: row.summary, status: row.status, revision: row.revision, ...(auth.role === 'gm' ? { gmNotes: row.gm_notes || '' } : {}) }));
  const searchCampaign = (auth, query, after, requestedLimit) => {
    const normalized = query.trim();
    if (normalized.length > 200) return { error: 'invalid_campaign_search_query', status: 400 };
    if (after && !/^(actor|encounter|lore|map):[A-Za-z0-9_-]{1,128}$/.test(after)) return { error: 'invalid_campaign_search_cursor', status: 400 };
    const limit = Math.min(requestedLimit, 50);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return { error: 'invalid_campaign_search_limit', status: 400 };
    const pattern = `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = [];
    const add = (kind, id, label, status = null) => rows.push({ kind, id, label, ...(status ? { status } : {}) });
    // Each source applies its host authorization predicate before any label or ID
    // is added to the wire projection. Sort and paginate only this filtered set.
    const actorVisibility = auth.role === 'gm'
      ? '1=1'
      : '( (?=1 AND owner_role=\'player\' AND owner_member_id IS NULL AND legacy_shared=1) OR (? IS NOT NULL AND (owner_member_id=? OR EXISTS (SELECT 1 FROM actor_grants g WHERE g.actor_id=actors.id AND g.member_id=? AND (g.can_read=1 OR g.can_act=1)))) )';
    const actorScope = auth.role === 'gm' ? [] : [auth.legacy ? 1 : 0, auth.memberId, auth.memberId, auth.memberId];
    const actorSearch = normalized ? " AND json_extract(data,'$.name') LIKE ? ESCAPE '\\'" : '';
    const actorRows = db.prepare(`SELECT * FROM actors WHERE archived=0 AND ${actorVisibility}${actorSearch} ORDER BY id LIMIT 500`)
      .all(...actorScope, ...(normalized ? [pattern] : []));
    for (const row of actorRows) {
      if (!canReadActor(row, auth)) continue;
      const name = JSON.parse(row.data).name;
      if (typeof name === 'string' && name) add('actor', row.id, name);
    }
    const encounterVisibility = auth.role === 'gm' ? '1=1' : "visibility='public'";
    const encounterSearch = normalized ? " AND (name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')" : '';
    const encounterRows = db.prepare(`SELECT * FROM encounters WHERE ${encounterVisibility}${encounterSearch} ORDER BY id LIMIT 500`)
      .all(...(normalized ? [pattern, pattern] : []));
    for (const row of encounterRows) {
      add('encounter', row.id, row.name, row.status);
    }
    const loreVisibility = auth.role === 'gm' ? '1=1' : "archived=0 AND visibility='shared'";
    const loreSearch = auth.role === 'gm'
      ? " AND (title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR gm_notes LIKE ? ESCAPE '\\')"
      : " AND (title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')";
    const loreRows = normalized
      ? db.prepare(`SELECT id,title,type FROM lore_entries WHERE campaign_id=? AND ${loreVisibility}${loreSearch} ORDER BY id LIMIT 500`).all(campaignId, ...Array(auth.role === 'gm' ? 5 : 4).fill(pattern))
      : db.prepare(`SELECT id,title,type FROM lore_entries WHERE campaign_id=? AND ${loreVisibility} ORDER BY id LIMIT 500`).all(campaignId);
    for (const row of loreRows) {
      if (!canReadLore(loreRow.get(row.id, campaignId), auth)) continue;
      add('lore', row.id, row.title, row.type);
    }
    const mapVisibility = auth.role === 'gm' ? '1=1' : "visibility='shared' AND EXISTS (SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL)";
    const mapScope = auth.role === 'gm' ? [] : [auth.memberId];
    const mapSearch = normalized ? " AND (name LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\')" : '';
    const mapRows = db.prepare(`SELECT * FROM map_scenes WHERE campaign_id=? AND archived=0 AND ${mapVisibility}${mapSearch} ORDER BY id LIMIT 500`)
      .all(campaignId, ...mapScope, ...(normalized ? [pattern, pattern] : []));
    for (const row of mapRows) {
      if (!canReadMap(row, auth)) continue;
      add('map', row.id, row.name, row.kind);
    }
    rows.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    const remaining = after ? rows.filter(row => `${row.kind}:${row.id}` > after) : rows;
    const page = remaining.slice(0, limit);
    return { results: page, next: remaining.length > page.length && page.length ? `${page.at(-1).kind}:${page.at(-1).id}` : null, hasMore: remaining.length > page.length };
  };
  const sessionJson = (auth) => {
    const state = db.prepare('SELECT current_session_id,revision FROM session_state WHERE campaign_id=?').get(campaignId);
    const project = row => row && ({ id: row.id, encounterId: row.encounter_id ?? null, status: row.status, revision: row.revision, startedAt: row.started_at, updatedAt: row.updated_at, finishedAt: row.finished_at });
    const current = state.current_session_id ? db.prepare('SELECT * FROM sessions WHERE id=?').get(state.current_session_id) : null;
    const history = db.prepare('SELECT * FROM sessions WHERE campaign_id=? ORDER BY started_at,id').all(campaignId)
      .filter(row => visibleEncounter(row.encounter_id, auth)).map(row => project(row));
    return { revision: state.revision, current: current && visibleEncounter(current.encounter_id, auth) ? project(current) : null, history };
  };
  const transaction = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const notify = () => {
    for (const client of clients) notifyClient(client);
  };
  // Include verified results in authoritative receipts, so reconnects and audit
  // history recover the *same* dice rather than silently losing the roll.
  const verifiedResult = executed => executed.resolution
    ? { verified: true, resolution: executed.resolution, rolls: executed.resolution.groups.flatMap(group => group.dice) }
    : {};
  const insertEvent = (event) => db.prepare('INSERT INTO events(id,operation_id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(
    event.id || randomUUID(), event.operationId || null, event.actorId || null, event.kind, event.visibility || 'public', JSON.stringify(event.payload), new Date().toISOString());
  const receiptJson = row => ({
    ...JSON.parse(row.response), operationId: row.operation_id, memberId: row.member_id, campaignId: row.campaign_id,
    requestHash: row.request_hash, status: row.status, proposalId: row.proposal_id,
    createdAt: row.created_at, updatedAt: row.updated_at
  });
  const validateOfflineCommand = (operation, auth, expectedPolicy = null) => {
    const actor = actorRow.get(operation.entityId);
    if (!actor || actor.archived || !canActOnActor(actor, auth)) return { status: 404, error: 'Actor not found', reasonCode: 'actor_unavailable' };
    const currentData = JSON.parse(actor.data);
    if (operation.moduleId !== actor.module_id || operation.moduleVersion !== actor.module_version || operation.schemaVersion !== currentData.schemaVersion) {
      return { status: 409, error: 'Module or schema version mismatch', reasonCode: 'module_schema_conflict', currentRevision: actor.revision };
    }
    for (const dependency of operation.dependencies) {
      if (!dependency || typeof dependency.entityId !== 'string' || !Number.isInteger(dependency.revision)) return { status: 400, error: 'Invalid operation dependency', reasonCode: 'invalid_dependency' };
      const dependentActor = actorRow.get(dependency.entityId);
      if (!dependentActor || !canReadActor(dependentActor, auth)) return { status: 404, error: 'Dependency not found', reasonCode: 'dependency_unavailable' };
      if (dependentActor.revision !== dependency.revision) return { status: 409, error: 'Dependency revision conflict', reasonCode: 'dependency_revision_conflict', entityId: dependency.entityId, currentRevision: dependentActor.revision };
    }
    const module = moduleRow.get(actor.module_id, actor.module_version);
    if (!module) return { status: 409, error: 'Actor module is unavailable', reasonCode: 'module_unavailable' };
    const manifest = JSON.parse(module.manifest);
    try { validateSchema(currentData, manifest.schema); }
    catch (error) { return { status: 409, error: 'Current actor data does not match its module schema', reasonCode: 'actor_schema_conflict' }; }
    const action = (manifest.actions || []).find(candidate => candidate.id === operation.actionId);
    if (!action) return { status: 400, error: 'Action is not declared by the actor module', reasonCode: 'unknown_action' };
    let policy;
    try { policy = getActionPolicy(action); }
    catch (error) { return { status: 400, error: error.message, reasonCode: 'unsupported_action_policy' }; }
    if (expectedPolicy && policy !== expectedPolicy) return { status: 409, error: 'Action approval policy changed after proposal submission', reasonCode: 'action_policy_conflict' };
    if (action.reconciliation !== undefined && action.reconciliation !== 'commutative') return { status: 400, error: 'Unsupported reconciliation policy', reasonCode: 'unsupported_reconciliation' };
    if (operation.baseRevision !== actor.revision) {
      const safeDelta = policy === 'selfService' && action.reconciliation === 'commutative'
        && operation.dependencies.length === 0 && !action.resolution && !action.roll
        && Array.isArray(action.effects) && action.effects.every(effect => effect.op === 'changeResource' && Number.isFinite(effect.amount?.literal));
      if (!safeDelta) return { status: 409, error: 'Revision conflict', reasonCode: 'revision_conflict', currentRevision: actor.revision };
    }
    let tested;
    try { tested = applyRuleAction(action, currentData, operation.parameters); }
    catch (error) { return { status: 400, error: error.message, reasonCode: 'invalid_action' }; }
    try { validateSchema(tested.state, manifest.schema); }
    catch { return { status: 409, error: 'Action result does not match its module schema', reasonCode: 'action_schema_conflict' }; }
    return { actor, data: currentData, manifest, action, policy, tested };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-headers': 'authorization,content-type,x-file-name,x-operation-id,x-base-revision', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' }); return res.end(); }
    const auth = authFor(req);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (!auth) return json(res, 401, { error: 'Bearer token required' });
    try {
      const loreAssetsMatch = url.pathname.match(/^\/api\/lore\/([^/]+)\/assets$/);
      const mapBackgroundMatch = url.pathname.match(/^\/api\/maps\/([^/]+)\/background(?:\/content)?$/);
      if (mapBackgroundMatch && req.method === 'POST' && url.pathname.endsWith('/background')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'forbidden' });
        const sceneId = decodeURIComponent(mapBackgroundMatch[1]);
        const scene = mapSceneRow.get(sceneId, campaignId);
        if (!scene) return json(res, 404, { error: 'Map scene not found' });
        const operationId = req.headers['x-operation-id'], baseRevision = Number(req.headers['x-base-revision']);
        const name = req.headers['x-file-name'], mediaType = String(req.headers['content-type'] || '').split(';',1)[0].trim().toLowerCase(), type = ASSET_TYPES[mediaType];
        if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId) || !Number.isInteger(baseRevision) || typeof name !== 'string' || !type || name.length < 1 || name.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(name) || name.trim() !== name || !name.toLowerCase().endsWith(type.extension)) return json(res,400,{error:'Operation, revision, safe filename and supported image type are required',reasonCode:'invalid_asset'});
        const bytes = await readRawBody(req, MAX_ASSET_BYTES);
        if (!bytes.length || !type.signature(bytes)) return json(res,400,{error:'Image bytes do not match the declared image type',reasonCode:'invalid_asset'});
        let width = 0, height = 0;
        if (mediaType === 'image/png' && bytes.length >= 24) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
        else if (mediaType === 'image/gif' && bytes.length >= 10) { width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); }
        else if (mediaType === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii',12,16) === 'VP8X') { width = 1 + bytes.readUIntLE(24,3); height = 1 + bytes.readUIntLE(27,3); }
        else if (mediaType === 'image/jpeg') { for (let offset=2; offset+9<bytes.length;) { if (bytes[offset++] !== 0xff) continue; const marker=bytes[offset++]; if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { height=bytes.readUInt16BE(offset+3); width=bytes.readUInt16BE(offset+5); break; } const length=bytes.readUInt16BE(offset); if (length<2) break; offset+=length; } }
        if (!width || !height || width > 20000 || height > 20000 || width * height > 100_000_000) return json(res,400,{error:'Image dimensions are invalid or exceed the supported limit',reasonCode:'invalid_asset'});
        const hash = createHash('sha256').update(bytes).digest('hex');
        const requestHash = createHash('sha256').update(canonicalJson({sceneId,baseRevision,name,mediaType,sha256:hash})).digest('hex');
        const cached = db.prepare('SELECT * FROM map_operations WHERE operation_id=?').get(operationId);
        if (cached) return cached.principal_id === auth.principalId && cached.request_hash === requestHash ? json(res,200,JSON.parse(cached.response)) : json(res,409,{error:'Operation ID was already used for a different command',reasonCode:'operation_conflict'});
        if (db.prepare('SELECT 1 FROM operations WHERE id=? UNION SELECT 1 FROM events WHERE operation_id=? UNION SELECT 1 FROM lore_operations WHERE operation_id=? UNION SELECT 1 FROM session_operations WHERE operation_id=? UNION SELECT 1 FROM offline_receipts WHERE operation_id=?').get(operationId,operationId,operationId,operationId,operationId)) return json(res,409,{error:'Operation ID is already in use',reasonCode:'operation_conflict'});
        if (scene.revision !== baseRevision) return json(res,409,{error:'Map revision conflict',reasonCode:'revision_conflict',currentRevision:scene.revision});
        const used = Number(db.prepare('SELECT COALESCE(SUM(size),0) total FROM (SELECT MAX(byte_size) size,sha256 FROM (SELECT byte_size,sha256 FROM lore_assets WHERE campaign_id=? UNION ALL SELECT byte_size,sha256 FROM map_assets WHERE campaign_id=?) GROUP BY sha256)').get(campaignId,campaignId).total);
        if (used + (db.prepare('SELECT 1 FROM map_assets WHERE sha256=? UNION SELECT 1 FROM lore_assets WHERE sha256=?').get(hash,hash) ? 0 : bytes.length) > MAX_CAMPAIGN_ASSET_BYTES) return json(res,413,{error:'Campaign asset storage exceeds the 100 MiB limit',reasonCode:'campaign_asset_limit'});
        const destination = assetPath(hash), temporary = resolve(assetDirectory,`.upload-${randomUUID()}.tmp`);
        if (existsSync(destination)) { const stat=lstatSync(destination); if (!stat.isFile() || stat.isSymbolicLink() || createHash('sha256').update(readFileSync(destination)).digest('hex')!==hash) return json(res,500,{error:'Stored asset integrity check failed',reasonCode:'asset_storage_error'}); }
        else { writeFileSync(temporary,bytes,{flag:'wx',mode:0o600}); try { linkSync(temporary,destination); } finally { if (existsSync(temporary)) unlinkSync(temporary); } }
        const assetId = randomUUID(), now = new Date().toISOString();
        const priorBackground = scene.background_id ? db.prepare('SELECT sha256 FROM map_assets WHERE id=? AND scene_id=?').get(scene.background_id,sceneId) : null;
        const result = transaction(() => {
          if (!mapSceneRow.get(sceneId,campaignId) || scene.revision !== baseRevision) throw Object.assign(new Error('Map revision conflict'),{statusCode:409});
          db.prepare('INSERT INTO map_assets(id,campaign_id,scene_id,original_name,media_type,byte_size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)').run(assetId,campaignId,sceneId,name,mediaType,bytes.length,hash,now);
          db.prepare('UPDATE map_scenes SET background_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(assetId,now,sceneId,baseRevision);
          if (scene.background_id) db.prepare('DELETE FROM map_assets WHERE id=? AND scene_id=?').run(scene.background_id,sceneId);
          const response={operationId,assetId,name,mediaType,byteSize:bytes.length,sha256:hash,revision:baseRevision+1};
          insertEvent({operationId,kind:'map.background.updated',visibility:scene.visibility,payload:{sceneId,revision:baseRevision+1}});
          db.prepare('INSERT INTO map_operations(operation_id,principal_id,request_hash,response) VALUES(?,?,?,?)').run(operationId,auth.principalId,requestHash,JSON.stringify(response)); return response;
        });
        if (priorBackground && !db.prepare('SELECT 1 FROM map_assets WHERE sha256=? UNION SELECT 1 FROM lore_assets WHERE sha256=?').get(priorBackground.sha256,priorBackground.sha256)) { try { const path=assetPath(priorBackground.sha256),stat=lstatSync(path); if(stat.isFile()&&!stat.isSymbolicLink()) unlinkSync(path); } catch {} }
        notify(); return json(res,201,result);
      }
      if (mapBackgroundMatch && req.method === 'GET' && url.pathname.endsWith('/content')) {
        const scene = mapSceneRow.get(decodeURIComponent(mapBackgroundMatch[1]),campaignId);
        if (!canReadMap(scene,auth) || !scene.background_id) return json(res,404,{error:'Map background not found'});
        const asset=db.prepare('SELECT * FROM map_assets WHERE id=? AND scene_id=? AND campaign_id=?').get(scene.background_id,scene.id,campaignId);
        if (!asset) return json(res,404,{error:'Map background not found'});
        try { const path=assetPath(asset.sha256), stat=lstatSync(path), bytes=readFileSync(path); if (!stat.isFile() || stat.isSymbolicLink() || bytes.length!==asset.byte_size || createHash('sha256').update(bytes).digest('hex')!==asset.sha256) return json(res,404,{error:'Map background unavailable'}); res.writeHead(200,{'content-type':asset.media_type,'content-length':bytes.length,'content-disposition':'inline','x-content-type-options':'nosniff','cache-control':'private, no-store'}); return res.end(bytes); } catch { return json(res,404,{error:'Map background unavailable'}); }
      }
      if (loreAssetsMatch && ['GET', 'POST'].includes(req.method)) {
        const entryId = decodeURIComponent(loreAssetsMatch[1]);
        const entry = loreRow.get(entryId, campaignId);
        if (!entry || !canReadLore(entry, auth)) return json(res, 404, { error: 'Lore entry not found' });
        if (req.method === 'GET') {
          const assets = db.prepare('SELECT id,entry_id,original_name,media_type,byte_size,sha256,created_at FROM lore_assets WHERE campaign_id=? AND entry_id=? ORDER BY created_at,id').all(campaignId, entryId);
          return json(res, 200, { assets: assets.map(asset => ({ id: asset.id, entryId: asset.entry_id, name: asset.original_name, mediaType: asset.media_type, byteSize: asset.byte_size, sha256: asset.sha256, createdAt: asset.created_at })) });
        }
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'unauthorized' });
        const mediaType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        const type = ASSET_TYPES[mediaType];
        const name = req.headers['x-file-name'];
        if (!type || typeof name !== 'string' || name.length < 1 || name.length > 160 || name === '.' || name === '..'
          || /[\\/\u0000-\u001f\u007f]/.test(name) || name.trim() !== name || !name.toLowerCase().endsWith(type.extension))
          return json(res, 400, { error: 'A safe filename and supported image content type are required', reasonCode: 'invalid_asset' });
        const announcedSize = Number(req.headers['content-length']);
        if (Number.isFinite(announcedSize) && announcedSize > MAX_ASSET_BYTES) return json(res, 413, { error: 'Asset exceeds the 5 MiB limit', reasonCode: 'asset_too_large' });
        const bytes = await readRawBody(req, MAX_ASSET_BYTES);
        if (!bytes.length || !type.signature(bytes)) return json(res, 400, { error: 'Asset bytes do not match the declared image type', reasonCode: 'invalid_asset' });
        const currentEntry = loreRow.get(entryId, campaignId);
        if (!currentEntry || !canReadLore(currentEntry, auth)) return json(res, 404, { error: 'Lore entry not found' });
        const usedBytes = Number(db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM (SELECT MAX(byte_size) AS size FROM lore_assets WHERE campaign_id=? GROUP BY sha256)').get(campaignId).total);
        if (usedBytes + bytes.length > MAX_CAMPAIGN_ASSET_BYTES) return json(res, 413, { error: 'Campaign asset storage exceeds the 100 MiB limit', reasonCode: 'campaign_asset_limit' });
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const destination = assetPath(sha256);
        const temporary = resolve(assetDirectory, `.upload-${randomUUID()}.tmp`);
        let createdObject = false;
        try {
          if (existsSync(destination)) {
            const existingStat = lstatSync(destination);
            if (!existingStat.isFile() || existingStat.isSymbolicLink() || createHash('sha256').update(readFileSync(destination)).digest('hex') !== sha256)
              return json(res, 500, { error: 'Stored asset integrity check failed', reasonCode: 'asset_storage_error' });
          } else {
            writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
            try { linkSync(temporary, destination); createdObject = true; }
            catch (error) {
              if (error.code !== 'EEXIST') throw error;
              const existingStat = lstatSync(destination);
              if (!existingStat.isFile() || existingStat.isSymbolicLink() || createHash('sha256').update(readFileSync(destination)).digest('hex') !== sha256) throw new Error('Stored asset integrity check failed');
            }
          }
          if (existsSync(temporary)) unlinkSync(temporary);
          const id = randomUUID(); const now = new Date().toISOString();
          try {
            db.prepare('INSERT INTO lore_assets(id,campaign_id,entry_id,original_name,media_type,byte_size,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(id, campaignId, entryId, name, mediaType, bytes.length, sha256, auth.principalId, now);
          } catch (error) {
            if (createdObject) { try { unlinkSync(destination); } catch {} }
            throw error;
          }
          const asset = { id, entryId, name, mediaType, byteSize: bytes.length, sha256, createdAt: now };
          return json(res, 201, asset);
        } catch (error) {
          try { if (existsSync(temporary)) unlinkSync(temporary); } catch {}
          if (createdObject) { try { if (existsSync(destination)) unlinkSync(destination); } catch {} }
          throw Object.assign(new Error('Asset storage failed'), { statusCode: 500 });
        }
      }
      const assetContentMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
      if (req.method === 'GET' && assetContentMatch) {
        const asset = loreAssetRow.get(decodeURIComponent(assetContentMatch[1]), campaignId);
        const entry = asset && loreRow.get(asset.entry_id, campaignId);
        if (!asset || !entry || !canReadLore(entry, auth)) return json(res, 404, { error: 'Asset not found' });
        const path = assetPath(asset.sha256);
        let bytes;
        try {
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.byte_size) throw new Error('Invalid asset object');
          bytes = readFileSync(path);
          if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Asset hash mismatch');
        } catch { return json(res, 404, { error: 'Asset bytes unavailable', reasonCode: 'asset_unavailable' }); }
        const fallbackName = asset.original_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
        res.writeHead(200, { 'content-type': asset.media_type, 'content-length': bytes.length, 'content-disposition': `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(asset.original_name)}`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
        return res.end(bytes);
      }
      const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (assetMatch && ['GET', 'DELETE'].includes(req.method)) {
        const asset = loreAssetRow.get(decodeURIComponent(assetMatch[1]), campaignId);
        const entry = asset && loreRow.get(asset.entry_id, campaignId);
        if (!asset || !entry || !canReadLore(entry, auth)) return json(res, 404, { error: 'Asset not found' });
        if (req.method === 'DELETE') {
          if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'unauthorized' });
          db.prepare('DELETE FROM lore_assets WHERE id=? AND campaign_id=?').run(asset.id, campaignId);
          if (!db.prepare('SELECT 1 FROM lore_assets WHERE sha256=? LIMIT 1').get(asset.sha256)) {
            const path = assetPath(asset.sha256);
            try { const stat = lstatSync(path); if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(path); } catch {}
          }
          return json(res, 200, { id: asset.id, removed: true });
        }
        return json(res, 200, { id: asset.id, entryId: asset.entry_id, name: asset.original_name, mediaType: asset.media_type, byteSize: asset.byte_size, sha256: asset.sha256, createdAt: asset.created_at });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const actors = db.prepare('SELECT * FROM actors WHERE archived=0 ORDER BY id').all().filter(row => canReadActor(row, auth)).map(row => projectActor(row, auth));
        const modules = db.prepare('SELECT manifest FROM modules ORDER BY id,version').all().map(row => JSON.parse(row.manifest));
        const context = currentContext(auth);
        const rawSince = url.searchParams.get('since');
        const since = rawSince === null ? 0 : Number(rawSince);
        if (!Number.isSafeInteger(since) || since < 0) return json(res, 400, { error: 'Cursor must be a non-negative safe integer', reasonCode: 'invalid_cursor' });
        const currentCursor = latest();
        const firstCursor = Number(db.prepare('SELECT COALESCE(MIN(cursor),?) AS n FROM events').get(currentCursor + 1).n);
        const recoveryReason = since > currentCursor ? 'cursor_ahead' : since < firstCursor - 1 ? 'cursor_expired' : null;
        const events = recoveryReason ? [] : db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(since).filter(e => visibleEvent(e, auth)).map(event => eventJson(event, auth));
        return json(res, 200, { campaignId, role: auth.role, memberId: auth.memberId, revision: currentCursor, context, session: sessionJson(auth), encounters: publicEncounters(auth), maps: mapsFor(auth), modules, actors, events, ...(recoveryReason ? { recovery: { reason: recoveryReason, cursor: currentCursor } } : {}) });
      }
      if (req.method === 'GET' && url.pathname === '/api/maps') return json(res, 200, { maps: mapsFor(auth) });
      const navigationMatch = req.method === 'GET' && url.pathname.match(/^\/api\/navigation\/(actor|encounter|lore|map)\/([^/]+)$/);
      if (navigationMatch) {
        const [, kind, encodedId] = navigationMatch;
        const id = decodeURIComponent(encodedId);
        let result = null;
        if (kind === 'actor') {
          const row = actorRow.get(id);
          if (row && !row.archived && canReadActor(row, auth)) { const name = JSON.parse(row.data).name; if (typeof name === 'string' && name) result = { kind, id, label: name }; }
        } else if (kind === 'encounter') {
          const row = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
          if (row && (auth.role === 'gm' || row.visibility === 'public')) result = { kind, id, label: row.name, status: row.status };
        } else if (kind === 'lore') {
          const row = loreRow.get(id, campaignId);
          if (canReadLore(row, auth)) result = { kind, id, label: row.title, status: row.type };
        } else {
          const row = mapSceneRow.get(id, campaignId);
          if (row && !row.archived && canReadMap(row, auth)) result = { kind, id, label: row.name, status: row.kind };
        }
        if (!result) return json(res, 404, { error: 'Item unavailable', reasonCode: 'unavailable' });
        return json(res, 200, { contract: 'potomac.navigation.v0.8', campaignId, target: result });
      }
      if (req.method === 'GET' && url.pathname === '/api/search') {
        const result = searchCampaign(auth, url.searchParams.get('q') || '', url.searchParams.get('after') || '', url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25);
        if (result.error) return json(res, result.status, { error: 'Search is unavailable', reasonCode: result.error });
        return json(res, 200, { contract: 'potomac.search.v0.8', campaignId, ...result });
      }
      const mapMatch = url.pathname.match(/^\/api\/maps\/([^/]+)$/);
      const mapCommandMatch = url.pathname.match(/^\/api\/maps\/([^/]+)\/commands$/);
      const encounterMapMatch = url.pathname.match(/^\/api\/encounters\/([^/]+)\/map$/);
      if (req.method === 'GET' && encounterMapMatch) {
        const encounterId=decodeURIComponent(encounterMapMatch[1]), encounter=db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
        if (!encounter || auth.role !== 'gm' && encounter.visibility !== 'public') return json(res,404,{error:'Encounter map not found'});
        const association=db.prepare('SELECT scene_id FROM map_encounter_scenes WHERE campaign_id=? AND encounter_id=?').get(campaignId,encounterId);
        const scene=association && mapSceneRow.get(association.scene_id,campaignId);
        if (!canReadMap(scene,auth)) return json(res,404,{error:'Encounter map not found'});
        return json(res,200,{scene:{...mapProjection(scene,auth),pieces:mapPieces(scene,auth)}});
      }
      if (req.method === 'GET' && mapMatch) {
        const scene = mapSceneRow.get(decodeURIComponent(mapMatch[1]), campaignId);
        if (!canReadMap(scene, auth)) return json(res, 404, { error: 'Map scene not found' });
        return json(res, 200, { ...mapProjection(scene, auth), pieces: mapPieces(scene, auth) });
      }
      if ((req.method === 'POST' && url.pathname === '/api/maps') || (req.method === 'POST' && mapCommandMatch)) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'forbidden' });
        const body = await readBody(req);
        const creating = url.pathname === '/api/maps';
        const id = creating ? body.id : decodeURIComponent(mapCommandMatch[1]);
        const allowedKeys = creating ? ['operationId','baseRevision','id','campaignId','name','kind','width','height','grid','visibility','gmNotes'] : ['operationId','baseRevision','command','name','kind','width','height','grid','visibility','gmNotes','piece','pieceId','targetSceneId','targetLoreEntryId','label','encounterId'];
        if (!body || Object.keys(body).some(key => !allowedKeys.includes(key)) || typeof body.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.operationId) || !Number.isInteger(body.baseRevision) || body.baseRevision < 0)
          return json(res, 400, { error: 'Valid operationId, baseRevision, and map command are required', reasonCode: 'invalid_command' });
        if (creating && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return json(res, 400, { error: 'Map ID must be a stable opaque identifier', reasonCode: 'invalid_map' });
        if (creating && (body.campaignId !== undefined && body.campaignId !== campaignId || body.visibility !== undefined && body.visibility !== 'gm')) return json(res,400,{error:'New maps must belong to this campaign and begin GM-only',reasonCode:'invalid_map'});
        const hash = createHash('sha256').update(canonicalJson({ creating, id, ...body })).digest('hex');
        const cached = db.prepare('SELECT * FROM map_operations WHERE operation_id=?').get(body.operationId);
        if (cached) return cached.principal_id === auth.principalId && cached.request_hash === hash ? json(res, 200, JSON.parse(cached.response)) : json(res, 409, { error: 'Operation ID was already used for a different command', reasonCode: 'operation_conflict' });
        if (db.prepare('SELECT 1 FROM operations WHERE id=? UNION SELECT 1 FROM events WHERE operation_id=? UNION SELECT 1 FROM lore_operations WHERE operation_id=? UNION SELECT 1 FROM session_operations WHERE operation_id=? UNION SELECT 1 FROM offline_receipts WHERE operation_id=?').get(body.operationId, body.operationId, body.operationId, body.operationId, body.operationId)) return json(res, 409, { error: 'Operation ID is already in use', reasonCode: 'operation_conflict' });
        if (creating && mapSceneRow.get(id,campaignId)) return json(res,409,{error:'Map scene already exists',reasonCode:'revision_conflict'});
        const current = creating ? null : mapSceneRow.get(id, campaignId);
        if (!creating && (!current || body.baseRevision !== current.revision)) return json(res, current ? 409 : 404, current ? { error: 'Map revision conflict', reasonCode: 'revision_conflict', currentRevision: current.revision } : { error: 'Map scene not found' });
        const command = creating ? 'create' : body.command;
        if (!creating && !['update','archive','restore','publish','revoke','piece.put','piece.delete','link.put','link.delete','lore-link.put','lore-link.delete','encounter.set','background.remove'].includes(command)) return json(res, 400, { error: 'Unsupported map command', reasonCode: 'unsupported_command' });
        const commandFields = creating ? ['operationId','baseRevision','id','campaignId','name','kind','width','height','grid','visibility','gmNotes']
          : ['operationId','baseRevision','command', ...(command === 'update' ? ['name','kind','width','height','grid','gmNotes'] : command === 'piece.put' ? ['piece'] : command === 'piece.delete' || command === 'link.delete' || command === 'lore-link.delete' ? ['pieceId'] : command === 'link.put' ? ['pieceId','targetSceneId','label'] : command === 'lore-link.put' ? ['pieceId','targetLoreEntryId','label'] : command === 'encounter.set' ? ['encounterId'] : [])];
        if (Object.keys(body).some(key => !commandFields.includes(key))) return json(res,400,{error:'Fields are not valid for this map command',reasonCode:'invalid_command'});
        const next = { name: body.name ?? current?.name, kind: body.kind ?? current?.kind, width: body.width ?? current?.width, height: body.height ?? current?.height,
          grid: body.grid ?? (current ? JSON.parse(current.grid) : { type: body.kind === 'world' ? 'none' : 'square', size: 1 }), visibility: body.visibility ?? current?.visibility ?? 'gm', gmNotes: body.gmNotes ?? current?.gm_notes ?? '' };
        if ((creating || command === 'update') && (typeof next.name !== 'string' || !next.name.trim() || next.name.length > 160 || !['world','battle'].includes(next.kind) || !Number.isFinite(next.width) || next.width < 1 || next.width > 100000 || !Number.isFinite(next.height) || next.height < 1 || next.height > 100000 || !next.grid || !['none','square','hex'].includes(next.grid.type) || !Number.isFinite(next.grid.size) || next.grid.size < 0 || next.grid.size > 10000 || next.grid.type !== 'none' && next.grid.size < 1 || next.grid.units !== undefined && (typeof next.grid.units !== 'string' || next.grid.units.length > 32) || typeof next.gmNotes !== 'string' || next.gmNotes.length > 8000)) return json(res, 400, { error: 'Map fields or geometry are invalid', reasonCode: 'invalid_map' });
        if (!creating && command.startsWith('piece.') && command === 'piece.put') {
          const piece = body.piece;
          const conflictingPiece = piece && db.prepare('SELECT scene_id FROM map_pieces WHERE id=?').get(piece.id);
          if (conflictingPiece && conflictingPiece.scene_id !== id) return json(res,409,{error:'Map piece ID already belongs to another scene',reasonCode:'operation_conflict'});
          if (!piece || Object.keys(piece).some(key=>!['id','sceneId','kind','x','y','visible','revision','actorId','label'].includes(key)) || piece.sceneId !== undefined && piece.sceneId !== id || !/^[A-Za-z0-9_-]{1,128}$/.test(piece.id || '') || !['actor','pin'].includes(piece.kind) || piece.visible !== undefined && typeof piece.visible !== 'boolean' || !Number.isFinite(piece.x) || !Number.isFinite(piece.y) || piece.x < 0 || piece.y < 0 || piece.x > current.width || piece.y > current.height || piece.kind === 'actor' && (typeof piece.actorId !== 'string' || !actorRow.get(piece.actorId) || actorRow.get(piece.actorId).archived || actorRow.get(piece.actorId).module_id !== campaignJson().systemModuleId || actorRow.get(piece.actorId).module_version !== campaignJson().systemModuleVersion) || piece.kind === 'pin' && (typeof piece.label !== 'string' || piece.label.length > 200)) return json(res, 400, { error: 'Map piece is invalid or references an unavailable actor', reasonCode: 'invalid_piece' });
          if (piece.kind === 'actor' && db.prepare('SELECT 1 FROM map_links WHERE piece_id=? UNION SELECT 1 FROM map_lore_links WHERE piece_id=?').get(piece.id,piece.id)) return json(res,409,{error:'Unlink a destination before changing a pin into an actor token',reasonCode:'invalid_piece'});
        }
        if (!creating && command === 'piece.delete' && !db.prepare('SELECT 1 FROM map_pieces WHERE id=? AND scene_id=?').get(body.pieceId,id)) return json(res,404,{error:'Map piece not found',reasonCode:'not_found'});
        if (!creating && command === 'link.delete' && !db.prepare('SELECT 1 FROM map_links WHERE source_scene_id=? AND piece_id=?').get(id,body.pieceId)) return json(res,404,{error:'Map link not found',reasonCode:'not_found'});
        if (!creating && command === 'lore-link.delete' && !db.prepare('SELECT 1 FROM map_lore_links WHERE source_scene_id=? AND piece_id=?').get(id,body.pieceId)) return json(res,404,{error:'Map Lore link not found',reasonCode:'not_found'});
        if (!creating && command === 'update' && (db.prepare('SELECT 1 FROM map_pieces WHERE scene_id=? AND (x>? OR y>?) LIMIT 1').get(id,next.width,next.height))) return json(res,400,{error:'Scene dimensions cannot exclude existing pieces',reasonCode:'invalid_geometry'});
        if (!creating && command === 'link.put' && (!/^[A-Za-z0-9_-]{1,128}$/.test(body.pieceId || '') || !mapSceneRow.get(body.targetSceneId, campaignId) || !db.prepare("SELECT 1 FROM map_pieces WHERE id=? AND scene_id=? AND kind='pin'").get(body.pieceId, id) || typeof body.label !== 'string' || body.label.length > 200)) return json(res, 404, { error: 'Map link target or pin unavailable', reasonCode: 'invalid_reference' });
        if (!creating && command === 'lore-link.put' && (!/^[A-Za-z0-9_-]{1,128}$/.test(body.pieceId || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(body.targetLoreEntryId || '') || !canReadLore(loreRow.get(body.targetLoreEntryId, campaignId), { role: 'gm', memberId: null }) || !db.prepare("SELECT 1 FROM map_pieces WHERE id=? AND scene_id=? AND kind='pin'").get(body.pieceId, id) || body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 200))) return json(res,404,{error:'Map Lore target or pin unavailable',reasonCode:'invalid_reference'});
        if (!creating && command === 'encounter.set' && body.encounterId !== null && !db.prepare('SELECT 1 FROM encounters WHERE id=?').get(body.encounterId)) return json(res, 404, { error: 'Encounter unavailable', reasonCode: 'invalid_reference' });
        const now = new Date().toISOString();
        const response = transaction(() => {
          let revision;
          if (creating) {
            if (body.baseRevision !== 0 || mapSceneRow.get(id, campaignId)) throw Object.assign(new Error('Map scene already exists'), { reasonCode: 'revision_conflict' });
            db.prepare('INSERT INTO map_scenes(id,campaign_id,name,kind,revision,width,height,grid,visibility,gm_notes,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?)').run(id,campaignId,next.name.trim(),next.kind,next.width,next.height,JSON.stringify(next.grid),next.visibility,next.gmNotes,now,now); revision = 1;
          } else {
            revision = current.revision + 1;
            const visibility = command === 'publish' ? 'shared' : command === 'revoke' ? 'gm' : current.visibility;
            db.prepare('UPDATE map_scenes SET name=?,kind=?,width=?,height=?,grid=?,visibility=?,gm_notes=?,archived=?,background_id=?,revision=?,updated_at=? WHERE id=? AND revision=?')
              .run(next.name.trim(),next.kind,next.width,next.height,JSON.stringify(next.grid),visibility,next.gmNotes,command === 'archive' ? 1 : command === 'restore' ? 0 : current.archived,command === 'background.remove' ? null : current.background_id,revision,now,id,current.revision);
            if (command === 'piece.put') db.prepare('INSERT INTO map_pieces(id,scene_id,kind,actor_id,label,x,y,visible,revision) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,actor_id=excluded.actor_id,label=excluded.label,x=excluded.x,y=excluded.y,visible=excluded.visible,revision=map_pieces.revision+1 WHERE map_pieces.scene_id=excluded.scene_id').run(body.piece.id,id,body.piece.kind,body.piece.actorId || null,body.piece.label || '',body.piece.x,body.piece.y,body.piece.visible === false ? 0 : 1);
            if (command === 'piece.delete') db.prepare('DELETE FROM map_pieces WHERE id=? AND scene_id=?').run(body.pieceId,id);
            if (command === 'link.put') {
              db.prepare('DELETE FROM map_lore_links WHERE source_scene_id=? AND piece_id=?').run(id,body.pieceId);
              db.prepare('INSERT INTO map_links(id,campaign_id,source_scene_id,target_scene_id,piece_id,label) VALUES(?,?,?,?,?,?) ON CONFLICT(source_scene_id,piece_id) DO UPDATE SET target_scene_id=excluded.target_scene_id,label=excluded.label').run(randomUUID(),campaignId,id,body.targetSceneId,body.pieceId,body.label);
            }
            if (command === 'link.delete') db.prepare('DELETE FROM map_links WHERE source_scene_id=? AND piece_id=?').run(id,body.pieceId);
            if (command === 'lore-link.put') {
              db.prepare('DELETE FROM map_links WHERE source_scene_id=? AND piece_id=?').run(id,body.pieceId);
              db.prepare('INSERT INTO map_lore_links(id,campaign_id,source_scene_id,target_lore_entry_id,piece_id,label) VALUES(?,?,?,?,?,?) ON CONFLICT(source_scene_id,piece_id) DO UPDATE SET target_lore_entry_id=excluded.target_lore_entry_id,label=excluded.label').run(randomUUID(),campaignId,id,body.targetLoreEntryId,body.pieceId,body.label ?? '');
            }
            if (command === 'lore-link.delete') db.prepare('DELETE FROM map_lore_links WHERE source_scene_id=? AND piece_id=?').run(id,body.pieceId);
            if (command === 'encounter.set') { if (body.encounterId) db.prepare('INSERT INTO map_encounter_scenes(campaign_id,encounter_id,scene_id) VALUES(?,?,?) ON CONFLICT(campaign_id,encounter_id) DO UPDATE SET scene_id=excluded.scene_id').run(campaignId,body.encounterId,id); else db.prepare('DELETE FROM map_encounter_scenes WHERE campaign_id=? AND scene_id=?').run(campaignId,id); }
            if (command === 'background.remove' && current.background_id) db.prepare('DELETE FROM map_assets WHERE id=? AND scene_id=?').run(current.background_id,id);
          }
          const visibility = creating ? 'gm' : command === 'publish' ? 'shared' : command === 'revoke' ? 'gm' : current.visibility;
          insertEvent({ operationId: body.operationId, kind: `map.${creating ? 'created' : command}`, visibility, payload: { sceneId: id, revision } });
          const result = { operationId: body.operationId, status: 'applied', sceneId: id, revision };
          db.prepare('INSERT INTO map_operations(operation_id,principal_id,request_hash,response) VALUES(?,?,?,?)').run(body.operationId,auth.principalId,hash,JSON.stringify(result)); return result;
        });
        if (command === 'background.remove' && current.background_id) { const prior=db.prepare('SELECT sha256 FROM map_assets WHERE id=?').get(current.background_id); if (prior && !db.prepare('SELECT 1 FROM map_assets WHERE sha256=? UNION SELECT 1 FROM lore_assets WHERE sha256=?').get(prior.sha256,prior.sha256)) { try { const path=assetPath(prior.sha256),stat=lstatSync(path); if(stat.isFile()&&!stat.isSymbolicLink()) unlinkSync(path); } catch {} } }
        notify(); return json(res, 200, response);
      }
      const loreEntryMatch = url.pathname.match(/^\/api\/lore\/([^/]+)$/);
      const loreLinksMatch = url.pathname.match(/^\/api\/lore\/([^/]+)\/links$/);
      const loreLinkMatch = url.pathname.match(/^\/api\/lore\/([^/]+)\/links\/([^/]+)$/);
      const loreActionMatch = url.pathname.match(/^\/api\/lore\/([^/]+)\/(archive|restore|publish|revoke|publication)$/);
      if (req.method === 'GET' && loreLinksMatch) {
        const id = decodeURIComponent(loreLinksMatch[1]);
        const row = loreRow.get(id, campaignId);
        if (!canReadLore(row, auth)) return json(res, 404, { error: 'Lore entry not found' });
        const backlinks = db.prepare("SELECT l.*,e.title AS source_title FROM lore_links l JOIN lore_entries e ON e.id=l.source_id WHERE l.campaign_id=? AND l.target_kind='lore' AND l.target_id=? ORDER BY l.id").all(campaignId, id)
          .filter(link => canReadLore(loreRow.get(link.source_id, campaignId), auth))
          .map(link => ({ id: link.id, sourceId: link.source_id, sourceTitle: link.source_title, ...(link.label ? { label: link.label } : {}) }));
        return json(res, 200, { links: loreLinks(id, auth), backlinks });
      }
      if ((req.method === 'POST' && url.pathname === '/api/lore') || (req.method === 'PUT' && (loreEntryMatch || loreActionMatch || loreLinksMatch || loreLinkMatch))) {
        const body = await readBody(req);
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'unauthorized' });
        const id = loreEntryMatch ? decodeURIComponent(loreEntryMatch[1]) : loreActionMatch ? decodeURIComponent(loreActionMatch[1]) : loreLinksMatch ? decodeURIComponent(loreLinksMatch[1]) : loreLinkMatch ? decodeURIComponent(loreLinkMatch[1]) : null;
        const requestedMode = req.method === 'POST' ? 'create' : loreEntryMatch ? 'update' : loreActionMatch?.[2] || (loreLinksMatch ? 'link.create' : 'link.remove');
        const mode = requestedMode === 'publication' ? (body.published === true ? 'publish' : 'revoke') : requestedMode;
        const allowed = requestedMode === 'publication' ? ['operationId','baseRevision','published']
          : mode === 'create' ? ['operationId','baseRevision','id','type','title','summary','body','bodyMarkdown','gmNotes','tags']
          : mode === 'update' ? ['operationId','baseRevision','type','title','summary','body','bodyMarkdown','gmNotes','tags']
            : mode.startsWith('link.') ? mode === 'link.create' ? ['operationId','baseRevision','targetKind','targetId','label'] : ['operationId','baseRevision']
              : ['operationId','baseRevision'];
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))
          || typeof body.operationId !== 'string' || !body.operationId.trim() || body.operationId.length > 128
          || !Number.isInteger(body.baseRevision) || body.baseRevision < 0)
          return json(res, 400, { error: 'Valid operationId, baseRevision and command fields are required', reasonCode: 'invalid_command' });
        const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'operationId'));
        const requestHash = createHash('sha256').update(canonicalJson({ campaignId, mode, id, linkId: loreLinkMatch ? decodeURIComponent(loreLinkMatch[2]) : null, payload })).digest('hex');
        const cached = db.prepare('SELECT * FROM lore_operations WHERE operation_id=?').get(body.operationId);
        if (cached) {
          if (cached.principal_id !== auth.principalId || cached.request_hash !== requestHash) return json(res, 409, { error: 'Operation ID was already used for a different command', reasonCode: 'operation_id_collision' });
          return json(res, 200, JSON.parse(cached.response));
        }
        if (db.prepare('SELECT 1 FROM operations WHERE id=? UNION SELECT 1 FROM offline_receipts WHERE operation_id=? UNION SELECT 1 FROM session_operations WHERE operation_id=? UNION SELECT 1 FROM events WHERE operation_id=? UNION SELECT 1 FROM lore_operations WHERE operation_id=?').get(body.operationId, body.operationId, body.operationId, body.operationId, body.operationId))
          return json(res, 409, { error: 'Operation ID was already used', reasonCode: 'operation_id_collision' });
        const current = id ? loreRow.get(id, campaignId) : null;
        if (mode !== 'create' && !current) return json(res, 404, { error: 'Lore entry not found' });
        if (mode === 'update' && current.archived) return json(res, 409, { error: 'Archived Lore entries must be restored before editing', reasonCode: 'entry_archived', currentRevision: current.revision });
        if (mode === 'create' && body.baseRevision !== 0) return json(res, 409, { error: 'New entries require baseRevision 0', reasonCode: 'revision_conflict', currentRevision: 0 });
        if (mode !== 'create' && body.baseRevision !== current.revision) return json(res, 409, { error: 'Lore revision conflict', reasonCode: 'revision_conflict', currentRevision: current.revision });
        const textValid = (value, maximum, required = false) => typeof value === 'string' && value.length <= maximum && (!required || Boolean(value.trim())) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
        if (mode === 'create' || mode === 'update') {
          const values = mode === 'create'
            ? { type: Object.hasOwn(body, 'type') ? body.type : 'note', title: body.title, summary: body.summary ?? '', body: body.bodyMarkdown ?? body.body ?? '', gmNotes: body.gmNotes ?? '', tags: body.tags ?? [] }
            : { type: Object.hasOwn(body, 'type') ? body.type : current.type ?? 'note', title: body.title ?? current.title, summary: body.summary ?? current.summary, body: body.bodyMarkdown ?? body.body ?? current.body, gmNotes: body.gmNotes ?? current.gm_notes, tags: body.tags ?? JSON.parse(current.tags) };
          if (!['location','person','faction','quest','item','handout','note'].includes(values.type)
            || body.bodyMarkdown !== undefined && body.body !== undefined
            || !textValid(values.title, 200, true) || !textValid(values.summary, 4000) || !textValid(values.body, 100000) || !textValid(values.gmNotes ?? '', 50000)
            || !Array.isArray(values.tags ?? []) || (values.tags ?? []).length > 50 || (values.tags ?? []).some(tag => !textValid(tag, 48, true))
            || new Set((values.tags ?? []).map(tag => tag.trim().toLocaleLowerCase())).size !== (values.tags ?? []).length)
            return json(res, 400, { error: 'Lore title, Markdown, notes or tags are invalid or exceed their limits', reasonCode: 'invalid_lore' });
          if (mode === 'create' && body.id !== undefined && (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id)))
            return json(res, 400, { error: 'Lore ID must be a stable opaque identifier', reasonCode: 'invalid_lore' });
          const now = new Date().toISOString(), entryId = mode === 'create' ? body.id || randomUUID() : id;
          const revision = mode === 'create' ? 1 : current.revision + 1;
          const visibility = mode === 'create' ? 'gm' : current.visibility || (current.published ? 'shared' : 'gm');
          const result = { id: entryId, campaignId, type: values.type, title: values.title.trim(), summary: values.summary || '', bodyMarkdown: values.body || '', revision,
            archived: false, visibility, createdAt: mode === 'create' ? now : current.created_at, updatedAt: now,
            body: values.body || '', published: visibility === 'shared',
            gmNotes: values.gmNotes || '', tags: (values.tags || []).map(tag => tag.trim()) };
          transaction(() => {
            if (mode === 'create') db.prepare('INSERT INTO lore_entries(id,campaign_id,type,title,summary,body,gm_notes,tags,revision,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)')
              .run(entryId, campaignId, values.type, result.title, result.summary, result.body, result.gmNotes, JSON.stringify(result.tags), visibility, now, now);
            else db.prepare('UPDATE lore_entries SET type=?,title=?,summary=?,body=?,gm_notes=?,tags=?,revision=?,visibility=?,published=?,updated_at=? WHERE id=? AND revision=?')
              .run(values.type, result.title, result.summary, result.body, result.gmNotes, JSON.stringify(result.tags), revision, visibility, visibility === 'shared' ? 1 : 0, now, id, body.baseRevision);
            const event = insertEvent({ operationId: body.operationId, kind: mode === 'create' ? 'lore.created' : 'lore.updated', visibility: 'gm', payload: { entryId, revision } });
            result.eventCursor = Number(event.lastInsertRowid);
            db.prepare('INSERT INTO lore_operations(operation_id,principal_id,request_hash,response) VALUES(?,?,?,?)').run(body.operationId, auth.principalId, requestHash, JSON.stringify(result));
          });
          notify();
          return json(res, mode === 'create' ? 201 : 200, result);
        }
        if (mode.startsWith('link.')) {
          if (current.archived) return json(res, 409, { error: 'Archived Lore entries cannot change links', reasonCode: 'entry_archived', currentRevision: current.revision });
          if (mode === 'link.create' && (!['lore','actor','encounter'].includes(body.targetKind) || typeof body.targetId !== 'string' || !body.targetId || body.targetId.length > 128 || body.label !== undefined && !textValid(body.label, 64, true)))
            return json(res, 400, { error: 'Supported targetKind, targetId and optional label are required', reasonCode: 'invalid_link' });
          const linkId = mode === 'link.create' ? randomUUID() : decodeURIComponent(loreLinkMatch[2]);
          if (mode === 'link.create' && !linkTargetReadable(body.targetKind, body.targetId, { role: 'gm', memberId: null })) return json(res, 404, { error: 'Link target not found', reasonCode: 'invalid_link_target' });
          if (mode === 'link.remove' && !db.prepare('SELECT 1 FROM lore_links WHERE id=? AND source_id=? AND campaign_id=?').get(linkId, id, campaignId)) return json(res, 404, { error: 'Lore link not found' });
          const existingLink = mode === 'link.remove' ? db.prepare('SELECT target_kind,target_id FROM lore_links WHERE id=? AND source_id=?').get(linkId, id) : null;
          const now = new Date().toISOString(), revision = current.revision + 1;
          const result = { id, revision, linkId, ...(mode === 'link.create' ? { targetKind: body.targetKind, targetId: body.targetId, label: body.label || null } : { removed: true }) };
          transaction(() => {
            if (mode === 'link.create') db.prepare('INSERT INTO lore_links(id,campaign_id,source_id,target_kind,target_id,label,created_at) VALUES(?,?,?,?,?,?,?)').run(linkId, campaignId, id, body.targetKind, body.targetId, body.label?.trim() || null, now);
            else db.prepare('DELETE FROM lore_links WHERE id=? AND source_id=?').run(linkId, id);
            db.prepare('UPDATE lore_entries SET revision=?,updated_at=? WHERE id=? AND revision=?').run(revision, now, id, body.baseRevision);
            const event = insertEvent({ operationId: body.operationId, kind: mode === 'link.create' ? 'lore.link.created' : 'lore.link.removed', visibility: 'gm', payload: { entryId: id, linkId, targetKind: mode === 'link.create' ? body.targetKind : existingLink.target_kind, targetId: mode === 'link.create' ? body.targetId : existingLink.target_id, revision } });
            result.eventCursor = Number(event.lastInsertRowid);
            db.prepare('INSERT INTO lore_operations(operation_id,principal_id,request_hash,response) VALUES(?,?,?,?)').run(body.operationId, auth.principalId, requestHash, JSON.stringify(result));
          });
          notify(); return json(res, 200, result);
        }
        const states = { archive: 1, restore: 0, publish: 'shared', revoke: 'gm' };
        const isArchive = mode === 'archive' || mode === 'restore';
        if (mode === 'archive' && current.archived || mode === 'restore' && !current.archived
          || mode === 'publish' && (current.visibility === 'shared' || current.published || current.archived) || mode === 'revoke' && current.visibility !== 'shared' && !current.published)
          return json(res, 409, { error: 'Lore command does not match the current entry state', reasonCode: 'invalid_transition', currentRevision: current.revision });
        const revision = current.revision + 1, now = new Date().toISOString();
        const visibility = isArchive ? (current.visibility || (current.published ? 'shared' : 'gm')) : states[mode];
        const result = { id, revision, archived: isArchive ? Boolean(states[mode]) : Boolean(current.archived), visibility, published: visibility === 'shared', updatedAt: now };
        transaction(() => {
          if (isArchive) db.prepare('UPDATE lore_entries SET archived=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(states[mode], revision, now, id, body.baseRevision);
          else db.prepare('UPDATE lore_entries SET visibility=?,published=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(visibility, visibility === 'shared' ? 1 : 0, revision, now, id, body.baseRevision);
          const event = insertEvent({ operationId: body.operationId, kind: `lore.${mode === 'restore' ? 'restored' : mode === 'revoke' ? 'revoked' : mode === 'publish' ? 'published' : 'archived'}`, visibility: 'gm', payload: { entryId: id, revision } });
          result.eventCursor = Number(event.lastInsertRowid);
          db.prepare('INSERT INTO lore_operations(operation_id,principal_id,request_hash,response) VALUES(?,?,?,?)').run(body.operationId, auth.principalId, requestHash, JSON.stringify(result));
        });
        notify(); return json(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, sessionJson(auth));
      if (req.method === 'GET' && url.pathname === '/api/lore') {
        const query = (url.searchParams.get('q') || '').trim();
        if (query.length > 200) return json(res, 400, { error: 'Lore search query is too long', reasonCode: 'invalid_lore_query' });
        const after = url.searchParams.get('after') || '';
        const requestedLimit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return json(res, 400, { error: 'Lore limit must be a positive integer', reasonCode: 'invalid_lore_limit' });
        const limit = Math.min(requestedLimit, 100);
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        const visibility = auth.role === 'gm' ? '1=1' : "archived=0 AND visibility='shared'";
        const searchable = auth.role === 'gm' ? '(title LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\' OR summary LIKE ? ESCAPE \'\\\' OR body LIKE ? ESCAPE \'\\\' OR gm_notes LIKE ? ESCAPE \'\\\')'
          : '(title LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\')';
        const params = query ? [campaignId, after, ...Array(auth.role === 'gm' ? 5 : 2).fill(pattern), limit + 1] : [campaignId, after, limit + 1];
        const rows = query
          ? db.prepare(`SELECT * FROM lore_entries WHERE campaign_id=? AND ${visibility} AND id>? AND ${searchable} ORDER BY id LIMIT ?`).all(...params)
          : db.prepare(`SELECT * FROM lore_entries WHERE campaign_id=? AND ${visibility} AND id>? ORDER BY id LIMIT ?`).all(...params);
        const page = rows.slice(0, limit);
        return json(res, 200, { articles: page.map(row => loreProjection(row, auth)), next: rows.length > limit ? page.at(-1).id : null, hasMore: rows.length > limit });
      }
      const loreItemMatch = req.method === 'GET' && url.pathname.match(/^\/api\/lore\/([^/]+)$/);
      if (loreItemMatch) {
        const row = loreRow.get(decodeURIComponent(loreItemMatch[1]), campaignId);
        if (!canReadLore(row, auth)) return json(res, 404, { error: 'Lore entry not found' });
        return json(res, 200, { article: loreProjection(row, auth), links: loreLinks(row.id, auth) });
      }
      const sessionTimelineMatch = req.method === 'GET' && url.pathname.match(/^\/api\/session\/([^/]+)\/timeline$/);
      if (sessionTimelineMatch) {
        const sessionId = decodeURIComponent(sessionTimelineMatch[1]);
        const session = db.prepare('SELECT * FROM sessions WHERE id=? AND campaign_id=?').get(sessionId, campaignId);
        if (!session || !visibleEncounter(session.encounter_id, auth)) return json(res, 404, { error: 'Session not found' });
        const after = url.searchParams.has('after') ? Number(url.searchParams.get('after')) : 0;
        const requestedLimit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1)
          return json(res, 400, { error: 'Timeline cursor and limit must be positive integers', reasonCode: 'invalid_timeline_cursor' });
        const limit = Math.min(requestedLimit, 200);
        const scanned = db.prepare("SELECT * FROM events WHERE json_extract(payload,'$.sessionId')=? AND cursor>? ORDER BY cursor LIMIT 1001").all(sessionId, after);
        const authorized = scanned.filter(event => visibleEvent(event, auth));
        const hasVisibleOverflow = authorized.length > limit;
        const page = authorized.slice(0, limit);
        const hasMore = hasVisibleOverflow || scanned.length > 1000;
        const nextCursor = hasVisibleOverflow
          ? Number(page.at(-1).cursor)
          : scanned.length > 1000 ? Number(scanned[999].cursor) : scanned.length ? Number(scanned.at(-1).cursor) : after;
        const highWaterCursor = Number(db.prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM events WHERE json_extract(payload,'$.sessionId')=?").get(sessionId).cursor);
        return json(res, 200, { sessionId, events: page.map(event => eventJson(event, auth)), nextCursor, hasMore, highWaterCursor });
      }
      if (req.method === 'POST' && url.pathname === '/api/session/commands') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required', reasonCode: 'unauthorized' });
        const body = await readBody(req);
        const fields = ['operationId', 'command', 'sessionId', 'baseRevision', 'encounterId', 'encounterRevision'];
        if (!body || Object.keys(body).some(key => !fields.includes(key)) || typeof body.operationId !== 'string' || !body.operationId || body.operationId.length > 128
          || !['start', 'pause', 'resume', 'finish'].includes(body.command) || typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 128
          || !Number.isInteger(body.baseRevision) || body.baseRevision < 0
          || body.command === 'start' && (typeof body.encounterId !== 'string' || !body.encounterId || body.encounterId.length > 128 || !Number.isInteger(body.encounterRevision) || body.encounterRevision < 1)
          || body.command !== 'start' && (Object.hasOwn(body, 'encounterId') || Object.hasOwn(body, 'encounterRevision')))
          return json(res, 400, { error: 'operationId, command, sessionId, baseRevision, and start encounter target are required', reasonCode: 'invalid_command' });
        const requestHash = createHash('sha256').update(canonicalJson({ campaignId, command: body.command, sessionId: body.sessionId, baseRevision: body.baseRevision, ...(body.command === 'start' ? { encounterId: body.encounterId, encounterRevision: body.encounterRevision } : {}) })).digest('hex');
        const cached = db.prepare('SELECT * FROM session_operations WHERE operation_id=?').get(body.operationId);
        if (cached) {
          if (cached.request_hash !== requestHash || cached.principal_id !== auth.principalId) return json(res, 409, { error: 'Operation ID was already used for a different command', reasonCode: 'operation_id_collision' });
          return json(res, 200, JSON.parse(cached.response));
        }
        if (db.prepare('SELECT 1 FROM operations WHERE id=? UNION SELECT 1 FROM offline_receipts WHERE operation_id=? UNION SELECT 1 FROM events WHERE operation_id=?').get(body.operationId, body.operationId, body.operationId))
          return json(res, 409, { error: 'Operation ID was already used', reasonCode: 'operation_id_collision' });
        const state = db.prepare('SELECT current_session_id,revision FROM session_state WHERE campaign_id=?').get(campaignId);
        if (state.revision !== body.baseRevision) return json(res, 409, { error: 'Session revision conflict', reasonCode: 'revision_conflict', currentRevision: state.revision });
        const current = state.current_session_id ? db.prepare('SELECT * FROM sessions WHERE id=?').get(state.current_session_id) : null;
        const valid = body.command === 'start' ? !current || current.status === 'finished'
          : current?.id === body.sessionId && (body.command === 'pause' ? current.status === 'active' : body.command === 'resume' ? current.status === 'paused' : ['active', 'paused'].includes(current.status));
        if (!valid) return json(res, 409, { error: 'Session transition is not valid for the current state', reasonCode: 'invalid_transition' });
        if (body.command === 'start') {
          const campaign = campaignJson();
          const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(body.encounterId);
          if (!encounter) return json(res, 409, { error: 'Encounter target is unavailable', reasonCode: 'encounter_not_eligible' });
          if (encounter.revision !== body.encounterRevision)
            return json(res, 409, { error: 'Encounter revision conflict', reasonCode: 'revision_conflict', currentEncounterRevision: encounter.revision });
          if (encounter.status !== 'prepared') return json(res, 409, { error: 'Encounter is not prepared', reasonCode: 'encounter_not_eligible' });
          if (!campaign.systemModuleId || !moduleRow.get(campaign.systemModuleId, campaign.systemModuleVersion))
            return json(res, 409, { error: 'Campaign module pin is unavailable', reasonCode: 'encounter_not_eligible' });
          const eligible = db.prepare(`SELECT 1 FROM encounter_participants p
            JOIN actors a ON a.id=p.actor_id
            WHERE p.encounter_id=? AND p.status='active' AND a.archived=0 AND a.module_id=? AND a.module_version=? LIMIT 1`)
            .get(encounter.id, campaign.systemModuleId, campaign.systemModuleVersion);
          if (!eligible) return json(res, 409, { error: 'Encounter has no eligible participants', reasonCode: 'encounter_not_eligible' });
        }
        if (body.command === 'start' && db.prepare('SELECT 1 FROM sessions WHERE id=?').get(body.sessionId)) return json(res, 409, { error: 'Session ID already exists', reasonCode: 'session_id_conflict' });
        const now = new Date().toISOString();
        const revision = state.revision + 1;
        const eventKind = { start: 'session.started', pause: 'session.paused', resume: 'session.resumed', finish: 'session.finished' }[body.command];
        const nextStatus = { start: 'active', pause: 'paused', resume: 'active', finish: 'finished' }[body.command];
        const result = transaction(() => {
          const sessionRevision = body.command === 'start' ? 1 : current.revision + 1;
          if (body.command === 'start') {
            db.prepare('INSERT INTO sessions(id,campaign_id,encounter_id,status,revision,started_at,updated_at,finished_at) VALUES(?,?,?,?,1,?,?,NULL)').run(body.sessionId, campaignId, body.encounterId, 'active', now, now);
            db.prepare('UPDATE session_state SET current_session_id=?,revision=? WHERE campaign_id=? AND revision=?').run(body.sessionId, revision, campaignId, state.revision);
          } else {
            db.prepare('UPDATE sessions SET status=?,revision=?,updated_at=?,finished_at=? WHERE id=? AND revision=?').run(nextStatus, sessionRevision, now, body.command === 'finish' ? now : null, body.sessionId, current.revision);
            db.prepare('UPDATE session_state SET revision=? WHERE campaign_id=? AND revision=?').run(revision, campaignId, state.revision);
          }
          insertEvent({ operationId: body.operationId, kind: eventKind, visibility: 'public', payload: { operationId: body.operationId, sessionId: body.sessionId, sessionRevision, revision } });
          const response = { operationId: body.operationId, status: 'applied', ...sessionJson(auth) };
          db.prepare('INSERT INTO session_operations(operation_id,request_hash,principal_id,response) VALUES(?,?,?,?)').run(body.operationId, requestHash, auth.principalId, JSON.stringify(response));
          return response;
        });
        notify();
        return json(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/proposals/mine') {
        if (auth.memberId === null) return json(res, 403, { error: 'Enrolled member identity required' });
        const rows = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? ORDER BY created_at DESC LIMIT 200').all(auth.memberId);
        return json(res, 200, { receipts: rows.map(receiptJson) });
      }
      if (req.method === 'GET' && url.pathname === '/api/proposals') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const status = url.searchParams.get('status');
        if (status && !['pending', 'accepted', 'rejected', 'conflict'].includes(status)) return json(res, 400, { error: 'Invalid proposal status' });
        const rows = status
          ? db.prepare('SELECT * FROM offline_proposals WHERE status=? ORDER BY created_at,id LIMIT 200').all(status)
          : db.prepare('SELECT * FROM offline_proposals ORDER BY created_at,id LIMIT 200').all();
        return json(res, 200, { proposals: rows.map(row => ({ id: row.id, operationId: row.operation_id, memberId: row.member_id, entityId: row.actor_id, actionId: row.action_id, requestHash: row.request_hash, campaignId: row.campaign_id, baseRevision: row.base_revision, ruleVersion: row.rule_version, status: row.status, createdAt: row.created_at, decidedAt: row.decided_at, decisionId: row.decision_id, decision: row.decision })) });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/proposals/')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const proposalId = decodeURIComponent(url.pathname.slice('/api/proposals/'.length));
        const row = db.prepare('SELECT * FROM offline_proposals WHERE id=?').get(proposalId);
        if (!row) return json(res, 404, { error: 'Proposal not found' });
        return json(res, 200, { id: row.id, operationId: row.operation_id, memberId: row.member_id, entityId: row.actor_id, actionId: row.action_id, requestHash: row.request_hash, campaignId: row.campaign_id, baseRevision: row.base_revision, ruleVersion: row.rule_version, request: JSON.parse(row.request), status: row.status, createdAt: row.created_at, decidedAt: row.decided_at, decisionId: row.decision_id, decision: row.decision, decisionResponse: row.decision_response ? JSON.parse(row.decision_response) : null });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/offline/operations/')) {
        if (auth.memberId === null) return json(res, 403, { error: 'Enrolled member identity required' });
        const operationId = decodeURIComponent(url.pathname.slice('/api/offline/operations/'.length));
        const receipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operationId);
        if (!receipt) return json(res, 404, { error: 'Offline receipt not found' });
        return json(res, 200, receiptJson(receipt));
      }
      if (req.method === 'PUT' && /^\/api\/actors\/[^/]+$/.test(url.pathname)) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const body = await readBody(req);
        const id = decodeURIComponent(url.pathname.slice('/api/actors/'.length));
        const actor = actorRow.get(id);
        if (!actor) return json(res, 404, { error: 'Actor not found' });
        if (!body || typeof body.operationId !== 'string' || !body.operationId || !Number.isInteger(body.baseRevision)
          || !body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)
          || Object.keys(body).some(key => !['operationId', 'baseRevision', 'changes'].includes(key)))
          return json(res, 400, { error: 'Operation ID, base revision, and editable field changes are required' });
        const hash = createHash('sha256').update(canonicalJson({ kind: 'actor.edit', id, baseRevision: body.baseRevision, changes: body.changes })).digest('hex');
        const cached = db.prepare('SELECT * FROM operations WHERE id=?').get(body.operationId);
        if (cached) {
          if (cached.actor_id !== id || cached.action_id !== 'actor.edit' || cached.principal_id !== auth.principalId || cached.request_hash !== hash)
            return json(res, 409, { error: 'Operation ID was already used for a different command' });
          return json(res, 200, JSON.parse(cached.response));
        }
        if (actor.revision !== body.baseRevision) return json(res, 409, { error: 'Character revision conflict', reasonCode: 'revision_conflict', currentRevision: actor.revision });
        const manifest = JSON.parse(moduleRow.get(actor.module_id, actor.module_version).manifest);
        const allowed = manifest.schema?.properties || {};
        const forbidden = new Set(['moduleId','moduleVersion','schemaVersion','entityId','revision','derived']);
        const keys = Object.keys(body.changes);
        if (!keys.length || keys.some(key => !Object.hasOwn(allowed, key) || forbidden.has(key)))
          return json(res, 400, { error: 'Only declared editable character fields may be changed' });
        const next = { ...JSON.parse(actor.data), ...body.changes, revision: actor.revision + 1 };
        validateSchema(next, manifest.schema);
        const result = { operationId: body.operationId, entityId: id, status: 'applied', revision: next.revision };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(next), next.revision, id);
          insertEvent({ operationId: body.operationId, actorId: id, kind: 'actor.edited', visibility: 'public', payload: { operationId: body.operationId, revision: next.revision, changedFields: keys } });
          db.prepare('INSERT INTO operations(id,response,actor_id,action_id,request_hash,principal_id) VALUES(?,?,?,?,?,?)')
            .run(body.operationId, JSON.stringify(result), id, 'actor.edit', hash, auth.principalId);
        });
        notify();
        return json(res, 200, result);
      }
      if (req.method === 'GET' && /^\/api\/encounters\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.slice('/api/encounters/'.length));
        const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
        if (!encounter || auth.role !== 'gm' && encounter.visibility !== 'public') return json(res, 404, { error: 'Encounter not found' });
        if (auth.role !== 'gm' && encounter.visibility !== 'public') return json(res, 404, { error: 'Encounter not found' });
        const projection = encounterJson(encounter, auth);
        const legacyFixture = legacyEncounters.some(item => item.id === id);
        return json(res, 200, legacyFixture ? { id: projection.id, name: projection.name, summary: projection.summary } : projection);
      }
      if (req.method === 'PUT' && /^\/api\/encounters\/[^/]+$/.test(url.pathname)) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const body = await readBody(req);
        const id = decodeURIComponent(url.pathname.slice('/api/encounters/'.length));
        const current = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
        if (!current) return json(res, 404, { error: 'Encounter not found' });
        if (!Number.isInteger(body.baseRevision) || body.baseRevision !== current.revision) return json(res, 409, { error: 'Encounter revision conflict', reasonCode: 'revision_conflict', currentRevision: current.revision });
        const name = body.name ?? current.name, summary = body.summary ?? current.summary, status = body.status ?? current.status;
        const visibility = body.visibility ?? current.visibility, gmNotes = body.gmNotes ?? current.gm_notes;
        if (Object.keys(body).some(key => !['baseRevision','name','summary','status','visibility','gmNotes'].includes(key)) || typeof name !== 'string' || !name.trim() || name.length > 160 || typeof summary !== 'string' || summary.length > 4000 || typeof gmNotes !== 'string' || gmNotes.length > 8000 || !['public','gm'].includes(visibility) || !['prepared', 'active', 'completed'].includes(status)) return json(res, 400, { error: 'Invalid encounter fields' });
        transaction(() => {
          db.prepare('UPDATE encounters SET name=?,summary=?,status=?,visibility=?,gm_notes=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(name.trim(), summary, status, visibility, gmNotes, new Date().toISOString(), id, body.baseRevision);
          if (status === 'completed') db.prepare("UPDATE campaign SET context='{}' WHERE id=? AND json_extract(context,'$.activeEncounter')=?").run(campaignId, id);
          insertEvent({ kind: 'encounter.updated', visibility: visibility === 'public' ? 'public' : 'gm', payload: { encounterId: id, revision: current.revision + 1 } });
          if (status === 'completed' && JSON.parse(db.prepare('SELECT context FROM campaign WHERE id=?').get(campaignId).context).activeEncounter === id) {
            insertEvent({ kind: 'context.changed', visibility: 'public', payload: { activeEncounter: null } });
          }
        });
        notify();
        return json(res, 200, encounterJson(db.prepare('SELECT * FROM encounters WHERE id=?').get(id), auth));
      }
      if (req.method === 'PUT' && /^\/api\/encounters\/[^/]+\/participants$/.test(url.pathname)) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const body = await readBody(req);
        const id = decodeURIComponent(url.pathname.slice('/api/encounters/'.length, -'/participants'.length));
        const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
        if (!encounter) return json(res, 404, { error: 'Encounter not found' });
        if (!Number.isInteger(body.baseRevision) || body.baseRevision !== encounter.revision) return json(res, 409, { error: 'Encounter revision conflict', reasonCode: 'revision_conflict', currentRevision: encounter.revision });
        if (!Array.isArray(body.participants) || body.participants.length > 200 || body.participants.some((item, index) => !item || typeof item.actorId !== 'string' || !item.actorId || ![null, undefined].includes(item.initiative) && !Number.isFinite(item.initiative) || !['active', 'defeated', 'removed'].includes(item.status || 'active') || ![null, undefined].includes(item.activationOrder) && (!Number.isInteger(item.activationOrder) || item.activationOrder < 0) || body.participants.findIndex(candidate => candidate?.actorId === item.actorId) !== index)) return json(res, 400, { error: 'Invalid or duplicate encounter participants' });
        const campaign = campaignJson();
        for (const item of body.participants) {
          const participant = actorRow.get(item.actorId);
          if (!participant || participant.archived || !campaign.systemModuleId || participant.module_id !== campaign.systemModuleId || participant.module_version !== campaign.systemModuleVersion)
            return json(res, 404, { error: 'Participant unavailable' });
        }
        transaction(() => {
          db.prepare('DELETE FROM encounter_participants WHERE encounter_id=?').run(id);
          const add = db.prepare('INSERT INTO encounter_participants(encounter_id,actor_id,initiative,status,activation_order) VALUES(?,?,?,?,?)');
          for (const item of body.participants) add.run(id, item.actorId, item.initiative ?? null, item.status || 'active', item.activationOrder ?? null);
          db.prepare('UPDATE encounters SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(new Date().toISOString(), id, body.baseRevision);
          insertEvent({ kind: 'encounter.participants.changed', visibility: encounter.visibility === 'public' ? 'public' : 'gm', payload: { encounterId: id, revision: encounter.revision + 1 } });
        });
        notify();
        return json(res, 200, encounterJson(db.prepare('SELECT * FROM encounters WHERE id=?').get(id), auth));
      }
      if ((req.method === 'GET' || req.method === 'PUT') && url.pathname === '/api/campaign') {
        if (req.method === 'GET') return json(res, 200, campaignJson());
        const body = await readBody(req);
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body || Object.keys(body).some(key => !['name', 'systemModuleId', 'systemModuleVersion', 'baseRevision'].includes(key)) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160 || !Number.isInteger(body.baseRevision) || body.baseRevision < 1 || (body.systemModuleId === null) !== (body.systemModuleVersion === null) || body.systemModuleId !== null && (typeof body.systemModuleId !== 'string' || typeof body.systemModuleVersion !== 'string' || !moduleRow.get(body.systemModuleId, body.systemModuleVersion))) return json(res, 400, { error: 'Campaign name, registered module pin, and positive baseRevision are required' });
        const current = campaignJson();
        if (body.baseRevision !== current.revision) return json(res, 409, { error: 'Campaign revision conflict', reasonCode: 'revision_conflict', currentRevision: current.revision });
        if (current.systemModuleId && (body.systemModuleId !== current.systemModuleId || body.systemModuleVersion !== current.systemModuleVersion))
          return json(res, 409, { error: 'Pinned campaign module requires an explicit migration' });
        transaction(() => {
          db.prepare('UPDATE campaign SET name=?,system_module_id=?,system_module_version=?,revision=revision+1 WHERE id=? AND revision=?').run(body.name.trim(), body.systemModuleId, body.systemModuleVersion, campaignId, body.baseRevision);
          insertEvent({ kind: 'campaign.updated', visibility: 'gm', payload: { campaignId, revision: current.revision + 1 } });
        });
        notify();
        return json(res, 200, campaignJson());
      }
      if (req.method === 'GET' && url.pathname === '/api/encounters') return json(res, 200, { encounters: publicEncounters(auth) });
      if (req.method === 'POST' && url.pathname === '/api/encounters') {
        const body = await readBody(req);
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body || Object.keys(body).some(key => !['id','name','summary','status','visibility','gmNotes'].includes(key)) || typeof body.id !== 'string' || !body.id || body.id.length > 128 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160 || typeof (body.summary ?? '') !== 'string' || (body.summary ?? '').length > 4000 || typeof (body.gmNotes ?? '') !== 'string' || (body.gmNotes ?? '').length > 8000 || !['public','gm'].includes(body.visibility || 'public') || body.status !== undefined && !['prepared', 'active', 'completed'].includes(body.status)) return json(res, 400, { error: 'Encounter ID, name, summary and valid status required' });
        const timestamp = new Date().toISOString();
        try {
          transaction(() => {
            db.prepare('INSERT INTO encounters(id,name,summary,status,revision,created_at,updated_at,visibility,gm_notes) VALUES(?,?,?,?,1,?,?,?,?)').run(body.id, body.name.trim(), body.summary || '', body.status || 'prepared', timestamp, timestamp, body.visibility || 'public', body.gmNotes || '');
            insertEvent({ kind: 'encounter.created', visibility: (body.visibility || 'public') === 'public' ? 'public' : 'gm', payload: { encounterId: body.id, revision: 1 } });
          });
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'Encounter ID already exists' });
          throw error;
        }
        notify();
        return json(res, 201, encounterJson(db.prepare('SELECT * FROM encounters WHERE id=?').get(body.id), auth));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/actors/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/actors/'.length));
        const actor = actorRow.get(id);
        if (!actor || actor.archived || !canReadActor(actor, auth)) return json(res, 404, { error: 'Actor not found' });
        return json(res, 200, projectActor(actor, auth));
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        const rawSince = url.searchParams.get('since');
        const requestedCursor = rawSince === null ? 0 : Number(rawSince);
        if (!Number.isSafeInteger(requestedCursor) || requestedCursor < 0) return json(res, 400, { error: 'Cursor must be a non-negative safe integer', reasonCode: 'invalid_cursor' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write('retry: 1500\n\n');
        const firstCursor = Number(db.prepare('SELECT COALESCE(MIN(cursor),?) AS n FROM events').get(latest() + 1).n);
        const currentCursor = latest();
        const recoveryReason = requestedCursor > currentCursor ? 'cursor_ahead' : requestedCursor < firstCursor - 1 ? 'cursor_expired' : null;
        const client = { res, auth, cursor: recoveryReason ? currentCursor : requestedCursor };
        clients.add(client);
        if (recoveryReason) res.write(`id: ${currentCursor}\nevent: update\ndata: ${JSON.stringify({ kind: 'recovery.required', reason: recoveryReason })}\n\n`);
        // Replaying from a cursor closes the notification gap between snapshot and subscription.
        notifyClient(client);
        req.on('close', () => clients.delete(client));
        return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/actors/') && url.pathname.includes('/grants/')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const [actorPath, memberPart] = url.pathname.slice('/api/actors/'.length).split('/grants/');
        const actorId = decodeURIComponent(actorPath);
        const memberId = decodeURIComponent(memberPart || '');
        if (!actorRow.get(actorId) || !db.prepare('SELECT 1 FROM members WHERE id=?').get(memberId)) return json(res, 404, { error: 'Actor or member not found' });
        const result = transaction(() => {
          const deleted = db.prepare('DELETE FROM actor_grants WHERE actor_id=? AND member_id=?').run(actorId, memberId);
          if (deleted.changes) insertEvent({ kind: 'actor.grant_revoked', visibility: 'gm', payload: { actorId, memberId } });
          return deleted;
        });
        if (result.changes) notify();
        return json(res, result.changes ? 200 : 404, result.changes ? { actorId, memberId, revoked: true } : { error: 'Grant not found' });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/members/')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const memberId = decodeURIComponent(url.pathname.slice('/api/members/'.length));
        const result = transaction(() => {
          const updated = db.prepare('UPDATE members SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(new Date().toISOString(), memberId);
          if (updated.changes) insertEvent({ kind: 'member.revoked', visibility: 'gm', payload: { memberId } });
          return updated;
        });
        if (!result.changes) return json(res, 404, { error: 'Member not found' });
        notify();
        for (const client of clients) if (client.auth.memberId === memberId) { clients.delete(client); client.res.end(); }
        return json(res, 200, { memberId, revoked: true });
      }
      if (req.method === 'PUT' && /^\/api\/actors\/[^/]+\/archive$/.test(url.pathname)) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const body = await readBody(req);
        const id = decodeURIComponent(url.pathname.slice('/api/actors/'.length, -'/archive'.length));
        const actor = actorRow.get(id);
        if (!actor) return json(res, 404, { error: 'Actor not found' });
        if (!Number.isInteger(body.baseRevision) || body.baseRevision !== actor.revision || typeof body.archived !== 'boolean') return json(res, 409, { error: 'Actor revision conflict or archive state required', reasonCode: 'revision_conflict', currentRevision: actor.revision });
        const revision = actor.revision + 1, data = { ...JSON.parse(actor.data), revision };
        transaction(() => {
          db.prepare('UPDATE actors SET archived=?,revision=?,data=? WHERE id=? AND revision=?').run(body.archived ? 1 : 0, revision, JSON.stringify(data), id, body.baseRevision);
          if (body.archived) db.prepare('DELETE FROM encounter_participants WHERE actor_id=?').run(id);
          insertEvent({ actorId: id, kind: body.archived ? 'actor.archived' : 'actor.restored', visibility: 'public', payload: { actorId: id, revision } });
        });
        notify();
        return json(res, 200, { id, archived: body.archived, revision });
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      const rotationMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/rotate$/);
      if (rotationMatch) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const memberId = decodeURIComponent(rotationMatch[1]);
        const credential = randomBytes(32).toString('base64url');
        const credentialHash = createHash('sha256').update(credential).digest('hex');
        const rotated = transaction(() => {
          const result = db.prepare('UPDATE members SET credential_hash=? WHERE id=? AND revoked_at IS NULL').run(credentialHash, memberId);
          if (result.changes) insertEvent({ kind: 'member.credential_rotated', visibility: 'gm', payload: { memberId } });
          return result.changes;
        });
        if (!rotated) return json(res, 404, { error: 'Member not found' });
        for (const client of clients) if (client.auth.memberId === memberId) { clients.delete(client); client.res.end(); }
        notify();
        return json(res, 200, { memberId, credential });
      }
      const decisionMatch = url.pathname.match(/^\/api\/proposals\/([^/]+)\/decisions$/);
      if (decisionMatch) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (typeof body.decisionId !== 'string' || !body.decisionId || !['accept', 'reject'].includes(body.decision)) return json(res, 400, { error: 'decisionId and accept/reject decision required' });
        if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) return json(res, 400, { error: 'reason must be a string of at most 500 characters' });
        const proposalId = decodeURIComponent(decisionMatch[1]);
        const decisionHash = createHash('sha256').update(canonicalJson({ proposalId, decisionId: body.decisionId, decision: body.decision, reason: body.reason || null })).digest('hex');
        const existingDecision = db.prepare('SELECT proposal_id,request_hash,response FROM offline_decisions WHERE decision_id=?').get(body.decisionId);
        if (existingDecision) {
          if (existingDecision.proposal_id !== proposalId || existingDecision.request_hash !== decisionHash) return json(res, 409, { error: 'Decision ID was already used for a different decision' });
          const decidedProposal = db.prepare('SELECT member_id,operation_id FROM offline_proposals WHERE id=?').get(proposalId);
          const decidedReceipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(decidedProposal.member_id, decidedProposal.operation_id);
          return json(res, 200, receiptJson(decidedReceipt));
        }
        const proposal = db.prepare('SELECT * FROM offline_proposals WHERE id=?').get(proposalId);
        if (!proposal) return json(res, 404, { error: 'Proposal not found' });
        if (proposal.status !== 'pending') return json(res, 409, { error: 'Proposal has already been decided', status: proposal.status });
        const now = new Date().toISOString();
        if (body.decision === 'reject') {
          const result = { proposalId, operationId: proposal.operation_id, entityId: proposal.actor_id, status: 'rejected', decisionId: body.decisionId, reasonCode: 'gm_rejected', reason: body.reason || null };
          transaction(() => {
            db.prepare('UPDATE offline_proposals SET status=?,decided_at=?,decision_id=?,decision=?,decision_response=? WHERE id=? AND status=?')
              .run('rejected', now, body.decisionId, 'reject', JSON.stringify(result), proposalId, 'pending');
            db.prepare('UPDATE offline_receipts SET status=?,response=?,updated_at=? WHERE member_id=? AND operation_id=?')
              .run('rejected', JSON.stringify(result), now, proposal.member_id, proposal.operation_id);
            db.prepare('INSERT INTO offline_decisions(decision_id,proposal_id,request_hash,response,created_at) VALUES(?,?,?,?,?)')
              .run(body.decisionId, proposalId, decisionHash, JSON.stringify(result), now);
            insertEvent({ kind: 'offline.proposal.decided', visibility: 'gm', payload: { proposalId, operationId: proposal.operation_id, status: 'rejected', decisionId: body.decisionId, reason: body.reason || null } });
          });
          notify();
          const receipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(proposal.member_id, proposal.operation_id);
          return json(res, 200, receiptJson(receipt));
        }
        const operation = JSON.parse(proposal.request);
        let validation = validateOfflineCommand(operation, { role: 'player', memberId: proposal.member_id, principalId: proposal.member_id }, 'gmReview');
        if (!validation.error && proposal.rule_version !== null && (validation.manifest.rulesVersion || 1) !== proposal.rule_version) {
          validation = { error: 'Rules version changed after proposal submission', reasonCode: 'rules_version_conflict', currentRevision: validation.actor.revision };
        }
        if (validation.error) {
          const result = { proposalId, operationId: proposal.operation_id, entityId: proposal.actor_id, status: 'conflicted', decisionId: body.decisionId, reasonCode: validation.reasonCode, currentRevision: validation.currentRevision };
          transaction(() => {
            db.prepare('UPDATE offline_proposals SET status=?,decided_at=?,decision_id=?,decision=?,decision_response=? WHERE id=? AND status=?')
              .run('conflict', now, body.decisionId, 'accept', JSON.stringify(result), proposalId, 'pending');
            db.prepare('UPDATE offline_receipts SET status=?,response=?,updated_at=? WHERE member_id=? AND operation_id=?')
              .run('conflicted', JSON.stringify(result), now, proposal.member_id, proposal.operation_id);
            db.prepare('INSERT INTO offline_decisions(decision_id,proposal_id,request_hash,response,created_at) VALUES(?,?,?,?,?)')
              .run(body.decisionId, proposalId, decisionHash, JSON.stringify(result), now);
            insertEvent({ kind: 'offline.proposal.conflicted', visibility: 'gm', payload: { proposalId, operationId: proposal.operation_id, reasonCode: validation.reasonCode, currentRevision: validation.currentRevision } });
          });
          notify();
          const receipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(proposal.member_id, proposal.operation_id);
          return json(res, 200, receiptJson(receipt));
        }
        const executed = validation.tested;
        const revision = validation.actor.revision + 1;
        executed.state.revision = revision;
        const result = { proposalId, operationId: proposal.operation_id, entityId: proposal.actor_id, status: 'applied', decisionId: body.decisionId, revision, ...verifiedResult(executed) };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), revision, proposal.actor_id);
          db.prepare('UPDATE offline_proposals SET status=?,decided_at=?,decision_id=?,decision=?,decision_response=? WHERE id=? AND status=?')
            .run('accepted', now, body.decisionId, 'accept', JSON.stringify(result), proposalId, 'pending');
          db.prepare('UPDATE offline_receipts SET status=?,response=?,updated_at=? WHERE member_id=? AND operation_id=?')
            .run('applied', JSON.stringify(result), now, proposal.member_id, proposal.operation_id);
          db.prepare('INSERT INTO offline_decisions(decision_id,proposal_id,request_hash,response,created_at) VALUES(?,?,?,?,?)')
            .run(body.decisionId, proposalId, decisionHash, JSON.stringify(result), now);
          insertEvent({ actorId: proposal.actor_id, kind: 'action.applied', visibility: 'public', payload: { ...result, memberId: proposal.member_id, actionId: proposal.action_id, moduleId: validation.actor.module_id, moduleVersion: validation.actor.module_version, schemaVersion: operation.schemaVersion, ruleVersion: validation.manifest.rulesVersion, verified: true } });
          insertEvent({ kind: 'offline.proposal.decided', visibility: 'gm', payload: { proposalId, operationId: proposal.operation_id, status: 'accepted', decisionId: body.decisionId, reason: body.reason || null } });
        });
        notify();
        const receipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(proposal.member_id, proposal.operation_id);
        return json(res, 200, receiptJson(receipt));
      }
      if (url.pathname === '/api/offline/operations') {
        if (auth.memberId === null || auth.role !== 'player') return json(res, 403, { error: 'Enrolled member identity required' });
        const required = ['operationId', 'campaignId', 'memberId', 'entityId', 'baseRevision', 'moduleId', 'moduleVersion', 'schemaVersion', 'actionId', 'parameters', 'dependencies'];
        if (required.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key))) return json(res, 400, { error: 'Full OfflineOperation fields are required; unknown fields are not accepted' });
        if (required.filter(key => !['baseRevision', 'schemaVersion', 'parameters', 'dependencies'].includes(key)).some(key => typeof body[key] !== 'string' || !body[key])) return json(res, 400, { error: 'OfflineOperation identifiers must be non-empty strings' });
        if (!Number.isInteger(body.baseRevision) || body.baseRevision < 1 || !Number.isInteger(body.schemaVersion) || body.schemaVersion < 1
          || !body.parameters || typeof body.parameters !== 'object' || Array.isArray(body.parameters) || !Array.isArray(body.dependencies)) return json(res, 400, { error: 'Invalid OfflineOperation revision, parameters, or dependencies' });
        if (body.memberId !== auth.memberId) return json(res, 403, { error: 'Authenticated member does not match operation memberId' });
        if (body.campaignId !== campaignId) return json(res, 409, { error: 'Campaign mismatch', reasonCode: 'campaign_conflict' });
        const operation = Object.fromEntries(required.map(key => [key, body[key]]));
        const requestHash = createHash('sha256').update(canonicalJson({ scope: { campaignId, memberId: auth.memberId }, operation })).digest('hex');
        const cached = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operation.operationId);
        if (cached) {
          if (cached.request_hash !== requestHash || cached.campaign_id !== campaignId) return json(res, 409, { error: 'Operation ID was already used for a different request', reasonCode: 'operation_id_collision' });
          return json(res, 200, receiptJson(cached));
        }
        const validation = validateOfflineCommand(operation, auth);
        const now = new Date().toISOString();
        if (validation.error) {
          const status = validation.status === 409 || validation.status === 404 ? 'conflicted' : 'rejected';
          const receipt = { operationId: operation.operationId, entityId: operation.entityId, status, reasonCode: validation.reasonCode, currentRevision: validation.currentRevision };
          transaction(() => db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(auth.memberId, operation.operationId, campaignId, requestHash, status, null, JSON.stringify(receipt), now, now));
          return json(res, 200, receiptJson(db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operation.operationId)));
        }
        if (validation.policy === 'gmReview') {
          const proposalId = randomUUID();
          const receipt = { operationId: operation.operationId, entityId: operation.entityId, status: 'awaitingReview', proposalId };
          transaction(() => {
            db.prepare('INSERT INTO offline_proposals(id,operation_id,member_id,actor_id,action_id,request_hash,request,campaign_id,base_revision,rule_version,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
              .run(proposalId, operation.operationId, auth.memberId, operation.entityId, operation.actionId, requestHash, canonicalJson(operation), campaignId, operation.baseRevision, validation.manifest.rulesVersion || 1, 'pending', now);
            db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(auth.memberId, operation.operationId, campaignId, requestHash, 'awaitingReview', proposalId, JSON.stringify(receipt), now, now);
            insertEvent({ actorId: operation.entityId, kind: 'offline.proposal.submitted', visibility: 'gm', payload: { proposalId, operationId: operation.operationId, memberId: auth.memberId, actionId: operation.actionId } });
          });
          notify();
          return json(res, 202, receiptJson(db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operation.operationId)));
        }
        const executed = validation.tested;
        const revision = validation.actor.revision + 1;
        executed.state.revision = revision;
        const receipt = { operationId: operation.operationId, entityId: operation.entityId, status: 'applied', revision, ...verifiedResult(executed) };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), revision, operation.entityId);
          insertEvent({ actorId: operation.entityId, kind: 'action.applied', visibility: 'public', payload: { ...receipt, memberId: auth.memberId, actionId: operation.actionId, moduleId: operation.moduleId, moduleVersion: operation.moduleVersion, schemaVersion: operation.schemaVersion, ruleVersion: validation.manifest.rulesVersion, verified: true } });
          db.prepare('INSERT INTO offline_receipts(member_id,operation_id,campaign_id,request_hash,status,proposal_id,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(auth.memberId, operation.operationId, campaignId, requestHash, 'applied', null, JSON.stringify(receipt), now, now);
        });
        notify();
        return json(res, 200, receiptJson(db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operation.operationId)));
      }
      if (url.pathname === '/api/members/enroll') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 80) return json(res, 400, { error: 'displayName must contain 1 to 80 characters' });
        const memberId = randomUUID();
        const credential = randomBytes(32).toString('base64url');
        const credentialHash = createHash('sha256').update(credential).digest('hex');
        transaction(() => {
          db.prepare('INSERT INTO members(id,display_name,credential_hash,created_at) VALUES(?,?,?,?)')
            .run(memberId, body.displayName.trim(), credentialHash, new Date().toISOString());
          insertEvent({ kind: 'member.enrolled', visibility: 'gm', payload: { memberId, displayName: body.displayName.trim() } });
        });
        notify();
        return json(res, 201, { memberId, displayName: body.displayName.trim(), credential });
      }
      if (url.pathname.startsWith('/api/actors/') && url.pathname.endsWith('/grants')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const actorId = decodeURIComponent(url.pathname.slice('/api/actors/'.length, -'/grants'.length));
        const actor = actorRow.get(actorId);
        const member = db.prepare('SELECT id FROM members WHERE id=? AND revoked_at IS NULL').get(body.memberId);
        if (!actor || !member) return json(res, 404, { error: 'Actor or member not found' });
        const permissions = body.permissions;
        if (!Array.isArray(permissions) || permissions.length === 0 || permissions.some(permission => !['read', 'act'].includes(permission))) return json(res, 400, { error: 'permissions must contain read and/or act' });
        const canRead = permissions.includes('read') || permissions.includes('act') ? 1 : 0;
        const canAct = permissions.includes('act') ? 1 : 0;
        transaction(() => {
          db.prepare('INSERT INTO actor_grants(actor_id,member_id,can_read,can_act,granted_at) VALUES(?,?,?,?,?) ON CONFLICT(actor_id,member_id) DO UPDATE SET can_read=excluded.can_read,can_act=excluded.can_act,granted_at=excluded.granted_at')
            .run(actorId, body.memberId, canRead, canAct, new Date().toISOString());
          insertEvent({ kind: 'actor.granted', visibility: 'gm', payload: { actorId, memberId: body.memberId, permissions: canAct ? ['read', 'act'] : ['read'] } });
        });
        notify();
        return json(res, 201, { actorId, memberId: body.memberId, permissions: canAct ? ['read', 'act'] : ['read'] });
      }
      if (url.pathname === '/api/modules') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body.id || !body.version || !body.manifest || body.manifest.id !== body.id || body.manifest.version !== body.version) return json(res, 400, { error: 'Module id, version and matching manifest required' });
        db.prepare('INSERT OR REPLACE INTO modules(id,version,manifest) VALUES(?,?,?)').run(body.id, body.version, JSON.stringify(body.manifest));
        return json(res, 201, { id: body.id, version: body.version });
      }
      if (url.pathname === '/api/actors') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const campaign = campaignJson();
        if (!body.id || !moduleRow.get(body.moduleId, body.moduleVersion) || !campaign.systemModuleId || body.moduleId !== campaign.systemModuleId || body.moduleVersion !== campaign.systemModuleVersion) return json(res, 409, { error: 'Actor must use the campaign pinned module version' });
        const ownerRole = body.ownerRole || 'player';
        if (!['gm', 'player'].includes(ownerRole)) return json(res, 400, { error: 'ownerRole must be gm or player' });
        if (body.ownerMemberId && !db.prepare('SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL').get(body.ownerMemberId)) return json(res, 400, { error: 'Active ownerMemberId required' });
        const manifest = JSON.parse(moduleRow.get(body.moduleId, body.moduleVersion).manifest);
        const data = { ...(body.data || {}), moduleId: body.moduleId, moduleVersion: body.moduleVersion, schemaVersion: 1, entityId: body.id, revision: 1 };
        validateSchema(data, manifest.schema);
        transaction(() => {
          db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role,owner_member_id,legacy_shared) VALUES(?,?,?,?,?,?,?,?,0)')
            .run(body.id, body.moduleId, body.moduleVersion, 1, JSON.stringify(data), JSON.stringify(body.visibility || {}), ownerRole, body.ownerMemberId || null);
          insertEvent({ actorId: body.id, kind: 'actor.created', visibility: 'public', payload: { moduleId: body.moduleId, moduleVersion: body.moduleVersion } });
        });
        notify();
        return json(res, 201, projectActor(actorRow.get(body.id), auth));
      }
      if (url.pathname === '/api/context') {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body || Object.keys(body).length !== 1 || !body.context || typeof body.context !== 'object' || Array.isArray(body.context)
          || Object.keys(body.context).length !== 1 || !Object.hasOwn(body.context, 'activeEncounter')
          || !(body.context.activeEncounter === null || typeof body.context.activeEncounter === 'string' && db.prepare('SELECT 1 FROM encounters WHERE id=?').get(body.context.activeEncounter))) {
          return json(res, 400, { error: 'context.activeEncounter must be a known encounter ID or null' });
        }
        const context = { activeEncounter: body.context.activeEncounter };
        transaction(() => {
          db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify(context), campaignId);
          const visibility = context.activeEncounter && db.prepare("SELECT visibility FROM encounters WHERE id=?").get(context.activeEncounter)?.visibility === 'gm' ? 'gm' : 'public';
          insertEvent({ kind: 'context.changed', visibility, payload: context });
        });
        notify(); return json(res, 200, { context, revision: latest() });
      }
      if (url.pathname === '/api/actions' || url.pathname === '/api/session/actions') {
        const sessionScoped = url.pathname === '/api/session/actions';
        const { operationId, entityId, baseRevision, actionId, parameters = {} } = body;
        if (typeof operationId !== 'string' || !operationId || operationId.length > 128
          || typeof entityId !== 'string' || !entityId || entityId.length > 128
          || typeof actionId !== 'string' || !actionId || actionId.length > 128
          || !Number.isInteger(baseRevision) || baseRevision < 1)
          return json(res, 400, { error: 'operationId, entityId, actionId and positive integer baseRevision are required', reasonCode: 'invalid_command' });
        let sessionId = null;
        if (sessionScoped) {
          if (typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 128) return json(res, 400, { error: 'sessionId is required', reasonCode: 'invalid_command' });
          sessionId = body.sessionId;
        }
        if (auth.memberId !== null) {
          const required = ['campaignId', 'memberId', 'moduleId', 'moduleVersion', 'schemaVersion'];
          if (required.some(key => !Object.hasOwn(body, key)) || !Array.isArray(body.dependencies || [])) return json(res, 400, { error: 'Offline operation identity, version and dependencies fields required' });
          if (body.memberId !== auth.memberId) return json(res, 403, { error: 'Authenticated member does not match operation memberId' });
          if (body.campaignId !== campaignId) return json(res, 409, { error: 'Campaign mismatch' });
        }
        const actor = actorRow.get(entityId);
        if (!actor || actor.archived || !canActOnActor(actor, auth)) return json(res, 404, { error: 'Actor not found' });
        if (auth.memberId !== null && (body.moduleId !== actor.module_id || body.moduleVersion !== actor.module_version || body.schemaVersion !== JSON.parse(actor.data).schemaVersion)) return json(res, 409, { error: 'Module or schema version mismatch' });
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return json(res, 400, { error: 'parameters must be an object' });
        const requestHash = createHash('sha256').update(canonicalJson({ campaignId: body.campaignId || campaignId, memberId: auth.memberId, entityId, baseRevision, moduleId: body.moduleId || actor.module_id, moduleVersion: body.moduleVersion || actor.module_version, schemaVersion: body.schemaVersion || JSON.parse(actor.data).schemaVersion, actionId, parameters, dependencies: body.dependencies || [], sessionId })).digest('hex');
        const legacyRequestHash = createHash('sha256').update(JSON.stringify({ entityId, baseRevision, actionId, parameters })).digest('hex');
        if (db.prepare('SELECT 1 FROM session_operations WHERE operation_id=? UNION SELECT 1 FROM offline_receipts WHERE operation_id=?').get(operationId, operationId)) return json(res, 409, { error: 'Operation ID was already used for a different command', reasonCode: 'operation_id_collision' });
        const cached = db.prepare('SELECT response,actor_id,action_id,request_hash,principal_id FROM operations WHERE id=?').get(operationId);
        if (cached) {
          // Pre-0.3 receipts had no principal ID. The GM may replay those old
          // commands (including GM-authored ones), while legacy players remain
          // restricted by the actor permission check above.
          const oldFixtureRetry = cached.principal_id === null && cached.request_hash === legacyRequestHash && (auth.role === 'gm' || auth.legacy);
          const currentRetry = cached.principal_id === auth.principalId && cached.request_hash === requestHash;
          if (cached.actor_id !== entityId || cached.action_id !== actionId || !(oldFixtureRetry || currentRetry)) return json(res, 409, { error: 'Operation ID was already used for a different command', reasonCode: 'operation_id_collision' });
          return json(res, 200, JSON.parse(cached.response));
        }
        for (const dependency of body.dependencies || []) {
          if (!dependency || typeof dependency.entityId !== 'string' || !Number.isInteger(dependency.revision)) return json(res, 400, { error: 'Invalid operation dependency' });
          const dependentActor = actorRow.get(dependency.entityId);
          if (!dependentActor || !canReadActor(dependentActor, auth)) return json(res, 404, { error: 'Dependency not found' });
          if (dependentActor.revision !== dependency.revision) return json(res, 409, { error: 'Dependency revision conflict', entityId: dependency.entityId, currentRevision: dependentActor.revision });
        }
        if (sessionScoped) {
          const state = db.prepare('SELECT current_session_id FROM session_state WHERE campaign_id=?').get(campaignId);
          const session = state.current_session_id ? db.prepare('SELECT * FROM sessions WHERE id=? AND campaign_id=?').get(state.current_session_id, campaignId) : null;
          if (!session || session.id !== sessionId || session.status !== 'active') return json(res, 409, { error: 'Session is not active', reasonCode: 'session_not_active' });
        }
        if (baseRevision !== actor.revision) return json(res, 409, { error: 'Revision conflict', currentRevision: actor.revision });
        const manifestRow = moduleRow.get(actor.module_id, actor.module_version);
        const manifest = JSON.parse(manifestRow.manifest);
        const action = (manifest.actions || []).find(a => a.id === actionId);
        if (!action) return json(res, 400, { error: 'Action is not declared by the actor module' });
        if (auth.memberId !== null && action.policy === 'gmReview') return json(res, 403, { error: 'Action requires GM review', reasonCode: 'gm_review_required' });
        if (action.policy && !['selfService', 'gmReview'].includes(action.policy)) return json(res, 400, { error: 'Unsupported action policy' });
        const data = JSON.parse(actor.data);
        const executed = applyRuleAction(action, data, parameters);
        const newRevision = actor.revision + 1;
        executed.state.revision = newRevision;
        const rolls = executed.resolution?.groups.flatMap(group => group.dice) || [];
        const actionReceipt = {
            operationId, entityId: actor.id, actorId: actor.id, status: 'applied', revision: newRevision,
            actionId, moduleId: actor.module_id, moduleVersion: actor.module_version,
            schemaVersion: data.schemaVersion, ruleVersion: manifest.rulesVersion,
            ...(sessionId ? { sessionId } : {}), ...(executed.resolution ? verifiedResult(executed) : {})
          };
        const result = sessionScoped || auth.memberId !== null
          ? actionReceipt
          : { ...actionReceipt, rolls, resolution: executed.resolution };
        let responseResult = result;
        if (auth.role === 'player' && actionUsesHiddenFields(action, actor) && result.resolution) {
          responseResult = {
            ...result,
            resolution: { verified: true, groups: result.resolution.groups.map(group => ({ role: group.role, dice: group.dice })) }
          };
          delete responseResult.total;
          delete responseResult.success;
          delete responseResult.outcome;
        }
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), newRevision, actor.id);
          const event = insertEvent({ operationId, actorId: actor.id, kind: 'action.applied', visibility: 'public', payload: { ...result, entityId: actor.id, actionId, ...(sessionId ? { sessionId } : {}), ...(executed.resolution ? verifiedResult(executed) : {}), moduleId: actor.module_id, moduleVersion: actor.module_version, schemaVersion: data.schemaVersion, ruleVersion: manifest.rulesVersion, parameters } });
          if (auth.memberId !== null || sessionScoped) responseResult.eventCursor = Number(event.lastInsertRowid);
          db.prepare('INSERT INTO operations(id,response,actor_id,action_id,request_hash,principal_id) VALUES(?,?,?,?,?,?)')
            .run(operationId, JSON.stringify(responseResult), entityId, actionId, requestHash, auth.principalId);
        });
        notify(); return json(res, 200, responseResult);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return json(res, 409, { error: 'Resource already exists' });
      return json(res, error.statusCode || 400, { error: error.message || 'Request failed', ...(error.statusCode === 413 ? { reasonCode: 'asset_too_large' } : {}) });
    }
  });
  function notifyClient(client) {
    const rows = db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(client.cursor);
    for (const row of rows) {
      client.cursor = Number(row.cursor);
      if (visibleEvent(row, client.auth)) {
        client.res.write(`id: ${row.cursor}\nevent: update\ndata: ${JSON.stringify(eventJson(row, client.auth))}\n\n`);
      } else if (client.auth.memberId && (row.kind === 'actor.granted' || row.kind === 'actor.grant_revoked')
        && JSON.parse(row.payload).memberId === client.auth.memberId) {
        // Private permission changes need a fresh authorized snapshot, but their
        // GM-only payload (and target actor identity) must never reach the player.
        client.res.write(`id: ${row.cursor}\nevent: update\ndata: {"kind":"permissions.refresh"}\n\n`);
      }
    }
  }
  return {
    server,
    db,
    listen(port = 4177, host = '127.0.0.1') {
      if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Host listener must bind to loopback');
      return new Promise(resolveListen => server.listen(port, host, () => resolveListen(server.address())));
    },
    close() { for (const c of clients) c.res.end(); server.close(); db.close(); }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = createHost({ databasePath: process.env.POTOMAC_DB || './data/potomac.sqlite', gmToken: process.env.POTOMAC_GM_TOKEN || 'local-gm', playerToken: process.env.POTOMAC_PLAYER_TOKEN || 'local-player', seedDemo: process.env.POTOMAC_SEED_DEMO === '1' });
  const address = await host.listen(Number(process.env.PORT || 4177));
  console.log(`Potomac foundation host listening at http://${address.address}:${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => host.close());
}
