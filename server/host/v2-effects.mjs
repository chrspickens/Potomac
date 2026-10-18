import { createHash } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VISIBILITY = new Set(['public', 'gm', 'private']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const canonicalV2Json = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('invalid', 'non-finite JSON value'); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Map || value instanceof Set) fail('invalid', 'unsupported JSON value');
  if (Array.isArray(value)) return `[${value.map(item => canonicalV2Json(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => { if (['__proto__', 'prototype', 'constructor'].includes(key) || value[key] === undefined) fail('invalid', 'unsafe JSON object'); return `${JSON.stringify(key)}:${canonicalV2Json(value[key])}`; }).join(',')}}`;
};
export const hashV2Json = value => `sha256:${createHash('sha256').update(canonicalV2Json(value)).digest('hex')}`;
export const validateV2JsonSchema = (value, schema, path = '$') => {
  if (!schema || typeof schema !== 'object') fail('invalid', `${path} has no schema`);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'const']);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) fail('invalid', `${path} uses unsupported schema keyword ${key}`);
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.some(candidate => canonicalV2Json(candidate) === canonicalV2Json(value)))) fail('invalid', `${path} is not an allowed value`);
  if (schema.const !== undefined && canonicalV2Json(schema.const) !== canonicalV2Json(value)) fail('invalid', `${path} does not match its constant`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid', `${path} must be an object`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail('invalid', `${path}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) fail('invalid', `${path}.${key} is not allowed`);
    if (schema.properties === undefined || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) fail('invalid', `${path}.properties is required`);
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key)) validateV2JsonSchema(value[key], child, `${path}.${key}`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('invalid', `${path} must be an array`);
    if (schema.items === undefined) fail('invalid', `${path}.items is required`);
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) fail('invalid', `${path} has an invalid item count`);
    value.forEach((item, index) => validateV2JsonSchema(item, schema.items, `${path}[${index}]`)); return;
  }
  const valid = schema.type === 'string' ? typeof value === 'string' : schema.type === 'integer' ? Number.isInteger(value) : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : schema.type === 'boolean' ? typeof value === 'boolean' : schema.type === 'array' ? Array.isArray(value) : true;
  if (!valid) fail('invalid', `${path} has an invalid type`);
  if (schema.type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength)) fail('invalid', `${path} has an invalid string length`);
  if ((schema.type === 'integer' || schema.type === 'number') && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) fail('invalid', `${path} is out of range`);
};

export function validateV2SchemaDefinition(schema, path = '$schema', depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 32) fail('invalid', `${path} must be a bounded schema object`);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'const']);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) fail('invalid', `${path} uses unsupported schema keyword ${key}`);
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(schema.type)) fail('invalid', `${path}.type is unsupported`);
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) fail('invalid', `${path}.properties is required`);
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)))) fail('invalid', `${path}.required is invalid`);
    if (schema.required?.some(key => !Object.hasOwn(schema.properties, key))) fail('invalid', `${path}.required names an undeclared property`);
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') fail('invalid', `${path}.additionalProperties must be boolean`);
    for (const [key, child] of Object.entries(schema.properties)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid', `${path} has an unsafe property`);
      validateV2SchemaDefinition(child, `${path}.properties.${key}`, depth + 1);
    }
  }
  if (schema.type === 'array') {
    if (!schema.items) fail('invalid', `${path}.items is required`);
    validateV2SchemaDefinition(schema.items, `${path}.items`, depth + 1);
  }
  for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || schema[key] < 0)) fail('invalid', `${path}.${key} must be a non-negative integer`);
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems || schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength) fail('invalid', `${path} has inverted bounds`);
  for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined && !Number.isFinite(schema[key])) fail('invalid', `${path}.${key} must be finite`);
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) fail('invalid', `${path} has inverted numeric bounds`);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) fail('invalid', `${path}.enum must be a non-empty array`);
  if (schema.enum) for (const item of schema.enum) canonicalV2Json(item);
  if (schema.const !== undefined) canonicalV2Json(schema.const);
  return schema;
}

