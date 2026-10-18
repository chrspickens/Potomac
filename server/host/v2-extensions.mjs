import { randomUUID } from 'node:crypto';
import { executeResolver } from '../../packages/rules-engine/src/resolver.ts';
import { createV2EffectKernel, canonicalV2Json, hashV2Json, validateV2JsonSchema, validateV2SchemaDefinition } from './v2-effects.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NAMESPACED = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_EXTENSION_JSON_BYTES = 128 * 1024;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const refKey = ref => `${ref.id}@${ref.apiVersion}/${ref.implementationVersion}/${ref.digest}`;
const json = value => JSON.stringify(value);
const clone = value => structuredClone(value);
const freezeJson = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
};

export const V2_EXTENSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_extension_entities (
  campaign_id TEXT NOT NULL, entity_id TEXT NOT NULL, descriptor_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL, migration_id TEXT NOT NULL, capability TEXT NOT NULL,
  owner_principal_id TEXT, PRIMARY KEY (campaign_id, entity_id),
  FOREIGN KEY (campaign_id, entity_id) REFERENCES v2_effect_entities(campaign_id, entity_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS v2_extension_workflows (
  workflow_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, entity_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL, capability TEXT NOT NULL, revision INTEGER NOT NULL,
  state TEXT NOT NULL, state_data TEXT NOT NULL, continuation_id TEXT NOT NULL,
  participants TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL,
  created_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_extension_receipts (
  operation_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, principal_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_extension_events (
  event_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  entity_id TEXT NOT NULL, kind TEXT NOT NULL, visibility TEXT NOT NULL,
  payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_extension_continuation_identity ON v2_extension_workflows(continuation_id);`;

const storedVisibility = visibility => visibility === 'owner' ? 'private' : visibility;

function exactLockRef(lock, ref, campaignId) {
  if (!lock || lock.campaignId !== campaignId || !Array.isArray(lock.entries)) fail('unsupported', 'campaign capability lock is unavailable');
  if (!ref) fail('unsupported', 'required capability identity is unavailable');
  const entry = lock.entries.find(item => item?.id === ref.id && item.apiVersion === ref.apiVersion && item.implementationVersion === ref.implementationVersion && item.digest === ref.digest);
  if (!entry) fail('unsupported', `required capability ${ref.id} is not exactly pinned`);
}

function validateCapabilityRef(ref) {
  if (!ref || !NAMESPACED.test(ref.id) || !/^\d+\.\d+\.\d+$/.test(ref.apiVersion) || !/^\d+\.\d+\.\d+$/.test(ref.implementationVersion) || !DIGEST.test(ref.digest)) fail('invalid', 'invalid capability identity');
}

function validateBoundedJson(value, schema) {
  if (canonicalV2Json(value).length > MAX_EXTENSION_JSON_BYTES) fail('invalid', 'extension JSON exceeds the supported size bound');
  validateV2JsonSchema(value, schema);
}

function validateEntityDescriptor(descriptor) {
  if (!descriptor || descriptor.descriptorVersion !== 1 || !NAMESPACED.test(descriptor.typeId) || !Number.isInteger(descriptor.schemaVersion) || descriptor.schemaVersion < 1 || !NAMESPACED.test(descriptor.migration?.migrationId) || descriptor.migration.toSchemaVersion !== descriptor.schemaVersion || descriptor.migration.fromSchemaVersion !== descriptor.schemaVersion - 1 || !['campaign', 'principal'].includes(descriptor.ownership?.kind) || !Array.isArray(descriptor.visibility) || descriptor.visibility.length === 0 || descriptor.visibility.some(value => !['public', 'gm', 'owner'].includes(value)) || !Array.isArray(descriptor.creationRoles) || descriptor.creationRoles.some(role => !['gm', 'player'].includes(role))) fail('invalid', 'invalid entity descriptor');
  validateCapabilityRef(descriptor.capability); validateV2SchemaDefinition(descriptor.schema);
}

function validateCommandDescriptor(command) {
  if (!command || command.descriptorVersion !== 1 || !NAMESPACED.test(command.commandId) || !NAMESPACED.test(command.entityTypeId) || !Array.isArray(command.permission?.roles) || command.permission.roles.length === 0 || command.permission.roles.some(role => !['gm', 'player'].includes(role)) || !['any', 'owner', 'gm', 'owner-or-participant'].includes(command.permission.ownership) || command.permission.effectTargetPolicy !== undefined && !['source-entity', 'campaign-visible'].includes(command.permission.effectTargetPolicy) || command.workflowOnly !== undefined && typeof command.workflowOnly !== 'boolean' || !Array.isArray(command.effects)) fail('invalid', 'invalid command descriptor');
  validateCapabilityRef(command.capability); validateCapabilityRef(command.resolver); validateV2SchemaDefinition(command.inputSchema); validateV2SchemaDefinition(command.resultSchema);
  for (const ref of command.effects) validateCapabilityRef(ref);
}

function validateWorkflowDescriptor(workflow) {
  if (!workflow || workflow.descriptorVersion !== 1 || !NAMESPACED.test(workflow.workflowType) || !NAMESPACED.test(workflow.entityTypeId) || !Array.isArray(workflow.states) || workflow.states.length === 0 || !workflow.states.some(state => state.stateId === workflow.initialState) || !Array.isArray(workflow.terminalStates) || !Array.isArray(workflow.transitions) || !Array.isArray(workflow.expirationRoles) || workflow.expirationRoles.some(role => !['gm', 'player'].includes(role))) fail('invalid', 'invalid workflow descriptor');
  validateCapabilityRef(workflow.capability);
  const states = new Set(); for (const state of workflow.states) { if (!NAMESPACED.test(state.stateId) || states.has(state.stateId)) fail('invalid', 'invalid or duplicate workflow state'); states.add(state.stateId); validateV2SchemaDefinition(state.schema); }
  if (workflow.terminalStates.some(state => !states.has(state))) fail('invalid', 'unknown terminal workflow state');
  if (workflow.terminalStates.includes(workflow.initialState)) fail('invalid', 'initial workflow state cannot be terminal');
  const transitions = new Set(); for (const transition of workflow.transitions) {
    if (!NAMESPACED.test(transition.transitionId) || transitions.has(transition.transitionId) || !NAMESPACED.test(transition.commandId) || !['transition', 'cancel'].includes(transition.kind) || !['command', 'owner-or-participant', 'gm'].includes(transition.participantPolicy) || !Array.isArray(transition.from) || transition.from.length === 0 || transition.from.some(state => !states.has(state)) || !states.has(transition.to)) fail('invalid', 'invalid workflow transition');
    if (transition.from.some(state => workflow.terminalStates.includes(state)) || transition.kind === 'cancel' && !workflow.terminalStates.includes(transition.to)) fail('invalid', 'terminal workflow states cannot transition and cancellation must be terminal');
    transitions.add(transition.transitionId);
  }
}

export function createV2ExtensionKernel({ db, entities, commands, workflows = [], effectHandlers, resolvers, authenticate, getCampaignLock, validateLock, authorizeEffect = () => true, now = () => new Date().toISOString(), createId = randomUUID, failureAt } = {}) {
  if (!db || !Array.isArray(entities) || !Array.isArray(commands) || !Array.isArray(workflows) || !Array.isArray(effectHandlers) || !Array.isArray(resolvers) || typeof authenticate !== 'function' || typeof getCampaignLock !== 'function' || typeof validateLock !== 'function') fail('invalid', 'invalid extension kernel configuration');
  const entityTypes = new Map(); const commandTypes = new Map(); const workflowTypes = new Map(); const resolverMap = new Map(); const effectMap = new Map();
  for (const descriptor of entities) { validateEntityDescriptor(descriptor); if (entityTypes.has(descriptor.typeId)) fail('invalid', 'duplicate entity descriptor'); entityTypes.set(descriptor.typeId, clone(descriptor)); }
  for (const command of commands) { validateCommandDescriptor(command); if (commandTypes.has(command.commandId) || !entityTypes.has(command.entityTypeId)) fail('invalid', 'duplicate command or missing entity type'); commandTypes.set(command.commandId, clone(command)); }
  for (const workflow of workflows) {
    validateWorkflowDescriptor(workflow);
    if (workflowTypes.has(workflow.workflowType) || !entityTypes.has(workflow.entityTypeId)) fail('invalid', 'duplicate workflow or missing entity type');
    for (const transition of workflow.transitions) {
      const command = commandTypes.get(transition.commandId);
      if (!command || command.entityTypeId !== workflow.entityTypeId || !command.workflowOnly) fail('invalid', 'workflow transition references an incompatible command');
    }
    workflowTypes.set(workflow.workflowType, clone(workflow));
  }
  for (const resolver of resolvers) { if (!resolver?.ref || typeof resolver.resolve !== 'function' || resolverMap.has(refKey(resolver.ref))) fail('invalid', 'invalid or duplicate resolver'); resolverMap.set(refKey(resolver.ref), resolver); }
  for (const handler of effectHandlers) { if (!handler?.id || effectMap.has(refKey(handler))) fail('invalid', 'invalid or duplicate effect handler'); effectMap.set(refKey(handler), handler); }
  for (const command of commandTypes.values()) for (const ref of command.effects) if (!effectMap.has(refKey(ref))) fail('invalid', `command ${command.commandId} declares an unavailable effect handler`);

  db.exec(V2_EXTENSION_SCHEMA);
  const principal = (principalId, campaignId) => {
    const result = authenticate(principalId, { campaignId });
    if (!result || result.principalId !== principalId || !['gm', 'player'].includes(result.role)) fail('unauthorized', 'authenticated campaign member required');
    return result;
  };
  const lockFor = campaignId => {
    const lock = getCampaignLock(campaignId);
    if (!lock) fail('unsupported', 'campaign capability lock is unavailable');
    validateLock(campaignId, lock);
    return lock;
  };
  const assertCurrentLock = (campaignId, expectedLock) => {
    const latestLock = lockFor(campaignId);
    if (hashV2Json(latestLock) !== hashV2Json(expectedLock)) fail('unsupported', 'campaign capability lock changed during extension operation');
  };
  const requireCapability = (lock, capability, campaignId) => { exactLockRef(lock, capability, campaignId); };
  const decodeEntity = (campaignId, row, metadata) => ({ campaignId, entityId: row.entity_id, typeId: row.entity_type, capability: JSON.parse(metadata.capability), schemaVersion: metadata.schema_version, migrationId: metadata.migration_id, revision: row.revision, visibility: metadata.owner_principal_id ? 'owner' : row.visibility, ownerPrincipalId: metadata.owner_principal_id, data: JSON.parse(row.data) });
  const entityRows = (campaignId, entityId) => {
    const row = db.prepare('SELECT campaign_id, entity_id, entity_type, revision, visibility, data FROM v2_effect_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, entityId);
    const metadata = db.prepare('SELECT descriptor_id, schema_version, migration_id, capability, owner_principal_id FROM v2_extension_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, entityId);
    return row && metadata ? { row, metadata } : undefined;
  };
  const canRead = (member, entity, participants = []) => entity.visibility === 'public' || member.role === 'gm' || (entity.visibility === 'owner' && (entity.ownerPrincipalId === member.principalId || participants.includes(member.principalId)));
  const canCommand = (member, entity, permission, participants = []) => permission.roles.includes(member.role) && (permission.ownership === 'any' || (permission.ownership === 'gm' && member.role === 'gm') || (permission.ownership === 'owner' && entity.ownerPrincipalId === member.principalId) || (permission.ownership === 'owner-or-participant' && (entity.ownerPrincipalId === member.principalId || participants.includes(member.principalId) || member.role === 'gm')));
  const currentDescriptor = (record, lock) => {
    const descriptor = entityTypes.get(record.typeId);
    if (!descriptor || descriptor.typeId !== record.typeId || descriptor.schemaVersion !== record.schemaVersion || descriptor.migration.migrationId !== record.migrationId || refKey(descriptor.capability) !== refKey(record.capability)) fail('unsupported', 'entity capability or schema is unavailable');
    requireCapability(lock, descriptor.capability, record.campaignId);
    return descriptor;
  };
  const validateStoredEntity = ({ campaignId, entityId, entityType, data }) => {
    const found = entityRows(campaignId, entityId); if (!found) return;
    if (entityType !== found.row.entity_type) fail('unsupported', 'entity type changed');
    const lock = lockFor(campaignId); const record = decodeEntity(campaignId, found.row, found.metadata); const descriptor = currentDescriptor(record, lock);
    validateBoundedJson(data, descriptor.schema);
  };
  const effects = createV2EffectKernel({
    db, handlers: effectHandlers, authenticate: (principalId, proposal) => Boolean(principal(principalId, proposal.campaignId)),
    validateLock: (campaignId, lock, moduleId) => {
      const currentLock = lockFor(campaignId);
      if (hashV2Json(currentLock) !== hashV2Json(lock)) fail('unsupported', 'campaign capability lock changed during command execution');
      if (lock.rootModule.id !== moduleId) fail('unsupported', 'effect proposal module does not match campaign lock');
    },
    authorize: context => {
      const found = entityRows(context.campaignId, context.effect.target.entityId); if (!found) return false;
      const record = decodeEntity(context.campaignId, found.row, found.metadata); const lock = lockFor(context.campaignId);
      try { currentDescriptor(record, lock); } catch { return false; }
      const member = principal(context.principalId, context.campaignId); const command = commandTypes.get(context.commandId);
      const targetParticipants = context.effect.target.entityId === context.workflowEntityId ? context.authorizedParticipants || [] : [];
      if (!command || !canRead(member, record, targetParticipants)) return false;
      let sourceRecord = record;
      if (command.permission.effectTargetPolicy === 'campaign-visible') {
        const source = entityRows(context.campaignId, context.commandEntityId);
        if (!source) return false;
        sourceRecord = decodeEntity(context.campaignId, source.row, source.metadata);
        try { currentDescriptor(sourceRecord, lock); } catch { return false; }
        if (sourceRecord.typeId !== command.entityTypeId || !canRead(member, sourceRecord, context.authorizedParticipants || []) || !canCommand(member, sourceRecord, command.permission, context.authorizedParticipants || [])) return false;
      } else if (!canCommand(member, record, command.permission, targetParticipants)) return false;
      return Boolean(authorizeEffect({ ...context, principal: member, command: clone(command), entity: clone(record), sourceEntity: clone(sourceRecord) }));
    },
    validateEntity: validateStoredEntity, now, failureAt
  });

  const assertTypePinned = (campaignId, lock, descriptor) => requireCapability(lock, descriptor.capability, campaignId);
  const readRecord = (campaignId, entityId, member, lock, participants = []) => {
    const found = entityRows(campaignId, entityId); if (!found) fail('unavailable', 'entity is unavailable');
    const record = decodeEntity(campaignId, found.row, found.metadata); const descriptor = currentDescriptor(record, lock);
    validateBoundedJson(record.data, descriptor.schema);
    if (!canRead(member, record, participants)) fail('unavailable', 'entity is unavailable');
    return { record, descriptor };
  };
  const readWorkflowRow = workflowId => db.prepare('SELECT * FROM v2_extension_workflows WHERE workflow_id=?').get(workflowId);
  const decodeWorkflow = row => ({ workflowId: row.workflow_id, campaignId: row.campaign_id, entityId: row.entity_id, workflowType: row.workflow_type, capability: JSON.parse(row.capability), revision: row.revision, state: row.state, stateData: JSON.parse(row.state_data), continuationId: row.continuation_id, participants: JSON.parse(row.participants), expiresAt: row.expires_at, status: row.status });
  const validateStoredWorkflow = (workflow, descriptor) => {
    if (!descriptor || refKey(descriptor.capability) !== refKey(workflow.capability) || !ID.test(workflow.workflowId) || !ID.test(workflow.campaignId) || !ID.test(workflow.entityId) || !Number.isInteger(workflow.revision) || workflow.revision < 1 || !ID.test(workflow.continuationId) || !Number.isFinite(Date.parse(workflow.expiresAt)) || !['active', 'completed', 'cancelled', 'expired'].includes(workflow.status)) fail('unsupported', 'workflow capability or state is unavailable');
    if (!Array.isArray(workflow.participants) || workflow.participants.length > 100 || new Set(workflow.participants).size !== workflow.participants.length || workflow.participants.some(id => !ID.test(id))) fail('unsupported', 'workflow participant state is invalid');
    const state = descriptor.states.find(item => item.stateId === workflow.state);
    if (!state || (workflow.status === 'active' && descriptor.terminalStates.includes(workflow.state)) || (['completed', 'cancelled'].includes(workflow.status) && !descriptor.terminalStates.includes(workflow.state))) fail('unsupported', 'workflow state is unavailable');
    validateBoundedJson(workflow.stateData, state.schema);
    return state;
  };
  const visibleOutcomes = (outcomes, member, entity) => outcomes.filter(item => item.visibility === 'public' || (item.visibility === 'gm' && member.role === 'gm') || (item.visibility === 'private' && (member.role === 'gm' || entity.ownerPrincipalId === member.principalId))).map(clone);
  const receipt = (request, payloadHash) => {
    const found = db.prepare('SELECT payload_hash, campaign_id, principal_id, response FROM v2_extension_receipts WHERE operation_id=?').get(request.operationId);
    if (!found) return undefined;
    if (found.payload_hash !== payloadHash || found.campaign_id !== request.campaignId || found.principal_id !== request.principalId) fail('idempotency_conflict', 'operation ID is bound to another command payload');
    return JSON.parse(found.response);
  };
  const projectCommandReceipt = (request, payloadHash, member, entity) => {
    const stored = receipt(request, payloadHash); if (!stored) return undefined;
    if (!Array.isArray(stored.allOutcomes)) return stored;
    const { allOutcomes, ...base } = stored;
    return { ...base, outcomes: visibleOutcomes(allOutcomes, member, entity) };
  };
  const writeEvent = (request, entityId, kind, visibility, payload) => db.prepare('INSERT INTO v2_extension_events(event_id,operation_id,campaign_id,entity_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`${request.operationId}:${kind}`, request.operationId, request.campaignId, entityId, kind, visibility, json(payload), now());
  const read = (campaignId, entityId, principalId) => {
    const member = principal(principalId, campaignId); const lock = lockFor(campaignId); return clone(readRecord(campaignId, entityId, member, lock).record);
  };
  const events = (campaignId, principalId) => {
    const member = principal(principalId, campaignId); const lock = lockFor(campaignId);
    return db.prepare('SELECT * FROM v2_extension_events WHERE campaign_id=? ORDER BY rowid').all(campaignId).flatMap(row => {
      if (row.visibility !== 'public' && member.role !== 'gm') {
        const found = entityRows(campaignId, row.entity_id); if (!found) return [];
        try { const entity = decodeEntity(campaignId, found.row, found.metadata); currentDescriptor(entity, lock); if (!canRead(member, entity)) return []; } catch { return []; }
      }
      if (row.visibility === 'gm' && member.role !== 'gm') return [];
      return [{ eventId: row.event_id, operationId: row.operation_id, entityId: row.entity_id, kind: row.kind, visibility: row.visibility, payload: JSON.parse(row.payload) }];
    });
  };
  const list = (campaignId, typeId, principalId) => {
    const member = principal(principalId, campaignId); const lock = lockFor(campaignId); const descriptor = entityTypes.get(typeId);
    if (!descriptor) fail('unsupported', 'entity capability is unavailable'); assertTypePinned(campaignId, lock, descriptor);
    return db.prepare('SELECT e.*, x.descriptor_id, x.schema_version, x.migration_id, x.capability, x.owner_principal_id FROM v2_effect_entities e JOIN v2_extension_entities x USING(campaign_id,entity_id) WHERE e.campaign_id=? AND e.entity_type=? ORDER BY e.entity_id').all(campaignId, typeId).flatMap(row => {
      const metadata = { descriptor_id: row.descriptor_id, schema_version: row.schema_version, migration_id: row.migration_id, capability: row.capability, owner_principal_id: row.owner_principal_id };
      const record = decodeEntity(campaignId, row, metadata);
      try { currentDescriptor(record, lock); validateBoundedJson(record.data, descriptor.schema); } catch { return []; }
      return canRead(member, record) ? [clone(record)] : [];
    });
  };
  const createEntity = request => {
    if (!request || !ID.test(request.operationId) || !ID.test(request.campaignId) || !ID.test(request.principalId) || !ID.test(request.entityId) || !['public', 'gm', 'owner'].includes(request.visibility)) fail('invalid', 'malformed entity creation');
    const descriptor = entityTypes.get(request.typeId); if (!descriptor) fail('unsupported', 'entity capability is unavailable');
    validateBoundedJson(request.data, descriptor.schema);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const currentMember = principal(request.principalId, request.campaignId); const currentLock = lockFor(request.campaignId); assertTypePinned(request.campaignId, currentLock, descriptor);
      if (!descriptor.creationRoles.includes(currentMember.role)) fail('unauthorized', 'entity creation is not permitted');
      const owner = descriptor.ownership.kind === 'principal' ? (currentMember.role === 'gm' ? request.ownerPrincipalId ?? request.principalId : request.principalId) : null;
      if (descriptor.ownership.kind === 'principal' && (!ID.test(owner ?? '') || request.visibility !== 'owner')) fail('invalid', 'principal-owned entities require an owner and owner visibility');
      if (descriptor.ownership.kind === 'campaign' && (owner || request.visibility === 'owner')) fail('invalid', 'campaign-owned entities cannot have an owner visibility');
      if (!descriptor.visibility.includes(request.visibility)) fail('invalid', 'entity visibility is not declared by its descriptor');
      if (currentMember.role !== 'gm' && owner !== currentMember.principalId) fail('unauthorized', 'member cannot assign another entity owner');
      const payload = { ...request, ownerPrincipalId: owner, capability: descriptor.capability, schemaVersion: descriptor.schemaVersion, migrationId: descriptor.migration.migrationId };
      const payloadHash = hashV2Json(payload); const retry = receipt(request, payloadHash);
      if (retry) { assertCurrentLock(request.campaignId, currentLock); db.exec('COMMIT;'); return retry; }
      db.prepare('INSERT INTO v2_effect_entities(campaign_id,entity_id,entity_type,revision,visibility,data) VALUES(?,?,?,?,?,?)').run(request.campaignId, request.entityId, descriptor.typeId, 1, storedVisibility(request.visibility), json(request.data));
      db.prepare('INSERT INTO v2_extension_entities(campaign_id,entity_id,descriptor_id,schema_version,migration_id,capability,owner_principal_id) VALUES(?,?,?,?,?,?,?)').run(request.campaignId, request.entityId, descriptor.typeId, descriptor.schemaVersion, descriptor.migration.migrationId, json(descriptor.capability), owner);
      const result = { operationId: request.operationId, status: 'applied', entityId: request.entityId, revision: 1 };
      writeEvent(request, request.entityId, 'entity.created', request.visibility === 'owner' ? 'private' : request.visibility, { typeId: descriptor.typeId, revision: 1 });
      if (failureAt === 'after-entity') fail('injected', 'failure after entity creation');
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(result), now());
      assertCurrentLock(request.campaignId, currentLock); db.exec('COMMIT;'); return result;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const startWorkflow = request => {
    if (!request || !ID.test(request.operationId) || !ID.test(request.campaignId) || !ID.test(request.principalId) || !ID.test(request.workflowId) || !ID.test(request.entityId) || !Number.isInteger(request.expectedEntityRevision) || !Number.isFinite(Date.parse(request.expiresAt))) fail('invalid', 'malformed workflow creation');
    if (request.participants !== undefined && !Array.isArray(request.participants)) fail('invalid', 'workflow participants are invalid');
    const workflow = workflowTypes.get(request.workflowType); if (!workflow) fail('unsupported', 'workflow capability is unavailable');
    const initialState = workflow.states.find(item => item.stateId === workflow.initialState);
    const stateData = request.stateData ?? {}; validateBoundedJson(stateData, initialState.schema);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const currentMember = principal(request.principalId, request.campaignId); const currentLock = lockFor(request.campaignId); assertTypePinned(request.campaignId, currentLock, workflow);
      const { record } = readRecord(request.campaignId, request.entityId, currentMember, currentLock);
      if (record.typeId !== workflow.entityTypeId) fail('unsupported', 'workflow entity type is unavailable');
      if (currentMember.role !== 'gm' && record.ownerPrincipalId !== currentMember.principalId) fail('unauthorized', 'only the entity owner or GM can start this workflow');
      const participants = [...new Set([record.ownerPrincipalId, ...(request.participants ?? [])].filter(Boolean))];
      if (participants.length > 100 || participants.some(id => !ID.test(id))) fail('invalid', 'workflow participants are invalid');
      if (currentMember.role !== 'gm' && participants.some(id => id !== currentMember.principalId)) fail('unauthorized', 'only the GM may designate other workflow participants');
      const payload = { ...request, stateData, participants, capability: workflow.capability }; const payloadHash = hashV2Json(payload); const retry = receipt(request, payloadHash);
      if (retry) { assertCurrentLock(request.campaignId, currentLock); db.exec('COMMIT;'); return retry; }
      if (Date.parse(request.expiresAt) <= Date.parse(now())) fail('invalid', 'workflow expiry must be in the future');
      if (record.revision !== request.expectedEntityRevision) fail('stale', 'workflow entity revision is stale');
      const continuationId = createId(); if (!ID.test(continuationId)) fail('invalid', 'host produced invalid continuation identity');
      const result = { operationId: request.operationId, status: 'applied', workflow: { workflowId: request.workflowId, revision: 1, state: workflow.initialState, continuationId, status: 'active' } };
      db.prepare('INSERT INTO v2_extension_workflows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(request.workflowId, request.campaignId, request.entityId, workflow.workflowType, json(workflow.capability), 1, workflow.initialState, json(stateData), continuationId, json(participants), request.expiresAt, 'active', request.principalId, now());
      writeEvent(request, request.entityId, 'workflow.started', storedVisibility(record.visibility), { workflowId: request.workflowId, revision: 1 });
      if (failureAt === 'after-workflow') fail('injected', 'failure after workflow creation');
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(result), now()); assertCurrentLock(request.campaignId, currentLock); db.exec('COMMIT;'); return result;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const executeCommand = request => {
    if (!request || !ID.test(request.operationId) || !ID.test(request.campaignId) || !ID.test(request.principalId) || !ID.test(request.commandId) || !ID.test(request.entityId) || !Number.isInteger(request.expectedRevision) || request.expectedRevision < 1) fail('invalid', 'malformed extension command');
    if (request.workflow && (!ID.test(request.workflow.workflowId) || !Number.isInteger(request.workflow.expectedRevision) || !ID.test(request.workflow.expectedContinuationId) || !ID.test(request.workflow.transitionId))) fail('invalid', 'malformed workflow continuation');
    const command = commandTypes.get(request.commandId); if (!command) fail('unsupported', 'command capability is unavailable');
    validateBoundedJson(request.input, command.inputSchema);
    const payloadHash = hashV2Json(request);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const currentMember = principal(request.principalId, request.campaignId); const lock = lockFor(request.campaignId);
      requireCapability(lock, command.capability, request.campaignId); requireCapability(lock, command.resolver, request.campaignId);
      const resolver = resolverMap.get(refKey(command.resolver)); if (!resolver) fail('unsupported', 'required command resolver is unavailable');
      if (command.workflowOnly && !request.workflow) fail('invalid', 'this command requires an authorized workflow continuation');

      // Load persisted workflow state only after BEGIN IMMEDIATE. It is the
      // participant/continuation authority for both execution and retries.
      let workflowState; let workflowDescriptor;
      if (request.workflow) {
        const row = readWorkflowRow(request.workflow.workflowId); if (!row) fail('unavailable', 'workflow is unavailable');
        workflowState = decodeWorkflow(row); workflowDescriptor = workflowTypes.get(workflowState.workflowType);
        if (workflowState.campaignId !== request.campaignId || workflowState.entityId !== request.entityId || !workflowDescriptor || refKey(workflowDescriptor.capability) !== refKey(workflowState.capability) || workflowDescriptor.entityTypeId !== command.entityTypeId) fail('unavailable', 'workflow is unavailable');
        validateStoredWorkflow(workflowState, workflowDescriptor);
        assertTypePinned(request.campaignId, lock, workflowDescriptor);
        if (currentMember.role !== 'gm' && !workflowState.participants.includes(currentMember.principalId)) fail('unavailable', 'workflow is unavailable');
      }
      const authorizedParticipants = workflowState?.participants ?? [];
      const { record: currentRecord } = readRecord(request.campaignId, request.entityId, currentMember, lock, authorizedParticipants);
      if (currentRecord.typeId !== command.entityTypeId) fail('unsupported', 'command entity type is unavailable');
      if (!canCommand(currentMember, currentRecord, command.permission, authorizedParticipants)) fail('unauthorized', 'command is not permitted for this member and entity');

      // A receipt is returned only after re-authenticating and checking current
      // entity visibility/ownership and, for workflows, current participants.
      // Do not apply the old expected revision/continuation to an exact retry:
      // the successful first attempt has already advanced them.
      const retry = projectCommandReceipt(request, payloadHash, currentMember, currentRecord);
      if (retry) { assertCurrentLock(request.campaignId, lock); db.exec('COMMIT;'); return retry; }
      if (currentRecord.revision !== request.expectedRevision) fail('stale', 'entity revision changed');

      let workflowCtx;
      if (workflowState) {
        if (workflowState.status !== 'active' || workflowDescriptor.terminalStates.includes(workflowState.state)) fail('unavailable', 'workflow is unavailable');
        if (workflowState.revision !== request.workflow.expectedRevision || workflowState.continuationId !== request.workflow.expectedContinuationId) fail('stale', 'workflow continuation is stale');
        if (Date.parse(workflowState.expiresAt) <= Date.parse(now())) fail('expired', 'workflow has expired');
        const transition = workflowDescriptor.transitions.find(item => item.transitionId === request.workflow.transitionId && item.commandId === command.commandId && item.from.includes(workflowState.state));
        if (!transition) fail('conflict', 'workflow transition is not allowed from this state');
        if (transition.participantPolicy === 'gm' && currentMember.role !== 'gm' || transition.participantPolicy === 'owner-or-participant' && currentMember.role !== 'gm' && currentRecord.ownerPrincipalId !== currentMember.principalId && !workflowState.participants.includes(currentMember.principalId)) fail('unauthorized', 'workflow participant is not authorized');
        if (transition.kind === 'cancel' && !workflowDescriptor.terminalStates.includes(transition.to)) fail('invalid', 'workflow cancellation must enter a terminal state');
        workflowCtx = { state: workflowState, workflow: workflowDescriptor, transition };
      }
      const state = { entityId: currentRecord.entityId, entityType: currentRecord.typeId, revision: currentRecord.revision, data: currentRecord.data, ...(workflowCtx ? { workflow: { workflowId: workflowCtx.state.workflowId, state: workflowCtx.state.state, stateData: workflowCtx.state.stateData, continuationId: workflowCtx.state.continuationId } } : {}) };
      const immutableResolver = { ...resolver, resolve: input => resolver.resolve(freezeJson(input)) };
      const result = executeResolver(immutableResolver, { operationId: request.operationId, campaignId: request.campaignId, principalId: request.principalId, logicalTime: now(), state, input: request.input, randomness: [] }, lock);
      const output = result.transcript;
      for (const effect of output.effects) {
        const handler = effectHandlers.find(candidate => candidate.id === effect.handler && command.effects.some(ref => refKey(ref) === refKey(candidate)));
        if (!handler) fail('unsupported', 'command proposed an undeclared effect handler');
        requireCapability(lock, handler, request.campaignId);
        const target = entityRows(request.campaignId, effect.targetId); if (!target) fail('unavailable', 'effect target is unavailable');
        const targetRecord = decodeEntity(request.campaignId, target.row, target.metadata); currentDescriptor(targetRecord, lock);
        const expectedRevision = effect.targetId === request.entityId ? request.expectedRevision : request.expectedRevisions?.[effect.targetId];
        if (!Number.isInteger(expectedRevision) || expectedRevision !== targetRecord.revision) fail('stale', 'effect target revision is missing or stale');
        const visibility = storedVisibility(targetRecord.visibility);
        if (visibility !== effect.visibility) fail('unauthorized', 'effect visibility exceeds target visibility');
      }
      const effectProposal = output.effects.length ? { operationId: request.operationId, campaignId: request.campaignId, principalId: request.principalId, moduleId: lock.rootModule.id, commandId: command.commandId, ...(workflowCtx ? { authorizedParticipants: workflowCtx.state.participants, workflowEntityId: workflowCtx.state.entityId } : {}), lock, effects: output.effects.map(effect => {
        const handler = effectHandlers.find(candidate => candidate.id === effect.handler && command.effects.some(ref => refKey(ref) === refKey(candidate)));
        const target = entityRows(request.campaignId, effect.targetId); const targetRecord = decodeEntity(request.campaignId, target.row, target.metadata);
        return { effectId: effect.effectId, handler: { id: handler.id, apiVersion: handler.apiVersion, implementationVersion: handler.implementationVersion, digest: handler.digest }, target: { entityId: effect.targetId, expectedRevision: effect.targetId === request.entityId ? request.expectedRevision : request.expectedRevisions[effect.targetId], visibility: effect.visibility }, payload: effect.payload, visibility: effect.visibility };
      }) } : undefined;
      if (effectProposal) {
        effectProposal.commandEntityId = request.entityId;
        effectProposal.effectTargetPolicy = command.permission.effectTargetPolicy || 'source-entity';
        effects.applyInTransaction(effectProposal);
      }
      for (const effect of output.effects) {
        const target = entityRows(request.campaignId, effect.targetId); validateStoredEntity({ campaignId: request.campaignId, entityId: effect.targetId, entityType: target.row.entity_type, data: JSON.parse(target.row.data) });
      }
      const refreshed = entityRows(request.campaignId, request.entityId); const resultData = output.outcomes.map(({ kind, data, visibility }) => ({ kind, data, visibility })); validateBoundedJson(resultData, command.resultSchema);
      let workflowResult;
      if (workflowCtx) {
        const nextState = workflowCtx.workflow.states.find(item => item.stateId === workflowCtx.transition.to); const stateData = output.continuation?.state ?? workflowCtx.state.stateData; validateBoundedJson(stateData, nextState.schema);
        const revision = workflowCtx.state.revision + 1; const continuationId = output.continuation?.continuationId ?? `${workflowCtx.state.workflowId}:${revision}`; if (!ID.test(continuationId)) fail('invalid', 'invalid continuation identity');
        const status = workflowCtx.transition.kind === 'cancel' ? 'cancelled' : workflowCtx.workflow.terminalStates.includes(nextState.stateId) ? 'completed' : 'active';
        const update = db.prepare('UPDATE v2_extension_workflows SET revision=?, state=?, state_data=?, continuation_id=?, status=?, updated_at=? WHERE workflow_id=? AND revision=? AND continuation_id=? AND status=\'active\'').run(revision, nextState.stateId, json(stateData), continuationId, status, now(), workflowCtx.state.workflowId, workflowCtx.state.revision, workflowCtx.state.continuationId);
        if (update.changes !== 1) fail('stale', 'workflow revision changed');
        workflowResult = { workflowId: workflowCtx.state.workflowId, revision, state: nextState.stateId, continuationId, status };
      if (failureAt === 'after-workflow-transition' && workflowResult) fail('injected', 'failure after workflow transition');
      }
      const outcomes = visibleOutcomes(resultData, currentMember, currentRecord); const response = { operationId: request.operationId, status: 'applied', entityId: request.entityId, revision: refreshed.row.revision, outcomes, ...(workflowResult ? { workflow: workflowResult } : {}) };
      writeEvent(request, request.entityId, workflowResult ? 'command.workflow-transitioned' : 'command.applied', storedVisibility(currentRecord.visibility), { commandId: command.commandId, revision: response.revision, workflow: workflowResult ? { workflowId: workflowResult.workflowId, state: workflowResult.state, revision: workflowResult.revision } : undefined });
      if (failureAt === 'after-command-event') fail('injected', 'failure after command event');
      if (failureAt === 'after-command-effects' && effectProposal) fail('injected', 'failure after command effects');
      const storedResponse = { ...response, allOutcomes: resultData };
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(storedResponse), now());
      assertCurrentLock(request.campaignId, lock);
      if (failureAt === 'after-command-receipt') fail('injected', 'failure after command receipt');
      db.exec('COMMIT;'); return response;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const readWorkflow = (workflowId, principalId) => {
    const row = readWorkflowRow(workflowId); if (!row) fail('unavailable', 'workflow is unavailable'); const workflow = decodeWorkflow(row); const member = principal(principalId, workflow.campaignId); const lock = lockFor(workflow.campaignId); const descriptor = workflowTypes.get(workflow.workflowType);
    if (!descriptor) fail('unsupported', 'workflow capability is unavailable'); validateStoredWorkflow(workflow, descriptor); assertTypePinned(workflow.campaignId, lock, descriptor);
    const { record } = readRecord(workflow.campaignId, workflow.entityId, member, lock, workflow.participants); if (!canRead(member, record, workflow.participants) || (member.role !== 'gm' && !workflow.participants.includes(principalId) && record.ownerPrincipalId !== principalId)) fail('unavailable', 'workflow is unavailable');
    return clone(workflow);
  };
  const expireWorkflow = request => {
    if (!request || !ID.test(request.workflowId) || !ID.test(request.operationId) || !ID.test(request.principalId) || !Number.isInteger(request.expectedRevision) || !ID.test(request.expectedContinuationId ?? '')) fail('invalid', 'malformed workflow expiry');
    db.exec('BEGIN IMMEDIATE;'); try {
      const row = readWorkflowRow(request.workflowId); if (!row) fail('unavailable', 'workflow is unavailable'); const workflow = decodeWorkflow(row);
      const member = principal(request.principalId, workflow.campaignId); const descriptor = workflowTypes.get(workflow.workflowType); const lock = lockFor(workflow.campaignId);
      if (!descriptor) fail('unsupported', 'workflow capability is unavailable'); validateStoredWorkflow(workflow, descriptor); assertTypePinned(workflow.campaignId, lock, descriptor);
      const { record } = readRecord(workflow.campaignId, workflow.entityId, member, lock, workflow.participants);
      if (!descriptor.expirationRoles.includes(member.role) || (member.role !== 'gm' && record.ownerPrincipalId !== member.principalId && !workflow.participants.includes(member.principalId))) fail('unauthorized', 'workflow expiry is not permitted');
      const payload = { ...request, campaignId: workflow.campaignId, principalId: member.principalId }; const payloadHash = hashV2Json(payload); const retry = receipt(payload, payloadHash);
      if (retry) { assertCurrentLock(workflow.campaignId, lock); db.exec('COMMIT;'); return retry; }
      if (workflow.revision !== request.expectedRevision || workflow.continuationId !== request.expectedContinuationId) fail('stale', 'workflow continuation is stale');
      if (workflow.status !== 'active' || descriptor.terminalStates.includes(workflow.state)) fail('conflict', 'workflow is not active');
      if (Date.parse(workflow.expiresAt) > Date.parse(now())) fail('conflict', 'workflow has not expired');
      const update = db.prepare("UPDATE v2_extension_workflows SET revision=revision+1,status='expired',updated_at=? WHERE workflow_id=? AND revision=? AND continuation_id=? AND status='active'").run(now(), workflow.workflowId, request.expectedRevision, request.expectedContinuationId); if (update.changes !== 1) fail('stale', 'workflow revision changed');
      const response = { operationId: request.operationId, status: 'expired', workflowId: workflow.workflowId, revision: request.expectedRevision + 1 };
      writeEvent(payload, workflow.entityId, 'workflow.expired', storedVisibility(record.visibility), { workflowId: workflow.workflowId, revision: request.expectedRevision + 1 });
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, workflow.campaignId, member.principalId, payloadHash, json(response), now()); assertCurrentLock(workflow.campaignId, lock); db.exec('COMMIT;'); return response;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const snapshot = campaignId => {
    const lock = lockFor(campaignId);
    const tables = ['v2_effect_entities', 'v2_extension_entities', 'v2_extension_workflows', 'v2_extension_receipts', 'v2_extension_events'];
    const data = Object.fromEntries(tables.map(table => [table, table === 'v2_effect_entities'
      ? db.prepare('SELECT e.* FROM v2_effect_entities e JOIN v2_extension_entities x USING(campaign_id,entity_id) WHERE e.campaign_id=? ORDER BY e.entity_id').all(campaignId)
      : db.prepare(`SELECT * FROM ${table} WHERE campaign_id=? ORDER BY rowid`).all(campaignId)]));
    for (const [id, descriptor] of entityTypes) if (data.v2_extension_entities.some(row => row.descriptor_id === id)) requireCapability(lock, descriptor.capability, campaignId);
    for (const row of data.v2_extension_workflows) { const descriptor = workflowTypes.get(row.workflow_type); if (!descriptor) fail('unsupported', 'workflow capability is unavailable'); validateStoredWorkflow(decodeWorkflow(row), descriptor); requireCapability(lock, descriptor.capability, campaignId); }
    return clone({ format: 'potomac.v2-extension-snapshot', version: 1, campaignId, lock, data });
  };
  return { createEntity, read, list, events, executeCommand, startWorkflow, readWorkflow, expireWorkflow, snapshot };
}
