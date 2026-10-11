import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS modules (id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, module_version TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT '{}', owner_role TEXT NOT NULL DEFAULT 'player');
CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation_id TEXT UNIQUE, actor_id TEXT, kind TEXT NOT NULL, visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, response TEXT NOT NULL, actor_id TEXT, action_id TEXT, request_hash TEXT);
CREATE TABLE IF NOT EXISTS campaign (id TEXT PRIMARY KEY, context TEXT NOT NULL DEFAULT '{}');
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

function pathValue(root, path) {
  return path.split('.').reduce((value, key) => value?.[key], root);
}

function evaluateExpression(expression, state, depth = 0, budget = { left: 256 }) {
  if (--budget.left < 0 || depth > 32) throw new Error('Rules execution budget exhausted');
  if (Object.hasOwn(expression, 'literal')) return expression.literal;
  if (expression.ref) {
    const value = pathValue(state, expression.ref);
    if (value === undefined || value === null || typeof value === 'object') throw new Error(`Unknown scalar field: ${expression.ref}`);
    return value;
  }
  const left = evaluateExpression(expression.left, state, depth + 1, budget);
  const right = evaluateExpression(expression.right, state, depth + 1, budget);
  switch (expression.op) {
    case 'add': case 'subtract': case 'multiply': case 'divide': {
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`${expression.op} expects numbers`);
      if (expression.op === 'divide' && right === 0) throw new Error('Division by zero');
      const result = expression.op === 'add' ? left + right : expression.op === 'subtract' ? left - right : expression.op === 'multiply' ? left * right : left / right;
      if (!Number.isFinite(result)) throw new Error('Invalid arithmetic result');
      return result;
    }
    case 'gt': case 'gte':
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`${expression.op} expects numbers`);
      return expression.op === 'gt' ? left > right : left >= right;
    case 'eq': return typeof left === typeof right && left === right;
    case 'and': case 'or':
      if (typeof left !== 'boolean' || typeof right !== 'boolean') throw new Error(`${expression.op} expects booleans`);
      return expression.op === 'and' ? left && right : left || right;
    default: throw new Error(`Unsupported rules operator: ${expression.op}`);
  }
}

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
  if (action.requires && evaluateExpression(action.requires, state) !== true) throw new Error('Action precondition failed');
  const next = structuredClone(state);
  for (const effect of action.effects || []) {
    if (effect.op !== 'changeResource' || effect.target !== 'self') throw new Error('Unsupported action effect');
    const amount = evaluateExpression(effect.amount, state);
    if (typeof amount !== 'number') throw new Error('Resource change must be numeric');
    const parts = (effect.resource.startsWith('resources.') ? effect.resource : `resources.${effect.resource}`).split('.');
    const parent = parts.slice(0, -1).reduce((value, key) => value?.[key], next);
    const key = parts.at(-1);
    const current = parent?.[key];
    if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error(`Unknown numeric resource ${effect.resource}`);
    const value = current + amount;
    const maximum = typeof parent.maximum === 'number' ? parent.maximum : Infinity;
    if (value < 0 || value > maximum) throw new Error(`Resource ${effect.resource} is out of bounds`);
    parent[key] = value;
  }
  let resolution;
  if (action.resolution) {
    const groups = action.resolution.dice.map(group => {
      const dice = Array.from({ length: group.count }, () => randomInt(1, group.sides + 1));
      return { role: group.role || 'dice', dice, total: dice.reduce((sum, die) => sum + die, 0) };
    });
    const modifier = action.resolution.modifier ? evaluateExpression(action.resolution.modifier, state) : 0;
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

export function createHost({ databasePath = './data/potomac.sqlite', gmToken = 'local-gm', playerToken = 'local-player', campaignId = 'foundation-demo' } = {}) {
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(schema);
  const operationColumns = new Set(db.prepare('PRAGMA table_info(operations)').all().map(column => column.name));
  for (const [column, type] of [['actor_id', 'TEXT'], ['action_id', 'TEXT'], ['request_hash', 'TEXT']]) if (!operationColumns.has(column)) db.exec(`ALTER TABLE operations ADD COLUMN ${column} ${type}`);
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
  const roleFor = req => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (same(token, gmToken)) return 'gm';
    if (same(token, playerToken)) return 'player';
    return null;
  };
  const projectActor = (row, role) => {
    const actor = { id: row.id, moduleId: row.module_id, moduleVersion: row.module_version, revision: row.revision, data: JSON.parse(row.data) };
    const module = JSON.parse(moduleRow.get(row.module_id, row.module_version).manifest);
    actor.data.derived ||= {};
    for (const item of module.derivedValues || []) actor.data.derived[item.id] = evaluateExpression(item.value, actor.data);
    const visibility = JSON.parse(row.visibility);
    if (role === 'player' && visibility.gmOnly) {
      for (const path of visibility.gmOnly) {
        const parts = path.split('.'); let parent = actor.data;
        for (const p of parts.slice(0, -1)) parent = parent?.[p];
        if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
      }
    }
    return actor;
  };
  const visibleEvent = (event, role) => role === 'gm' || event.visibility === 'public';
  const eventJson = (event) => ({ cursor: event.cursor, id: event.id, actorId: event.actor_id, kind: event.kind, visibility: event.visibility, payload: JSON.parse(event.payload), createdAt: event.created_at });
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
        if (visibleEvent(row, client.role)) client.res.write(`id: ${row.cursor}\nevent: update\ndata: ${JSON.stringify(eventJson(row))}\n\n`);
      }
    }
  };
  const insertEvent = (event) => db.prepare('INSERT INTO events(id,operation_id,actor_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(
    event.id || randomUUID(), event.operationId || null, event.actorId || null, event.kind, event.visibility || 'public', JSON.stringify(event.payload), new Date().toISOString());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }
    const role = roleFor(req);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (!role) return json(res, 401, { error: 'Bearer token required' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const actors = db.prepare('SELECT * FROM actors ORDER BY id').all().map(row => projectActor(row, role));
        const modules = db.prepare('SELECT manifest FROM modules ORDER BY id,version').all().map(row => JSON.parse(row.manifest));
        const context = JSON.parse(db.prepare('SELECT context FROM campaign WHERE id=?').get(campaignId).context);
        const since = Math.max(0, Number(url.searchParams.get('since') || 0));
        const events = db.prepare('SELECT * FROM events WHERE cursor>? ORDER BY cursor').all(since).filter(e => visibleEvent(e, role)).map(eventJson);
        return json(res, 200, { campaignId, role, revision: latest(), context, modules, actors, events });
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write('retry: 1500\n\n');
        const client = { res, role, cursor: Math.max(0, Number(url.searchParams.get('since') || 0)) };
        clients.add(client);
        // Replaying from a cursor closes the notification gap between snapshot and subscription.
        notifyClient(client);
        req.on('close', () => clients.delete(client));
        return;
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      if (url.pathname === '/api/modules') {
        if (role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body.id || !body.version || !body.manifest || body.manifest.id !== body.id || body.manifest.version !== body.version) return json(res, 400, { error: 'Module id, version and matching manifest required' });
        db.prepare('INSERT OR REPLACE INTO modules(id,version,manifest) VALUES(?,?,?)').run(body.id, body.version, JSON.stringify(body.manifest));
        return json(res, 201, { id: body.id, version: body.version });
      }
      if (url.pathname === '/api/actors') {
        if (role !== 'gm') return json(res, 403, { error: 'GM role required' });
        if (!body.id || !moduleRow.get(body.moduleId, body.moduleVersion)) return json(res, 400, { error: 'Actor id and registered module version required' });
        const ownerRole = body.ownerRole || 'player';
        if (!['gm', 'player'].includes(ownerRole)) return json(res, 400, { error: 'ownerRole must be gm or player' });
        const manifest = JSON.parse(moduleRow.get(body.moduleId, body.moduleVersion).manifest);
        const data = { ...(body.data || {}), moduleId: body.moduleId, moduleVersion: body.moduleVersion, schemaVersion: 1, entityId: body.id, revision: 1 };
        validateSchema(data, manifest.schema);
        transaction(() => {
          db.prepare('INSERT INTO actors(id,module_id,module_version,revision,data,visibility,owner_role) VALUES(?,?,?,?,?,?,?)').run(body.id, body.moduleId, body.moduleVersion, 1, JSON.stringify(data), JSON.stringify(body.visibility || {}), ownerRole);
          insertEvent({ actorId: body.id, kind: 'actor.created', visibility: 'public', payload: { moduleId: body.moduleId, moduleVersion: body.moduleVersion } });
        });
        notify();
        return json(res, 201, projectActor(actorRow.get(body.id), role));
      }
      if (url.pathname === '/api/context') {
        if (role !== 'gm') return json(res, 403, { error: 'GM role required' });
        transaction(() => {
          db.prepare('UPDATE campaign SET context=? WHERE id=?').run(JSON.stringify(body.context || {}), campaignId);
          insertEvent({ kind: 'context.changed', visibility: 'public', actorId: body.actorId || null, payload: body.context || {} });
        });
        notify(); return json(res, 200, { context: body.context || {}, revision: latest() });
      }
      if (url.pathname === '/api/actions') {
        const { operationId, entityId, baseRevision, actionId, parameters = {} } = body;
        if (!operationId || !entityId || !actionId || !Number.isInteger(baseRevision)) return json(res, 400, { error: 'operationId, entityId, integer baseRevision and actionId required' });
        const actor = actorRow.get(entityId);
        if (!actor) return json(res, 404, { error: 'Actor not found' });
        if (role === 'player' && actor.owner_role !== 'player') return json(res, 403, { error: 'Players may only act on player-owned actors' });
        const requestHash = createHash('sha256').update(JSON.stringify({ entityId, baseRevision, actionId, parameters })).digest('hex');
        const cached = db.prepare('SELECT response,actor_id,action_id,request_hash FROM operations WHERE id=?').get(operationId);
        if (cached) {
          if (cached.actor_id !== entityId || cached.action_id !== actionId || cached.request_hash !== requestHash) return json(res, 409, { error: 'Operation ID was already used for a different command' });
          return json(res, 200, JSON.parse(cached.response));
        }
        if (baseRevision !== actor.revision) return json(res, 409, { error: 'Revision conflict', currentRevision: actor.revision });
        const manifestRow = moduleRow.get(actor.module_id, actor.module_version);
        const manifest = JSON.parse(manifestRow.manifest);
        const action = (manifest.actions || []).find(a => a.id === actionId);
        if (!action) return json(res, 400, { error: 'Action is not declared by the actor module' });
        const data = JSON.parse(actor.data);
        const executed = applyRuleAction(action, data, parameters);
        const newRevision = actor.revision + 1;
        executed.state.revision = newRevision;
        const rolls = executed.resolution?.groups.flatMap(group => group.dice) || [];
        const result = { operationId, actorId: actor.id, revision: newRevision, actionId, rolls, resolution: executed.resolution };
        transaction(() => {
          db.prepare('UPDATE actors SET data=?,revision=? WHERE id=?').run(JSON.stringify(executed.state), newRevision, actor.id);
          insertEvent({ operationId, actorId: actor.id, kind: 'action.applied', visibility: 'public', payload: { ...result, ruleVersion: manifest.rulesVersion, verified: true, parameters } });
          db.prepare('INSERT INTO operations(id,response,actor_id,action_id,request_hash) VALUES(?,?,?,?,?)').run(operationId, JSON.stringify(result), entityId, actionId, requestHash);
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
      if (visibleEvent(row, client.role)) client.res.write(`id: ${row.cursor}\nevent: update\ndata: ${JSON.stringify(eventJson(row))}\n\n`);
    }
  }
  return { server, db, listen(port = 4177, host = '127.0.0.1') { return new Promise(resolveListen => server.listen(port, host, () => resolveListen(server.address()))); }, close() { for (const c of clients) c.res.end(); server.close(); db.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = createHost({ databasePath: process.env.POTOMAC_DB || './data/potomac.sqlite', gmToken: process.env.POTOMAC_GM_TOKEN || 'local-gm', playerToken: process.env.POTOMAC_PLAYER_TOKEN || 'local-player' });
  const address = await host.listen(Number(process.env.PORT || 4177));
  console.log(`Potomac foundation host listening at http://${address.address}:${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => host.close());
}