export const V2_EFFECT_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_effect_entities (
  campaign_id TEXT NOT NULL, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  revision INTEGER NOT NULL, visibility TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (campaign_id, entity_id)
);
CREATE TABLE IF NOT EXISTS v2_effect_receipts (
  operation_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, principal_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_effect_events (
  event_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL,
  visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);`;

export function createV2EffectKernel({ db, handlers, authenticate, authorize, validateLock, validateEntity = () => undefined, now = () => new Date().toISOString(), failureAt } = {}) {
  if (!db || !Array.isArray(handlers) || typeof authenticate !== 'function' || typeof authorize !== 'function' || typeof validateLock !== 'function') throw new Error('invalid_kernel_configuration');
  const handlerMap = new Map();
  for (const handler of handlers) {
    if (!handler || handlerMap.has(handler.id) || !ID.test(handler.id) || !DIGEST.test(handler.digest) || handler.atomic !== true || handler.conflict !== 'reject-overlap' || !VISIBILITY.has(handler.targetVisibility || 'public') || !VISIBILITY.has(handler.eventVisibility) || typeof handler.eventKind !== 'string' || typeof handler.apply !== 'function') throw new Error('invalid_handler');
    handlerMap.set(handler.id, handler);
  }
  db.exec(V2_EFFECT_SCHEMA);
  const readReceipt = operationId => db.prepare('SELECT response, payload_hash, campaign_id, principal_id FROM v2_effect_receipts WHERE operation_id=?').get(operationId);
  const publicEvents = (campaignId, operationId) => db.prepare("SELECT event_id AS eventId, operation_id AS operationId, effect_id AS effectId, entity_id AS entityId, kind, payload FROM v2_effect_events WHERE campaign_id=? AND operation_id=? AND visibility='public' ORDER BY event_id").all(campaignId, operationId).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  const apply = (proposal, inTransaction = false) => {
    if (!proposal || !ID.test(proposal.operationId) || !ID.test(proposal.campaignId) || !ID.test(proposal.principalId) || !ID.test(proposal.moduleId) || !Array.isArray(proposal.effects) || proposal.effects.length === 0) fail('invalid', 'malformed effect proposal');
    if (inTransaction && !db.isTransaction) fail('invalid', 'applyInTransaction requires an active host transaction');
    const payloadHash = hashV2Json(proposal);
    if (!authenticate(proposal.principalId, proposal)) fail('unauthorized', 'unauthenticated principal');
    validateLock(proposal.campaignId, proposal.lock, proposal.moduleId);
    const existing = readReceipt(proposal.operationId);
    if (existing) { if (existing.campaign_id !== proposal.campaignId || existing.principal_id !== proposal.principalId || existing.payload_hash !== payloadHash) fail('idempotency_conflict', 'operation ID is bound to a different campaign, principal or proposal'); return JSON.parse(existing.response); }
    const effectIds = new Set(); const targetIds = new Set(); const prepared = [];
    for (const effect of proposal.effects) {
      if (!effect || !ID.test(effect.effectId) || effectIds.has(effect.effectId) || !VISIBILITY.has(effect.visibility) || !effect.target || !ID.test(effect.target.entityId) || !Number.isInteger(effect.target.expectedRevision) || effect.target.expectedRevision < 0 || !VISIBILITY.has(effect.target.visibility) || effect.target.visibility !== effect.visibility) fail('invalid', 'invalid effect identity, target or visibility');
      effectIds.add(effect.effectId); if (targetIds.has(effect.target.entityId)) fail('conflict', 'overlapping effect targets are rejected'); targetIds.add(effect.target.entityId);
      const handler = handlerMap.get(effect.handler.id); if (!handler || handler.apiVersion !== effect.handler.apiVersion || handler.implementationVersion !== effect.handler.implementationVersion || handler.digest !== effect.handler.digest) fail('unsupported', 'handler is not in the trusted host registry');
      validateV2JsonSchema(effect.payload, handler.payloadSchema);
      prepared.push({ effect, handler });
    }
    prepared.sort((a, b) => a.effect.effectId.localeCompare(b.effect.effectId));
    if (!inTransaction) db.exec('BEGIN IMMEDIATE;');
    try {
      const events = []; const hidden = prepared.some(item => item.effect.visibility !== 'public');
      for (const { effect, handler } of prepared) {
        const entity = db.prepare('SELECT entity_type, revision, visibility, data FROM v2_effect_entities WHERE campaign_id=? AND entity_id=?').get(proposal.campaignId, effect.target.entityId);
        if (!entity || entity.entity_type !== handler.targetType || entity.revision !== effect.target.expectedRevision || (entity.visibility !== 'public' && effect.target.visibility === 'public')) fail('stale', 'target type, revision or visibility changed');
        const entitySnapshot = Object.freeze({ entityType: entity.entity_type, revision: entity.revision, visibility: entity.visibility, data: structuredClone(JSON.parse(entity.data)) });
        if (!authorize({ principalId: proposal.principalId, campaignId: proposal.campaignId, moduleId: proposal.moduleId, commandId: proposal.commandId, authorizedParticipants: proposal.authorizedParticipants, workflowEntityId: proposal.workflowEntityId, effect, handler, entity: entitySnapshot })) fail('unauthorized', 'unauthorized principal or target');
        const next = handler.apply({ entity: entitySnapshot, effect: structuredClone(effect) });
        if (!next || typeof next.data !== 'object' || !Number.isInteger(next.revision) || next.revision !== entity.revision + 1) fail('invalid', 'handler did not return the next entity revision');
        canonicalV2Json(next.data);
        validateEntity({ campaignId: proposal.campaignId, entityId: effect.target.entityId, entityType: entity.entity_type, data: next.data });
        const event = next.event; if (!event || event.kind !== handler.eventKind || event.visibility !== handler.eventVisibility || event.visibility !== effect.visibility) fail('invalid', 'handler event violates declared visibility or kind');
        validateV2JsonSchema(event.payload, handler.eventSchema);
        const updated = db.prepare('UPDATE v2_effect_entities SET revision=?, data=? WHERE campaign_id=? AND entity_id=? AND revision=?').run(next.revision, JSON.stringify(next.data), proposal.campaignId, effect.target.entityId, entity.revision);
        if (updated.changes !== 1) fail('conflict', 'unexpected target revision conflict');
        const eventId = `${proposal.operationId}:${effect.effectId}`;
        db.prepare('INSERT INTO v2_effect_events(event_id,operation_id,campaign_id,effect_id,entity_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(eventId, proposal.operationId, proposal.campaignId, effect.effectId, effect.target.entityId, event.kind, event.visibility, JSON.stringify(event.payload), now());
        events.push({ eventId, effectId: effect.effectId, entityId: effect.target.entityId, visibility: effect.visibility });
        if (failureAt === 'after-effect') fail('injected', 'failure after effect');
      }
      const receipt = { operationId: proposal.operationId, payloadHash, status: 'applied', eventIds: events.filter(event => event.visibility === 'public').map(event => event.eventId), hidden };
      db.prepare('INSERT INTO v2_effect_receipts(operation_id,campaign_id,principal_id,payload_hash,response,created_at) VALUES(?,?,?,?,?,?)').run(proposal.operationId, proposal.campaignId, proposal.principalId, payloadHash, JSON.stringify(receipt), now());
      if (failureAt === 'after-receipt') fail('injected', 'failure after receipt');
      if (!inTransaction) db.exec('COMMIT;'); return receipt;
    } catch (error) { if (!inTransaction) { try { db.exec('ROLLBACK;'); } catch {} } throw error; }
  };
  const applyInTransaction = proposal => apply(proposal, true);
  const applyStandalone = proposal => apply(proposal, false);
  return { apply: applyStandalone, applyInTransaction, readReceipt, publicEvents };
}
