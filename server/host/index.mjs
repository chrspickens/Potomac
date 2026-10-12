import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, executeAction, getActionPolicy, getRequiredRollCount } from '../../packages/rules-engine/src/index.ts';

const schema = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS modules (id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, module_version TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT '{}', owner_role TEXT NOT NULL DEFAULT 'player', owner_member_id TEXT, legacy_shared INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation_id TEXT UNIQUE, actor_id TEXT, kind TEXT NOT NULL, visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, response TEXT NOT NULL, actor_id TEXT, action_id TEXT, request_hash TEXT, principal_id TEXT);
CREATE TABLE IF NOT EXISTS offline_receipts (member_id TEXT NOT NULL, operation_id TEXT NOT NULL, campaign_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, proposal_id TEXT, response TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(member_id, operation_id));
CREATE TABLE IF NOT EXISTS offline_proposals (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, member_id TEXT NOT NULL, actor_id TEXT NOT NULL, action_id TEXT NOT NULL, request_hash TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decision_id TEXT UNIQUE, decision TEXT, decision_response TEXT);
CREATE TABLE IF NOT EXISTS offline_decisions (decision_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS offline_proposals_status_created ON offline_proposals(status, created_at);
CREATE INDEX IF NOT EXISTS offline_proposals_member_created ON offline_proposals(member_id, created_at);
CREATE TABLE IF NOT EXISTS campaign (id TEXT PRIMARY KEY, context TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS actor_grants (actor_id TEXT NOT NULL, member_id TEXT NOT NULL, can_read INTEGER NOT NULL, can_act INTEGER NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(actor_id, member_id));
`;

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

const encounters = [
  { id: 'encounter-a', name: 'The Glass Bridge', summary: 'A narrow crossing over a deep ravine.' },
  { id: 'encounter-b', name: 'The Sunken Archive', summary: 'A flooded chamber of forgotten records.' }
];
const encounterById = new Map(encounters.map(encounter => [encounter.id, encounter]));

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
  }
  return { state: next, resolution };
}

// These fixed role tokens are development fixtures; authentication accepts them only on loopback listeners.
export function createHost({ databasePath = './data/potomac.sqlite', gmToken = 'local-gm', playerToken = 'local-player', campaignId = 'foundation-demo' } = {}) {
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(schema);
  const actorColumns = new Set(db.prepare('PRAGMA table_info(actors)').all().map(column => column.name));
  if (!actorColumns.has('owner_member_id')) db.exec('ALTER TABLE actors ADD COLUMN owner_member_id TEXT');
  if (!actorColumns.has('legacy_shared')) {
    db.exec('ALTER TABLE actors ADD COLUMN legacy_shared INTEGER NOT NULL DEFAULT 0');
    // Preserve access for 0.2 rows only. New actors never inherit the shared player token.
    db.exec("UPDATE actors SET legacy_shared=1 WHERE owner_role='player' AND owner_member_id IS NULL");
  }
  const operationColumns = new Set(db.prepare('PRAGMA table_info(operations)').all().map(column => column.name));
  for (const [column, type] of [['actor_id', 'TEXT'], ['action_id', 'TEXT'], ['request_hash', 'TEXT'], ['principal_id', 'TEXT']]) if (!operationColumns.has(column)) db.exec(`ALTER TABLE operations ADD COLUMN ${column} ${type}`);
  db.prepare('INSERT OR IGNORE INTO campaign(id,context) VALUES(?,?)').run(campaignId, '{}');
  const modulesDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../modules');
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
    const module = JSON.parse(moduleRow.get(row.module_id, row.module_version).manifest);
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
  const visibleEvent = (event, auth) => {
    if (auth.role === 'gm') return true;
    if (event.visibility !== 'public') return false;
    if (event.actor_id) {
      const actor = actorRow.get(event.actor_id);
      if (!actor || !canReadActor(actor, auth)) return false;
    }
    return true;
  };
  const eventJson = (event, auth) => {
    const payload = JSON.parse(event.payload);
    // Action parameters are client supplied and may contain values copied from GM-only fields.
    if (auth.role === 'player') delete payload.parameters;
    return { cursor: event.cursor, id: event.id, actorId: event.actor_id, kind: event.kind, visibility: event.visibility, payload, createdAt: event.created_at };
  };
  const currentContext = () => {
    const stored = JSON.parse(db.prepare('SELECT context FROM campaign WHERE id=?').get(campaignId).context);
    const active = stored?.activeEncounter;
    const encounterId = encounterById.has(active) ? active
      : encounters.find(encounter => encounter.name === active)?.id || null;
    return { activeEncounter: encounterId };
  };
  const publicEncounters = () => encounters.map(({ id, name, summary }) => ({ id, name, summary }));
  const transaction = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const notify = () => {
    for (const client of clients) {
      const rows = db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(client.cursor);
      for (const row of rows) {
        client.cursor = Number(row.cursor);
        if (visibleEvent(row, client.auth)) client.res.write(`id: ${row.cursor}\nevent: update\ndata: ${JSON.stringify(eventJson(row, client.auth))}\n\n`);
      }
    }
  };
  const insertEvent = (event) => db.prepare('INSERT INTO events(id,operation_id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(
    event.id || randomUUID(), event.operationId || null, event.actorId || null, event.kind, event.visibility || 'public', JSON.stringify(event.payload), new Date().toISOString());
  const receiptJson = row => ({
    ...JSON.parse(row.response), operationId: row.operation_id, memberId: row.member_id, campaignId: row.campaign_id,
    requestHash: row.request_hash, status: row.status, proposalId: row.proposal_id,
    createdAt: row.created_at, updatedAt: row.updated_at
  });
  const validateOfflineCommand = (operation, auth, expectedPolicy = null) => {
    const actor = actorRow.get(operation.entityId);
    if (!actor || !canActOnActor(actor, auth)) return { status: 404, error: 'Actor not found', reasonCode: 'actor_unavailable' };
    const currentData = JSON.parse(actor.data);
    if (operation.moduleId !== actor.module_id || operation.moduleVersion !== actor.module_version || operation.schemaVersion !== currentData.schemaVersion) {
      return { status: 409, error: 'Module or schema version mismatch', reasonCode: 'module_schema_conflict', currentRevision: actor.revision };
    }
    if (operation.baseRevision !== actor.revision) return { status: 409, error: 'Revision conflict', reasonCode: 'revision_conflict', currentRevision: actor.revision };
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
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' }); return res.end(); }
    const auth = authFor(req);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (!auth) return json(res, 401, { error: 'Bearer token required' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const actors = db.prepare('SELECT * FROM actors ORDER BY id').all().filter(row => canReadActor(row, auth)).map(row => projectActor(row, auth));
        const modules = db.prepare('SELECT manifest FROM modules ORDER BY id,version').all().map(row => JSON.parse(row.manifest));
        const context = currentContext();
        const since = Math.max(0, Number(url.searchParams.get('since') || 0));
        const events = db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(since).filter(e => visibleEvent(e, auth)).map(event => eventJson(event, auth));
        return json(res, 200, { campaignId, role: auth.role, memberId: auth.memberId, revision: latest(), context, encounters: publicEncounters(), modules, actors, events });
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
        return json(res, 200, { proposals: rows.map(row => ({ id: row.id, operationId: row.operation_id, memberId: row.member_id, entityId: row.actor_id, actionId: row.action_id, requestHash: row.request_hash, status: row.status, createdAt: row.created_at, decidedAt: row.decided_at, decisionId: row.decision_id, decision: row.decision })) });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/proposals/')) {
        if (auth.role !== 'gm') return json(res, 403, { error: 'GM role required' });
        const proposalId = decodeURIComponent(url.pathname.slice('/api/proposals/'.length));
        const row = db.prepare('SELECT * FROM offline_proposals WHERE id=?').get(proposalId);
        if (!row) return json(res, 404, { error: 'Proposal not found' });
        return json(res, 200, { id: row.id, operationId: row.operation_id, memberId: row.member_id, entityId: row.actor_id, actionId: row.action_id, requestHash: row.request_hash, request: JSON.parse(row.request), status: row.status, createdAt: row.created_at, decidedAt: row.decided_at, decisionId: row.decision_id, decision: row.decision, decisionResponse: row.decision_response ? JSON.parse(row.decision_response) : null });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/offline/operations/')) {
        if (auth.memberId === null) return json(res, 403, { error: 'Enrolled member identity required' });
        const operationId = decodeURIComponent(url.pathname.slice('/api/offline/operations/'.length));
        const receipt = db.prepare('SELECT * FROM offline_receipts WHERE member_id=? AND operation_id=?').get(auth.memberId, operationId);
        if (!receipt) return json(res, 404, { error: 'Offline receipt not found' });
        return json(res, 200, receiptJson(receipt));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/encounters/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/encounters/'.length));
        const encounter = encounterById.get(id);
        if (!encounter) return json(res, 404, { error: 'Encounter not found' });
        return json(res, 200, { id: encounter.id, name: encounter.name, summary: encounter.summary });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/actors/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/actors/'.length));
        const actor = actorRow.get(id);
        if (!actor || !canReadActor(actor, auth)) return json(res, 404, { error: 'Actor not found' });
        return json(res, 200, projectActor(actor, auth));
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write('retry: 1500\n\n');
        const client = { res, auth, cursor: Math.max(0, Number(url.searchParams.get('since') || 0)) };
        clients.add(client);
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
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
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
          const result = { proposalId, operationId: proposal.operation_id, status: 'rejected', decisionId: body.decisionId };
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
        const validation = validateOfflineCommand(operation, { role: 'player', memberId: proposal.member_id, principalId: proposal.member_id }, 'gmReview');
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
        const result = { proposalId, operationId: proposal.operation_id, entityId: proposal.actor_id, status: 'applied', decisionId: body.decisionId, revision };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), revision, proposal.actor_id);
          db.prepare('UPDATE offline_proposals SET status=?,decided_at=?,decision_id=?,decision=?,decision_response=? WHERE id=? AND status=?')
            .run('accepted', now, body.decisionId, 'accept', JSON.stringify(result), proposalId, 'pending');
          db.prepare('UPDATE offline_receipts SET status=?,response=?,updated_at=? WHERE member_id=? AND operation_id=?')
            .run('applied', JSON.stringify(result), now, proposal.member_id, proposal.operation_id);
          db.prepare('INSERT INTO offline_decisions(decision_id,proposal_id,request_hash,response,created_at) VALUES(?,?,?,?,?)')
            .run(body.decisionId, proposalId, decisionHash, JSON.stringify(result), now);
          insertEvent({ actorId: proposal.actor_id, kind: 'action.applied', visibility: 'public', payload: { ...result, actionId: proposal.action_id, moduleId: validation.actor.module_id, moduleVersion: validation.actor.module_version, schemaVersion: operation.schemaVersion, ruleVersion: validation.manifest.rulesVersion, verified: true } });
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
            db.prepare('INSERT INTO offline_proposals(id,operation_id,member_id,actor_id,action_id,request_hash,request,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(proposalId, operation.operationId, auth.memberId, operation.entityId, operation.actionId, requestHash, canonicalJson(operation), 'pending', now);
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
        const receipt = { operationId: operation.operationId, entityId: operation.entityId, status: 'applied', revision };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), revision, operation.entityId);
          insertEvent({ actorId: operation.entityId, kind: 'action.applied', visibility: 'public', payload: { ...receipt, actionId: operation.actionId, moduleId: operation.moduleId, moduleVersion: operation.moduleVersion, schemaVersion: operation.schemaVersion, ruleVersion: validation.manifest.rulesVersion, verified: true } });
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
        if (!body.id || !moduleRow.get(body.moduleId, body.moduleVersion)) return json(res, 400, { error: 'Actor id and registered module version required' });
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
          || !(body.context.activeEncounter === null || typeof body.context.activeEncounter === 'string' && encounterById.has(body.context.activeEncounter))) {
          return json(res, 400, { error: 'context.activeEncounter must be a fixture encounter ID or null' });
        }
        const context = { activeEncounter: body.context.activeEncounter };
        transaction(() => {
          db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify(context), campaignId);
          insertEvent({ kind: 'context.changed', visibility: 'public', payload: context });
        });
        notify(); return json(res, 200, { context, revision: latest() });
      }
      if (url.pathname === '/api/actions') {
        const { operationId, entityId, baseRevision, actionId, parameters = {} } = body;
        if (!operationId || !entityId || !actionId || !Number.isInteger(baseRevision)) return json(res, 400, { error: 'operationId, entityId, integer baseRevision and actionId required' });
        if (auth.memberId !== null) {
          const required = ['campaignId', 'memberId', 'moduleId', 'moduleVersion', 'schemaVersion'];
          if (required.some(key => !Object.hasOwn(body, key)) || !Array.isArray(body.dependencies || [])) return json(res, 400, { error: 'Offline operation identity, version and dependencies fields required' });
          if (body.memberId !== auth.memberId) return json(res, 403, { error: 'Authenticated member does not match operation memberId' });
          if (body.campaignId !== campaignId) return json(res, 409, { error: 'Campaign mismatch' });
        }
        const actor = actorRow.get(entityId);
        if (!actor || !canActOnActor(actor, auth)) return json(res, 404, { error: 'Actor not found' });
        if (auth.memberId !== null && (body.moduleId !== actor.module_id || body.moduleVersion !== actor.module_version || body.schemaVersion !== JSON.parse(actor.data).schemaVersion)) return json(res, 409, { error: 'Module or schema version mismatch' });
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return json(res, 400, { error: 'parameters must be an object' });
        for (const dependency of body.dependencies || []) {
          if (!dependency || typeof dependency.entityId !== 'string' || !Number.isInteger(dependency.revision)) return json(res, 400, { error: 'Invalid operation dependency' });
          const dependentActor = actorRow.get(dependency.entityId);
          if (!dependentActor || !canReadActor(dependentActor, auth)) return json(res, 404, { error: 'Dependency not found' });
          if (dependentActor.revision !== dependency.revision) return json(res, 409, { error: 'Dependency revision conflict', entityId: dependency.entityId, currentRevision: dependentActor.revision });
        }
        const requestHash = createHash('sha256').update(JSON.stringify({ campaignId: body.campaignId || campaignId, memberId: auth.memberId, entityId, baseRevision, moduleId: body.moduleId || actor.module_id, moduleVersion: body.moduleVersion || actor.module_version, schemaVersion: body.schemaVersion || JSON.parse(actor.data).schemaVersion, actionId, parameters, dependencies: body.dependencies || [] })).digest('hex');
        const legacyRequestHash = createHash('sha256').update(JSON.stringify({ entityId, baseRevision, actionId, parameters })).digest('hex');
        const cached = db.prepare('SELECT response,actor_id,action_id,request_hash,principal_id FROM operations WHERE id=?').get(operationId);
        if (cached) {
          const oldFixtureRetry = auth.legacy && cached.principal_id === null && cached.request_hash === legacyRequestHash;
          if (cached.actor_id !== entityId || cached.action_id !== actionId || cached.request_hash !== requestHash && !oldFixtureRetry || cached.principal_id !== auth.principalId && !oldFixtureRetry) return json(res, 409, { error: 'Operation ID was already used for a different command' });
          return json(res, 200, JSON.parse(cached.response));
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
        const legacyResponse = { operationId, actorId: actor.id, revision: newRevision, actionId, rolls, resolution: executed.resolution };
        const result = auth.memberId !== null
          ? { operationId, entityId: actor.id, status: 'applied', revision: newRevision }
          : legacyResponse;
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), newRevision, actor.id);
          insertEvent({ operationId, actorId: actor.id, kind: 'action.applied', visibility: 'public', payload: { ...result, ruleVersion: manifest.rulesVersion, verified: true, parameters } });
          db.prepare('INSERT INTO operations(id,response,actor_id,action_id,request_hash,principal_id) VALUES(?,?,?,?,?,?)')
            .run(operationId, JSON.stringify(result), entityId, actionId, requestHash, auth.principalId);
        });
        notify(); return json(res, 200, result);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return json(res, 409, { error: 'Resource already exists' });
      return json(res, 400, { error: error.message || 'Request failed' });
    }
  });
  function notifyClient(client) {
    const rows = db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(client.cursor);
    for (const row of rows) {
      client.cursor = Number(row.cursor);
      if (visibleEvent(row, client.auth)) client.res.write(`id: ${row.cursor}\nevent: update\ndata: ${JSON.stringify(eventJson(row, client.auth))}\n\n`);
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
  const host = createHost({ databasePath: process.env.POTOMAC_DB || './data/potomac.sqlite', gmToken: process.env.POTOMAC_GM_TOKEN || 'local-gm', playerToken: process.env.POTOMAC_PLAYER_TOKEN || 'local-player' });
  const address = await host.listen(Number(process.env.PORT || 4177));
  console.log(`Potomac foundation host listening at http://${address.address}:${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => host.close());
}
