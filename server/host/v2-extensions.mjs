import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { executeResolver } from '../../packages/rules-engine/src/resolver.ts';
import { validateV2PreparationConstraints } from '../../packages/contracts/src/v2-preparation.ts';
import { createV2EffectKernel, canonicalV2Json, hashV2Json, validateV2JsonSchema, validateV2SchemaDefinition } from './v2-effects.mjs';
import { createV2ReactionKernel } from './v2-reactions.mjs';

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
CREATE TABLE IF NOT EXISTS v2_extension_pending_commands (
  operation_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, principal_id TEXT NOT NULL,
  command_id TEXT NOT NULL, entity_id TEXT NOT NULL, resolver TEXT NOT NULL, command_capability TEXT NOT NULL,
  lock TEXT NOT NULL, lock_digest TEXT NOT NULL, request TEXT NOT NULL, payload_hash TEXT NOT NULL, expected_revisions TEXT NOT NULL,
  continuation TEXT NOT NULL, suspension_transcript TEXT NOT NULL, window_id TEXT NOT NULL UNIQUE, authority_version INTEGER NOT NULL DEFAULT -1,
  status TEXT NOT NULL, response TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_authority_versions (
  campaign_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version >= 0)
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
  if (descriptor.creationConstraints !== undefined && (!Array.isArray(descriptor.creationConstraints) || descriptor.creationConstraints.some(constraint => !constraint || constraint.type !== 'unique-grid-positions' || !['participantsPath', 'gridPath', 'positionPath', 'blockedPath', 'namePath'].every(key => typeof constraint[key] === 'string' && /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(constraint[key]))))) fail('invalid', 'invalid entity creation constraints');
  if (descriptor.fieldVisibility !== undefined) {
    if (!Array.isArray(descriptor.fieldVisibility)) fail('invalid', 'invalid field visibility rules');
    const paths = new Set();
    for (const rule of descriptor.fieldVisibility) {
      if (!rule || typeof rule.path !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:(?:\.[A-Za-z][A-Za-z0-9_]*)|\.\*)*$/.test(rule.path) || paths.has(rule.path) || !Array.isArray(rule.roles) || rule.roles.length === 0 || rule.roles.some(role => !['gm', 'player'].includes(role))) fail('invalid', 'invalid field visibility rule');
      let schema = descriptor.schema;
      for (const part of rule.path.split('.')) {
        schema = part === '*' ? schema?.items : schema?.properties?.[part];
        if (!schema) fail('invalid', `field visibility path ${rule.path} is not declared by the entity schema`);
      }
      paths.add(rule.path);
    }
  }
}

function validateCommandDescriptor(command) {
  if (!command || command.descriptorVersion !== 1 || !NAMESPACED.test(command.commandId) || !NAMESPACED.test(command.entityTypeId) || !Array.isArray(command.permission?.roles) || command.permission.roles.length === 0 || command.permission.roles.some(role => !['gm', 'player'].includes(role)) || !['any', 'owner', 'gm', 'owner-or-participant'].includes(command.permission.ownership) || command.permission.effectTargetPolicy !== undefined && !['source-entity', 'campaign-visible'].includes(command.permission.effectTargetPolicy) || command.permission.noPendingContinuations !== undefined && typeof command.permission.noPendingContinuations !== 'boolean' || command.workflowOnly !== undefined && typeof command.workflowOnly !== 'boolean' || !Array.isArray(command.effects)) fail('invalid', 'invalid command descriptor');
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

export function createV2ExtensionKernel({ db, entities, commands, workflows = [], effectHandlers, resolvers, authenticate, getCampaignLock, validateLock, validateEntityCreation = () => undefined, authorizeEffect = () => true, authorizeOwner = () => false, authorizeRead = () => false, authorizeCommand = () => false, authorizeCommandIntent = () => true, resolveReactionEligibility = () => [], authorizeReactionResponder = () => false, reauthorizePendingActor, drawRandom = cryptoRandomInt, now = () => new Date().toISOString(), createId = randomUUID, failureAt } = {}) {
  if (!db || !Array.isArray(entities) || !Array.isArray(commands) || !Array.isArray(workflows) || !Array.isArray(effectHandlers) || !Array.isArray(resolvers) || typeof authenticate !== 'function' || typeof getCampaignLock !== 'function' || typeof validateLock !== 'function' || typeof validateEntityCreation !== 'function') fail('invalid', 'invalid extension kernel configuration');
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
  const pendingColumns = new Set(db.prepare('PRAGMA table_info(v2_extension_pending_commands)').all().map(column => column.name));
  if (!pendingColumns.has('authority_version')) db.exec('ALTER TABLE v2_extension_pending_commands ADD COLUMN authority_version INTEGER NOT NULL DEFAULT -1');
  const principal = (principalId, campaignId, authorityToken) => {
    const result = authenticate(principalId, { campaignId, authorityToken });
    if (!result || result.principalId !== principalId || !['gm', 'player'].includes(result.role)) fail('unauthorized', 'authenticated campaign member required');
    return result;
  };
  if (reauthorizePendingActor !== undefined && typeof reauthorizePendingActor !== 'function' || typeof resolveReactionEligibility !== 'function' || typeof authorizeReactionResponder !== 'function') fail('invalid', 'invalid pending-command authority configuration');
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
  const canRead = (member, entity, participants = []) => entity.visibility === 'public' || member.role === 'gm' || (entity.visibility === 'owner' && (entity.ownerPrincipalId === member.principalId || participants.includes(member.principalId))) || authorizeRead({ member: clone(member), entity: clone(entity) }) === true;
  const canCommand = (member, entity, permission, participants = []) => {
    if (!permission.roles.includes(member.role)) return false;
    const ownershipMatches = permission.ownership === 'any' || (permission.ownership === 'gm' && member.role === 'gm') || (permission.ownership === 'owner' && entity.ownerPrincipalId === member.principalId) || (permission.ownership === 'owner-or-participant' && (entity.ownerPrincipalId === member.principalId || participants.includes(member.principalId) || member.role === 'gm'));
    const grantCanAuthorize = permission.ownership !== 'gm' && authorizeCommand({ member: clone(member), entity: clone(entity), permission: clone(permission) }) === true;
    return ownershipMatches || grantCanAuthorize;
  };
  const assertCommandAuthority = ({ request, command, member, entity, lock, participants = [] }) => {
    const currentMember = principal(request.principalId, request.campaignId, request.authorityToken);
    const currentLock = lockFor(request.campaignId);
    if (hashV2Json(currentLock) !== hashV2Json(lock)) fail('unsupported', 'campaign capability lock changed during extension operation');
    const { record } = readRecord(request.campaignId, request.entityId, currentMember, currentLock, participants);
    if (record.typeId !== command.entityTypeId || !canCommand(currentMember, record, command.permission, participants)) fail('unauthorized', 'command authority changed during extension operation');
    const { authorityToken: _authorityToken, ...publicRequest } = request;
    if (authorizeCommandIntent({ member: clone(currentMember), entity: clone(record), command: clone(command), request: clone(publicRequest) }) !== true) fail('unauthorized', 'command-specific authority changed during extension operation');
  };
  const projectRecord = (record, descriptor, member) => {
    const result = clone(record);
    const viewerOwnedPaths = [];
    for (const rule of descriptor.fieldVisibility || []) if (!rule.roles.includes(member.role)) {
      const parts = rule.path.split('.');
      const redact = (value, index, parentPath = []) => {
        const part = parts[index];
        if (part === '*') { if (Array.isArray(value)) value.forEach((item, itemIndex) => redact(item, index + 1, [...parentPath, String(itemIndex)])); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        if (index === parts.length - 1) {
          if (part === 'ownerPrincipalId' && value[part] === member.principalId && parentPath.length) viewerOwnedPaths.push(parentPath.join('.'));
          delete value[part];
        } else redact(value[part], index + 1, [...parentPath, part]);
      };
      redact(result.data, 0);
    }
    if (member.role !== 'gm' && result.ownerPrincipalId !== member.principalId) delete result.ownerPrincipalId;
    if (viewerOwnedPaths.length) result.viewerOwnedPaths = [...new Set(viewerOwnedPaths)];
    return result;
  };
  const transaction = (work, mode = 'IMMEDIATE') => {
    if (db.isTransaction) fail('invalid', 'nested V2 host transaction is not supported');
    db.exec(`BEGIN ${mode}`); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  };
  const authorityVersion = campaignId => {
    db.prepare('INSERT OR IGNORE INTO v2_authority_versions(campaign_id,version) VALUES(?,0)').run(campaignId);
    return db.prepare('SELECT version FROM v2_authority_versions WHERE campaign_id=?').get(campaignId)?.version;
  };
  const assertAuthorityVersion = (campaignId, expected) => {
    if (authorityVersion(campaignId) !== expected) fail('unauthorized', 'campaign or principal authority changed during extension operation');
  };
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
    db, handlers: effectHandlers, authenticate: (principalId, proposal) => Boolean(principal(principalId, proposal.campaignId, proposal.authorityToken)),
    validateLock: (campaignId, lock, moduleId) => {
      const currentLock = lockFor(campaignId);
      if (hashV2Json(currentLock) !== hashV2Json(lock)) fail('unsupported', 'campaign capability lock changed during command execution');
      if (lock.rootModule.id !== moduleId) fail('unsupported', 'effect proposal module does not match campaign lock');
    },
    authorize: context => {
      const found = entityRows(context.campaignId, context.effect.target.entityId); if (!found) return false;
      const record = decodeEntity(context.campaignId, found.row, found.metadata); const lock = lockFor(context.campaignId);
      try { currentDescriptor(record, lock); } catch { return false; }
      const member = principal(context.principalId, context.campaignId, context.authorityToken); const command = commandTypes.get(context.commandId);
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
    const { allOutcomes, resolutionTranscript, suspensionTranscript, ...base } = stored;
    if (member.role === 'gm' && resolutionTranscript) base.resolutionTranscript = resolutionTranscript;
    if (member.role === 'gm' && suspensionTranscript) base.suspensionTranscript = suspensionTranscript;
    return { ...base, outcomes: visibleOutcomes(allOutcomes, member, entity) };
  };
  const writeEvent = (request, entityId, kind, visibility, payload) => db.prepare('INSERT INTO v2_extension_events(event_id,operation_id,campaign_id,entity_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`${request.operationId}:${kind}`, request.operationId, request.campaignId, entityId, kind, visibility, json(payload), now());
  const drawResolverRandomness = (resolver, member, command, state, input, resume) => {
    const randomness = [];
    for (let step = 0; step < 4; step++) {
      const requestContext = { principalId: member.principalId, command: clone(command), state: clone(state), input: clone(input), randomness: clone(randomness), ...(resume ? { resume: clone(resume) } : {}) };
      const requested = resolver.randomRequests?.(requestContext) ?? [];
      if (!Array.isArray(requested) || requested.length > 4) fail('invalid', 'resolver requested an invalid random transcript');
      const known = new Set(randomness.map(item => item.requestId));
      for (const item of requested) {
        if (!item || !ID.test(item.requestId) || known.has(item.requestId) || !['die', 'pool'].includes(item.kind) || !Number.isInteger(item.count) || item.count < 1 || item.count > 20 || !Number.isInteger(item.sides) || item.sides < 2 || item.sides > 100) fail('invalid', 'resolver random request exceeds host bounds');
        known.add(item.requestId);
        const visibility = item.visibility ?? 'public';
        if (!['public', 'gm', 'private'].includes(visibility)) fail('invalid', 'resolver random request has invalid visibility');
        randomness.push({ ...clone(item), values: Array.from({ length: item.count }, () => drawRandom(1, item.sides + 1)), visibility });
      }
    }
    if (resolver.randomRequests?.({ principalId: member.principalId, command: clone(command), state: clone(state), input: clone(input), randomness: clone(randomness), ...(resume ? { resume: clone(resume) } : {}) })?.length) fail('invalid', 'resolver random request budget was exhausted');
    return randomness;
  };
  const applyOutputEffects = ({ output, request, command, member, lock, workflowCtx, beforeApply = () => undefined }) => {
    for (const effect of output.effects) {
      const handler = effectHandlers.find(candidate => candidate.id === effect.handler && command.effects.some(ref => refKey(ref) === refKey(candidate)));
      if (!handler) fail('unsupported', 'command proposed an undeclared effect handler');
      requireCapability(lock, handler, request.campaignId);
      const target = entityRows(request.campaignId, effect.targetId); if (!target) fail('unavailable', 'effect target is unavailable');
      const targetRecord = decodeEntity(request.campaignId, target.row, target.metadata); currentDescriptor(targetRecord, lock);
      const expectedRevision = effect.targetId === request.entityId ? request.expectedRevision : request.expectedRevisions?.[effect.targetId];
      if (!Number.isInteger(expectedRevision) || expectedRevision !== targetRecord.revision) fail('stale', 'effect target revision is missing or stale');
      if (storedVisibility(targetRecord.visibility) !== effect.visibility) fail('unauthorized', 'effect visibility exceeds target visibility');
    }
    if (!output.effects.length) return undefined;
    beforeApply();
    const effectProposal = { operationId: request.operationId, campaignId: request.campaignId, principalId: member.principalId, moduleId: lock.rootModule.id, commandId: command.commandId, ...(workflowCtx ? { authorizedParticipants: workflowCtx.state.participants, workflowEntityId: workflowCtx.state.entityId } : {}), lock, effects: output.effects.map(effect => {
      const handler = effectHandlers.find(candidate => candidate.id === effect.handler && command.effects.some(ref => refKey(ref) === refKey(candidate)));
      const target = entityRows(request.campaignId, effect.targetId); const targetRecord = decodeEntity(request.campaignId, target.row, target.metadata);
      return { effectId: effect.effectId, handler: { id: handler.id, apiVersion: handler.apiVersion, implementationVersion: handler.implementationVersion, digest: handler.digest }, target: { entityId: effect.targetId, expectedRevision: effect.targetId === request.entityId ? request.expectedRevision : request.expectedRevisions[effect.targetId], visibility: effect.visibility }, payload: effect.payload, visibility: effect.visibility };
    }) };
    effectProposal.commandEntityId = request.entityId;
    if (request.authorityToken !== undefined) effectProposal.authorityToken = request.authorityToken;
    effectProposal.effectTargetPolicy = command.permission.effectTargetPolicy || 'source-entity';
    effects.applyInTransaction(effectProposal);
    for (const effect of output.effects) {
      const target = entityRows(request.campaignId, effect.targetId);
      validateStoredEntity({ campaignId: request.campaignId, entityId: effect.targetId, entityType: target.row.entity_type, data: JSON.parse(target.row.data) });
    }
    return effectProposal;
  };
  const terminalConflict = (pending, reasonCode) => {
    const request = JSON.parse(pending.request);
    const response = { operationId: pending.operation_id, status: 'conflicted', reasonCode, windowId: pending.window_id };
    writeEvent(request, pending.entity_id, 'command.resume-conflicted', 'gm', { commandId: pending.command_id, windowId: pending.window_id, reasonCode });
    db.prepare('UPDATE v2_extension_pending_commands SET status=?, response=?, updated_at=? WHERE operation_id=? AND status=?').run('conflicted', json(response), now(), pending.operation_id, 'pending');
    db.prepare('UPDATE v2_extension_receipts SET response=?, created_at=? WHERE operation_id=? AND payload_hash=?').run(json(response), now(), pending.operation_id, pending.payload_hash);
    return response;
  };
  const resumePendingCommand = ({ window, status, decisions }) => {
    const pending = db.prepare('SELECT * FROM v2_extension_pending_commands WHERE window_id=?').get(window.windowId);
    if (!pending || pending.status !== 'pending' || pending.operation_id !== window.parentOperationId || pending.campaign_id !== window.campaignId) fail('conflict', 'pending command is unavailable');
    const request = JSON.parse(pending.request); const storedLock = JSON.parse(pending.lock); const command = commandTypes.get(pending.command_id);
    const conflict = error => {
      const code = ['stale', 'unsupported', 'unauthorized', 'unavailable', 'expired'].includes(error?.code) ? error.code : undefined;
      if (!code) throw error;
      return terminalConflict(pending, code);
    };
    let effectApplicationStarted = false;
    try {
      if (request.operationId !== pending.operation_id || request.campaignId !== pending.campaign_id || request.principalId !== pending.principal_id || request.commandId !== pending.command_id || request.entityId !== pending.entity_id || hashV2Json(request) !== pending.payload_hash) fail('conflict', 'pending command identity integrity check failed');
      if (hashV2Json(window.lock) !== hashV2Json(storedLock) || hashV2Json(window.resolver) !== hashV2Json(JSON.parse(pending.resolver)) || hashV2Json(window.continuation?.continuation) !== hashV2Json(JSON.parse(pending.continuation)) || window.continuation?.actorPrincipalId !== pending.principal_id) fail('conflict', 'reaction continuation identity does not match its pending command');
      const currentAuthorityVersion = authorityVersion(pending.campaign_id);
      if (pending.authority_version < 0 || currentAuthorityVersion !== pending.authority_version) fail('unauthorized', 'campaign or principal authority changed while command was suspended');
      if (!reauthorizePendingActor) fail('unauthorized', 'pending actor reauthorization is not configured');
      const currentMember = reauthorizePendingActor({ principalId: pending.principal_id, campaignId: pending.campaign_id, commandId: pending.command_id, entityId: pending.entity_id });
      if (!currentMember || currentMember.principalId !== pending.principal_id || !['gm', 'player'].includes(currentMember.role)) fail('unauthorized', 'pending actor is no longer authorized');
      const currentLock = lockFor(pending.campaign_id);
      if (hashV2Json(storedLock) !== pending.lock_digest || hashV2Json(currentLock) !== pending.lock_digest) fail('unsupported', 'campaign capability lock changed while command was suspended');
      const pinnedResolverRef = JSON.parse(pending.resolver);
      if (!command || command.commandId !== pending.command_id || refKey(command.resolver) !== refKey(pinnedResolverRef) || refKey(command.capability) !== refKey(JSON.parse(pending.command_capability)) || refKey(window.resolver) !== refKey(pinnedResolverRef)) fail('unsupported', 'pinned resume resolver or command capability is unavailable');
      requireCapability(currentLock, command.capability, pending.campaign_id); requireCapability(currentLock, command.resolver, pending.campaign_id);
      const resolver = resolverMap.get(refKey(pinnedResolverRef)); if (!resolver?.resume) fail('unsupported', 'pinned resolver has no trusted resume implementation');
      const { record } = readRecord(pending.campaign_id, pending.entity_id, currentMember, currentLock);
      if (record.typeId !== command.entityTypeId) fail('unsupported', 'source entity type changed while command was suspended');
      if (record.revision !== request.expectedRevision) fail('stale', 'source entity revision changed while command was suspended');
      if (!canCommand(currentMember, record, command.permission)) fail('unauthorized', 'source command authority was revoked');
      if (authorizeCommandIntent({ member: clone(currentMember), entity: clone(record), command: clone(command), request: clone(request) }) !== true) fail('unauthorized', 'suspended command authority was revoked');
      for (const decision of decisions) {
        const eligible = window.eligible.find(item => item.principalId === decision.principalId);
        const action = eligible?.actions.find(item => item.actionId === decision.actionId);
        if (!eligible || !action || authorizeReactionResponder({ principalId: decision.principalId, window, action }) !== true) fail('unauthorized', 'a reaction participant is no longer authorized');
      }
      const expectedRevisions = JSON.parse(pending.expected_revisions);
      for (const [entityId, expectedRevision] of Object.entries(expectedRevisions)) {
        const target = entityRows(pending.campaign_id, entityId);
        if (!target || target.row.revision !== expectedRevision) fail('stale', 'an expected effect target changed while command was suspended');
        const targetRecord = decodeEntity(pending.campaign_id, target.row, target.metadata); currentDescriptor(targetRecord, currentLock);
        if (!canRead(currentMember, targetRecord)) fail('unavailable', 'an expected effect target is unavailable');
      }
      assertCurrentLock(pending.campaign_id, storedLock);
      const continuation = JSON.parse(pending.continuation);
      const state = { entityId: record.entityId, entityType: record.typeId, revision: record.revision, data: record.data };
      const logicalTime = now();
      const resumeContext = { continuation, reaction: { status, decisions: clone(decisions) } };
      const randomness = drawResolverRandomness(resolver, currentMember, command, state, request.input, resumeContext);
      const resumeResolver = { ...resolver, resolve: input => { const { resume: context, ...base } = input; return resolver.resume(freezeJson({ ...base, ...context })); } };
      const result = executeResolver(resumeResolver, { operationId: pending.operation_id, campaignId: pending.campaign_id, principalId: pending.principal_id, logicalTime, state, input: request.input, randomness, resume: resumeContext }, storedLock);
      const output = result.transcript;
      if (output.continuation) fail('invalid', 'reaction resume cannot create another continuation');
      if (failureAt === 'after-resume-resolution') fail('injected', 'failure after resume resolution');
      const resultData = output.outcomes.map(({ kind, data, visibility }) => ({ kind, data, visibility })); validateBoundedJson(resultData, command.resultSchema);
      const resumeRequest = { ...request, authorityToken: currentMember.authorityToken };
      applyOutputEffects({ output, request: resumeRequest, command, member: currentMember, lock: storedLock, beforeApply: () => { effectApplicationStarted = true; } });
      if (failureAt === 'after-resume-effects') fail('injected', 'failure after resumed effects');
      const refreshed = entityRows(pending.campaign_id, pending.entity_id);
      const response = { operationId: pending.operation_id, status: 'applied', entityId: pending.entity_id, revision: refreshed.row.revision, windowId: pending.window_id, outcomes: visibleOutcomes(resultData, currentMember, record) };
      const publicReactionDecisions = decisions.filter(item => window.eligible.find(candidate => candidate.principalId === item.principalId)?.actions.find(action => action.actionId === item.actionId)?.visibility === 'public').map(({ principalId, actionId, decision }) => ({ principalId, actionId, decision }));
      writeEvent(request, pending.entity_id, 'command.resumed', storedVisibility(record.visibility), { commandId: command.commandId, windowId: pending.window_id, status, outcomes: resultData.filter(item => item.visibility === 'public'), transcriptDigest: output.digest, randomness: output.randomness.filter(item => item.visibility === 'public'), decisions: output.decisions.filter(item => item.visibility === 'public'), reactionDecisions: publicReactionDecisions });
      const storedResponse = { ...response, allOutcomes: resultData, suspensionTranscript: JSON.parse(pending.suspension_transcript), resolutionTranscript: output };
      db.prepare('UPDATE v2_extension_pending_commands SET status=?, response=?, updated_at=? WHERE operation_id=? AND status=?').run('completed', json(storedResponse), now(), pending.operation_id, 'pending');
      db.prepare('UPDATE v2_extension_receipts SET response=?, created_at=? WHERE operation_id=? AND payload_hash=?').run(json(storedResponse), now(), pending.operation_id, pending.payload_hash);
      if (failureAt === 'after-final-receipt') fail('injected', 'failure after final command receipt');
      assertCommandAuthority({ request: { ...request, authorityToken: currentMember.authorityToken }, command, member: currentMember, entity: record, lock: storedLock });
      assertAuthorityVersion(pending.campaign_id, pending.authority_version);
      assertCurrentLock(pending.campaign_id, storedLock);
      return response;
    } catch (error) { if (effectApplicationStarted) throw error; return conflict(error); }
  };
  const reactionKernel = createV2ReactionKernel({
    db,
    authenticate: (principalId, context) => Boolean(principal(principalId, context.campaignId, context.authorityToken)),
    authorizeResponder: context => authorizeReactionResponder(context) === true,
    authorizeGm: context => { try {
      if (principal(context.principalId, context.campaignId, context.authorityToken).role === 'gm') return true;
      const pending = db.prepare("SELECT operation_id,principal_id,campaign_id,window_id FROM v2_extension_pending_commands WHERE operation_id=? AND status='pending'").get(context.window?.parentOperationId);
      return Boolean(pending && pending.principal_id === context.principalId && pending.campaign_id === context.campaignId && pending.window_id === context.window.windowId);
    } catch { return false; } },
    authorizeView: context => { try { const member = principal(context.principalId, context.window.campaignId, context.authorityToken); const eligible = context.window.eligible.some(item => item.principalId === member.principalId && item.actions.some(action => authorizeReactionResponder({ principalId: member.principalId, window: context.window, action, authorityToken: context.authorityToken }) === true)); return { role: member.role === 'gm' ? 'gm' : eligible ? 'responder' : context.window.visibility === 'public' ? 'public' : null }; } catch { return null; } },
    authorizeExpiry: context => { try { return principal(context.principalId, context.window.campaignId, context.authorityToken).role === 'gm'; } catch { return false; } },
    validateLock: (campaignId, value) => { const current = lockFor(campaignId); if (hashV2Json(current) !== hashV2Json(value)) fail('unsupported', 'reaction capability lock changed'); },
    validateInput: (input, schema) => validateV2JsonSchema(input, schema),
    complete: input => { resumePendingCommand(input); return undefined; },
    applyEffects: () => undefined,
    now
  });
  const read = (campaignId, entityId, principalId, expectedLockDigest, authorityToken) => transaction(() => {
    const member = principal(principalId, campaignId, authorityToken); const lock = lockFor(campaignId);
    if (expectedLockDigest !== undefined && hashV2Json(lock) !== expectedLockDigest) fail('unsupported', 'campaign capability lock digest is stale');
    const { record, descriptor } = readRecord(campaignId, entityId, member, lock);
    return projectRecord(record, descriptor, member);
  }, 'DEFERRED');
  const availableCommands = (campaignId, entityId, principalId, expectedLockDigest, authorityToken) => transaction(() => {
    const member = principal(principalId, campaignId, authorityToken); const lock = lockFor(campaignId);
    if (expectedLockDigest !== undefined && hashV2Json(lock) !== expectedLockDigest) fail('unsupported', 'campaign capability lock digest is stale');
    const { record } = readRecord(campaignId, entityId, member, lock);
    return [...commandTypes.values()].filter(command => command.entityTypeId === record.typeId && canCommand(member, record, command.permission)).map(command => command.commandId);
  }, 'DEFERRED');
  const list = (campaignId, typeId, principalId, expectedLockDigest, authorityToken) => transaction(() => {
    const member = principal(principalId, campaignId, authorityToken); const lock = lockFor(campaignId); const descriptor = entityTypes.get(typeId);
    if (!descriptor) fail('unsupported', 'entity capability is unavailable'); assertTypePinned(campaignId, lock, descriptor);
    if (expectedLockDigest !== undefined && hashV2Json(lock) !== expectedLockDigest) fail('unsupported', 'campaign capability lock digest is stale');
    return db.prepare('SELECT e.*, x.descriptor_id, x.schema_version, x.migration_id, x.capability, x.owner_principal_id FROM v2_effect_entities e JOIN v2_extension_entities x USING(campaign_id,entity_id) WHERE e.campaign_id=? AND e.entity_type=? ORDER BY e.entity_id').all(campaignId, typeId).flatMap(row => {
      const metadata = { descriptor_id: row.descriptor_id, schema_version: row.schema_version, migration_id: row.migration_id, capability: row.capability, owner_principal_id: row.owner_principal_id };
      const record = decodeEntity(campaignId, row, metadata);
      try { currentDescriptor(record, lock); validateBoundedJson(record.data, descriptor.schema); } catch { return []; }
      return canRead(member, record) ? [projectRecord(record, descriptor, member)] : [];
    });
  }, 'DEFERRED');
  const events = (campaignId, principalId, authorityToken) => transaction(() => {
    const member = principal(principalId, campaignId, authorityToken); const lock = lockFor(campaignId);
    return db.prepare('SELECT * FROM v2_extension_events WHERE campaign_id=? ORDER BY rowid').all(campaignId).flatMap(row => {
      if (row.visibility === 'private' && member.role !== 'gm') {
        const found = entityRows(campaignId, row.entity_id); if (!found) return [];
        try { const entity = decodeEntity(campaignId, found.row, found.metadata); currentDescriptor(entity, lock); if (entity.ownerPrincipalId !== member.principalId) return []; } catch { return []; }
      }
      if (row.visibility === 'gm' && member.role !== 'gm') return [];
      if (row.visibility === 'public' && member.role !== 'gm') {
        const found = entityRows(campaignId, row.entity_id); if (!found) return [];
        try { const entity = decodeEntity(campaignId, found.row, found.metadata); currentDescriptor(entity, lock); if (!canRead(member, entity)) return []; } catch { return []; }
      }
      return [{ eventId: row.event_id, operationId: row.operation_id, entityId: row.entity_id, kind: row.kind, visibility: row.visibility, payload: JSON.parse(row.payload) }];
    });
  }, 'DEFERRED');
  const createEntity = request => {
    if (!request || !ID.test(request.operationId) || !ID.test(request.campaignId) || !ID.test(request.principalId) || !ID.test(request.entityId) || !['public', 'gm', 'owner'].includes(request.visibility)) fail('invalid', 'malformed entity creation');
    const descriptor = entityTypes.get(request.typeId); if (!descriptor) fail('unsupported', 'entity capability is unavailable');
    validateBoundedJson(request.data, descriptor.schema);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const versionAtStart = authorityVersion(request.campaignId);
      const currentMember = principal(request.principalId, request.campaignId, request.authorityToken); const currentLock = lockFor(request.campaignId); assertTypePinned(request.campaignId, currentLock, descriptor);
      if (request.expectedLockDigest !== undefined && hashV2Json(currentLock) !== request.expectedLockDigest) fail('unsupported', 'campaign capability lock digest is stale');
      if (!descriptor.creationRoles.includes(currentMember.role)) fail('unauthorized', 'entity creation is not permitted');
      const preparationErrors = validateV2PreparationConstraints(request.data, descriptor.creationConstraints ?? []);
      if (preparationErrors.length) fail('invalid', preparationErrors[0]);
      validateEntityCreation({
        descriptor: clone(descriptor),
        data: clone(request.data),
        campaignId: request.campaignId,
        member: clone(currentMember),
        isActiveMember: principalId => authorizeOwner({ campaignId: request.campaignId, ownerPrincipalId: principalId })
      });
      if (descriptor.ownership.kind === 'principal' && currentMember.role !== 'gm' && Object.hasOwn(request, 'ownerPrincipalId')) fail('unauthorized', 'only the GM may assign a principal-owned entity');
      if (descriptor.ownership.kind === 'campaign' && Object.hasOwn(request, 'ownerPrincipalId')) fail('invalid', 'campaign-owned entities cannot be assigned a principal owner');
      const owner = descriptor.ownership.kind === 'principal' ? (currentMember.role === 'gm' ? request.ownerPrincipalId ?? request.principalId : request.principalId) : null;
      if (descriptor.ownership.kind === 'principal' && (!ID.test(owner ?? '') || request.visibility !== 'owner')) fail('invalid', 'principal-owned entities require an owner and owner visibility');
      if (descriptor.ownership.kind === 'campaign' && (owner || request.visibility === 'owner')) fail('invalid', 'campaign-owned entities cannot have an owner visibility');
      if (!descriptor.visibility.includes(request.visibility)) fail('invalid', 'entity visibility is not declared by its descriptor');
      if (currentMember.role !== 'gm' && owner !== currentMember.principalId) fail('unauthorized', 'member cannot assign another entity owner');
      if (owner && owner !== currentMember.principalId && !authorizeOwner({ campaignId: request.campaignId, ownerPrincipalId: owner })) fail('unavailable', 'entity owner is not an active campaign member');
      const { authorityToken: _authorityToken, ...publicRequest } = request;
      const payload = { ...publicRequest, ownerPrincipalId: owner, capability: descriptor.capability, schemaVersion: descriptor.schemaVersion, migrationId: descriptor.migration.migrationId };
      const payloadHash = hashV2Json(payload); const retry = receipt(request, payloadHash);
      if (retry) { assertCurrentLock(request.campaignId, currentLock); assertAuthorityVersion(request.campaignId, versionAtStart); db.exec('COMMIT;'); return retry; }
      db.prepare('INSERT INTO v2_effect_entities(campaign_id,entity_id,entity_type,revision,visibility,data) VALUES(?,?,?,?,?,?)').run(request.campaignId, request.entityId, descriptor.typeId, 1, storedVisibility(request.visibility), json(request.data));
      db.prepare('INSERT INTO v2_extension_entities(campaign_id,entity_id,descriptor_id,schema_version,migration_id,capability,owner_principal_id) VALUES(?,?,?,?,?,?,?)').run(request.campaignId, request.entityId, descriptor.typeId, descriptor.schemaVersion, descriptor.migration.migrationId, json(descriptor.capability), owner);
      const result = { operationId: request.operationId, status: 'applied', entityId: request.entityId, revision: 1 };
      writeEvent(request, request.entityId, 'entity.created', request.visibility === 'owner' ? 'private' : request.visibility, { typeId: descriptor.typeId, revision: 1 });
      if (failureAt === 'after-entity') fail('injected', 'failure after entity creation');
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(result), now());
      assertCurrentLock(request.campaignId, currentLock); assertAuthorityVersion(request.campaignId, versionAtStart); db.exec('COMMIT;'); return result;
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
      const versionAtStart = authorityVersion(request.campaignId);
      const currentMember = principal(request.principalId, request.campaignId, request.authorityToken); const currentLock = lockFor(request.campaignId); assertTypePinned(request.campaignId, currentLock, workflow);
      const { record } = readRecord(request.campaignId, request.entityId, currentMember, currentLock);
      if (record.typeId !== workflow.entityTypeId) fail('unsupported', 'workflow entity type is unavailable');
      if (currentMember.role !== 'gm' && record.ownerPrincipalId !== currentMember.principalId) fail('unauthorized', 'only the entity owner or GM can start this workflow');
      const participants = [...new Set([record.ownerPrincipalId, ...(request.participants ?? [])].filter(Boolean))];
      if (participants.length > 100 || participants.some(id => !ID.test(id))) fail('invalid', 'workflow participants are invalid');
      if (currentMember.role !== 'gm' && participants.some(id => id !== currentMember.principalId)) fail('unauthorized', 'only the GM may designate other workflow participants');
      const { authorityToken: _authorityToken, ...publicRequest } = request;
      const payload = { ...publicRequest, stateData, participants, capability: workflow.capability }; const payloadHash = hashV2Json(payload); const retry = receipt(request, payloadHash);
      if (retry) { assertCurrentLock(request.campaignId, currentLock); assertAuthorityVersion(request.campaignId, versionAtStart); db.exec('COMMIT;'); return retry; }
      if (Date.parse(request.expiresAt) <= Date.parse(now())) fail('invalid', 'workflow expiry must be in the future');
      if (record.revision !== request.expectedEntityRevision) fail('stale', 'workflow entity revision is stale');
      const continuationId = createId(); if (!ID.test(continuationId)) fail('invalid', 'host produced invalid continuation identity');
      const result = { operationId: request.operationId, status: 'applied', workflow: { workflowId: request.workflowId, revision: 1, state: workflow.initialState, continuationId, status: 'active' } };
      db.prepare('INSERT INTO v2_extension_workflows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(request.workflowId, request.campaignId, request.entityId, workflow.workflowType, json(workflow.capability), 1, workflow.initialState, json(stateData), continuationId, json(participants), request.expiresAt, 'active', request.principalId, now());
      writeEvent(request, request.entityId, 'workflow.started', storedVisibility(record.visibility), { workflowId: request.workflowId, revision: 1 });
      if (failureAt === 'after-workflow') fail('injected', 'failure after workflow creation');
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(result), now()); assertCurrentLock(request.campaignId, currentLock); assertAuthorityVersion(request.campaignId, versionAtStart); db.exec('COMMIT;'); return result;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const executeCommand = request => {
    if (!request || !ID.test(request.operationId) || !ID.test(request.campaignId) || !ID.test(request.principalId) || !ID.test(request.commandId) || !ID.test(request.entityId) || !Number.isInteger(request.expectedRevision) || request.expectedRevision < 1) fail('invalid', 'malformed extension command');
    if (Object.hasOwn(request, 'randomness')) fail('invalid', 'randomness is host supplied and cannot be included in a command');
    if (request.workflow && (!ID.test(request.workflow.workflowId) || !Number.isInteger(request.workflow.expectedRevision) || !ID.test(request.workflow.expectedContinuationId) || !ID.test(request.workflow.transitionId))) fail('invalid', 'malformed workflow continuation');
    const command = commandTypes.get(request.commandId); if (!command) fail('unsupported', 'command capability is unavailable');
    validateBoundedJson(request.input, command.inputSchema);
    const { authorityToken: _authorityToken, ...payload } = request;
    const payloadHash = hashV2Json(payload);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const authorityVersionAtStart = authorityVersion(request.campaignId);
      const currentMember = principal(request.principalId, request.campaignId, request.authorityToken); const lock = lockFor(request.campaignId);
      if (request.expectedLockDigest !== undefined && hashV2Json(lock) !== request.expectedLockDigest) fail('unsupported', 'campaign capability lock digest is stale');
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
      if (authorizeCommandIntent({ member: clone(currentMember), entity: clone(currentRecord), command: clone(command), request: clone(payload) }) !== true) fail('unauthorized', 'command actor is not authorized');

      // A receipt is returned only after re-authenticating and checking current
      // entity visibility/ownership and, for workflows, current participants.
      // Do not apply the old expected revision/continuation to an exact retry:
      // the successful first attempt has already advanced them.
      const retry = projectCommandReceipt(request, payloadHash, currentMember, currentRecord);
      if (retry) { assertCurrentLock(request.campaignId, lock); assertAuthorityVersion(request.campaignId, authorityVersionAtStart); db.exec('COMMIT;'); return retry; }
      if (command.permission.noPendingContinuations && db.prepare("SELECT 1 FROM v2_extension_pending_commands WHERE campaign_id=? AND entity_id=? AND status='pending' LIMIT 1").get(request.campaignId, request.entityId)) fail('conflict', 'command is unavailable while a reaction continuation is pending');
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
      const randomness = drawResolverRandomness(resolver, currentMember, command, state, request.input);
      const result = executeResolver(immutableResolver, { operationId: request.operationId, campaignId: request.campaignId, principalId: request.principalId, logicalTime: now(), state, input: request.input, randomness }, lock);
      const output = result.transcript;
      if (output.continuation?.resumeOn === 'reaction') {
        if (!resolver.resume || request.workflow) fail('unsupported', 'reaction suspension requires a pinned resume resolver and cannot suspend a workflow transition');
        if (!reauthorizePendingActor) fail('unsupported', 'reaction suspension requires host-side original-actor reauthorization');
        if (output.effects.length) fail('invalid', 'a suspended command cannot propose effects before its reaction completes');
        const intent = output.continuation.reaction;
        const candidates = resolveReactionEligibility({ campaignId: request.campaignId, actorPrincipalId: currentMember.principalId, commandId: command.commandId, entityId: currentRecord.entityId, member: clone(currentMember), command: clone(command), entity: clone(currentRecord), input: clone(request.input), intent: clone(intent) });
        if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 100) fail('invalid', 'host did not resolve a bounded reaction audience');
        const eligibleByPrincipal = new Map();
        for (const candidate of candidates) {
          const audience = intent.audiences.find(item => item.audience === candidate.audience);
          if (!audience || !ID.test(candidate.principalId) || !Number.isInteger(candidate.priority) || candidate.priority !== audience.priority || !Array.isArray(candidate.actions) || candidate.actions.length !== audience.actions.length) fail('invalid', 'host reaction audience does not match module intent');
          const actions = audience.actions.map(declared => {
            const supplied = candidate.actions.find(item => item.actionId === declared.actionId);
            if (!supplied || canonicalV2Json(supplied.inputSchema) !== canonicalV2Json(declared.inputSchema) || supplied.visibility !== declared.visibility) fail('invalid', 'host reaction action does not match module declaration');
            validateV2SchemaDefinition(declared.inputSchema);
            return clone(declared);
          });
          const prior = eligibleByPrincipal.get(candidate.principalId) || { principalId: candidate.principalId, priority: audience.priority, actions: [] };
          prior.priority = Math.max(prior.priority, audience.priority);
          for (const item of actions) { const existing = prior.actions.find(value => value.actionId === item.actionId); if (existing && canonicalV2Json(existing) !== canonicalV2Json(item)) fail('invalid', 'duplicate reaction action declarations conflict'); if (!existing) prior.actions.push(item); }
          eligibleByPrincipal.set(candidate.principalId, prior);
        }
        const eligible = [...eligibleByPrincipal.values()];
        const windowId = createId(); if (!ID.test(windowId)) fail('invalid', 'host produced invalid reaction-window identity');
        const expectedRevisions = { ...(request.expectedRevisions || {}), [request.entityId]: request.expectedRevision };
        for (const [entityId, revision] of Object.entries(expectedRevisions)) if (!ID.test(entityId) || !Number.isInteger(revision) || revision < 1) fail('invalid', 'expected effect revisions are invalid');
        const privateContinuation = { continuation: clone(output.continuation), actorPrincipalId: currentMember.principalId };
        const window = { windowId, parentOperationId: request.operationId, campaignId: request.campaignId, resolver: clone(command.resolver), lock: clone(lock), eligible, ordering: intent.ordering, expiresAt: output.continuation.expiresAt, continuation: privateContinuation, visibility: intent.visibility };
        const pendingRequest = { ...payload };
        db.prepare('INSERT INTO v2_extension_pending_commands(operation_id,campaign_id,principal_id,command_id,entity_id,resolver,command_capability,lock,lock_digest,request,payload_hash,expected_revisions,continuation,suspension_transcript,window_id,authority_version,status,response,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(request.operationId, request.campaignId, currentMember.principalId, command.commandId, request.entityId, json(command.resolver), json(command.capability), json(lock), hashV2Json(lock), json(pendingRequest), payloadHash, json(expectedRevisions), json(output.continuation), json(output), windowId, authorityVersionAtStart, 'pending', null, now());
        reactionKernel.openInTransaction(window, currentMember.principalId, request.authorityToken);
        if (failureAt === 'after-pending-window') fail('injected', 'failure after pending reaction window');
        const resultData = output.outcomes.map(({ kind, data, visibility }) => ({ kind, data, visibility })); validateBoundedJson(resultData, command.resultSchema);
        const response = { operationId: request.operationId, status: 'pending', windowId, entityId: request.entityId, revision: currentRecord.revision, outcomes: visibleOutcomes(resultData, currentMember, currentRecord) };
        writeEvent(request, request.entityId, 'command.suspended', storedVisibility(currentRecord.visibility), { commandId: command.commandId, windowId, revision: currentRecord.revision, outcomes: resultData.filter(item => item.visibility === 'public'), transcriptDigest: output.digest, randomness: output.randomness.filter(item => item.visibility === 'public') });
        const storedResponse = { ...response, allOutcomes: resultData, suspensionTranscript: output };
        db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(storedResponse), now());
        if (failureAt === 'after-pending-receipt') fail('injected', 'failure after pending command receipt');
        assertCommandAuthority({ request, command, member: currentMember, entity: currentRecord, lock, participants: authorizedParticipants });
        assertCurrentLock(request.campaignId, lock); assertAuthorityVersion(request.campaignId, authorityVersionAtStart); db.exec('COMMIT;'); return response;
      }
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
        if (request.authorityToken !== undefined) effectProposal.authorityToken = request.authorityToken;
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
      const outcomes = visibleOutcomes(resultData, currentMember, currentRecord); const response = { operationId: request.operationId, status: 'applied', entityId: request.entityId, revision: refreshed.row.revision, outcomes, ...(workflowResult ? { workflow: workflowResult } : {}), ...(currentMember.role === 'gm' ? { resolutionTranscript: output } : {}) };
      writeEvent(request, request.entityId, workflowResult ? 'command.workflow-transitioned' : 'command.applied', storedVisibility(currentRecord.visibility), { commandId: command.commandId, revision: response.revision, workflow: workflowResult ? { workflowId: workflowResult.workflowId, state: workflowResult.state, revision: workflowResult.revision } : undefined, outcomes: resultData.filter(item => item.visibility === 'public'), transcriptDigest: output.digest, randomness: output.randomness.filter(item => item.visibility === 'public'), decisions: output.decisions.filter(item => item.visibility === 'public') });
      if (failureAt === 'after-command-event') fail('injected', 'failure after command event');
      if (failureAt === 'after-command-effects' && effectProposal) fail('injected', 'failure after command effects');
      const storedResponse = { ...response, allOutcomes: resultData, resolutionTranscript: output };
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, request.campaignId, request.principalId, payloadHash, json(storedResponse), now());
      assertCommandAuthority({ request, command, member: currentMember, entity: currentRecord, lock, participants: authorizedParticipants });
      assertAuthorityVersion(request.campaignId, authorityVersionAtStart);
      assertCurrentLock(request.campaignId, lock);
      if (failureAt === 'after-command-receipt') fail('injected', 'failure after command receipt');
      db.exec('COMMIT;'); return response;
    } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const hostReactionTransaction = (campaignId, work) => {
    if (db.isTransaction) fail('invalid', 'reaction command cannot be nested in another host transaction');
    db.exec('BEGIN IMMEDIATE;');
    try { const versionAtStart = campaignId ? authorityVersion(campaignId) : undefined; const result = work(); if (campaignId) assertAuthorityVersion(campaignId, versionAtStart); db.exec('COMMIT;'); return result; }
    catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; }
  };
  const reactionCampaign = windowId => db.prepare('SELECT campaign_id FROM v2_reaction_windows WHERE window_id=?').get(windowId)?.campaign_id;
  const submitReaction = (submission, authorityToken) => hostReactionTransaction(submission?.campaignId ?? reactionCampaign(submission?.windowId), () => { const result = reactionKernel.submitInTransaction(submission, authorityToken); if (failureAt === 'after-reaction-submission') fail('injected', 'failure after reaction submission'); return result; });
  const expireReaction = (windowId, principalId, authorityToken) => hostReactionTransaction(reactionCampaign(windowId), () => reactionKernel.expireInTransaction(windowId, principalId, authorityToken));
  const adjudicateReaction = (windowId, principalId, adjudication, authorityToken) => hostReactionTransaction(reactionCampaign(windowId), () => reactionKernel.adjudicateInTransaction(windowId, principalId, adjudication, authorityToken));
  const viewReaction = (windowId, principalId, authorityToken) => transaction(() => reactionKernel.view(windowId, principalId, authorityToken));
  const listReactions = (campaignId, principalId, authorityToken) => transaction(() => {
    const member = principal(principalId, campaignId, authorityToken); lockFor(campaignId);
    return db.prepare("SELECT window_id FROM v2_reaction_windows WHERE campaign_id=? AND status='pending' ORDER BY updated_at,window_id").all(campaignId).flatMap(({ window_id }) => {
      try { return [reactionKernel.view(window_id, member.principalId, authorityToken)]; }
      catch (error) { if (['unauthorized', 'unavailable'].includes(error?.code)) return []; throw error; }
    });
  });
  const declineReaction = (principalId, authorityToken, windowId, operationId, actionId, input) => submitReaction(principalId, authorityToken, { operationId, windowId, actionId, input, decision: 'decline' });
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
      if (workflow.campaignId !== request.campaignId && request.campaignId !== undefined) fail('unavailable', 'workflow is unavailable');
      const workflowAuthorityVersion = authorityVersion(workflow.campaignId);
      const member = principal(request.principalId, workflow.campaignId); const descriptor = workflowTypes.get(workflow.workflowType); const lock = lockFor(workflow.campaignId);
      if (!descriptor) fail('unsupported', 'workflow capability is unavailable'); validateStoredWorkflow(workflow, descriptor); assertTypePinned(workflow.campaignId, lock, descriptor);
      const { record } = readRecord(workflow.campaignId, workflow.entityId, member, lock, workflow.participants);
      if (!descriptor.expirationRoles.includes(member.role) || (member.role !== 'gm' && record.ownerPrincipalId !== member.principalId && !workflow.participants.includes(member.principalId))) fail('unauthorized', 'workflow expiry is not permitted');
      const payload = { ...request, campaignId: workflow.campaignId, principalId: member.principalId }; const payloadHash = hashV2Json(payload); const retry = receipt(payload, payloadHash);
      if (retry) { assertCurrentLock(workflow.campaignId, lock); assertAuthorityVersion(workflow.campaignId, workflowAuthorityVersion); db.exec('COMMIT;'); return retry; }
      if (workflow.revision !== request.expectedRevision || workflow.continuationId !== request.expectedContinuationId) fail('stale', 'workflow continuation is stale');
      if (workflow.status !== 'active' || descriptor.terminalStates.includes(workflow.state)) fail('conflict', 'workflow is not active');
      if (Date.parse(workflow.expiresAt) > Date.parse(now())) fail('conflict', 'workflow has not expired');
      const update = db.prepare("UPDATE v2_extension_workflows SET revision=revision+1,status='expired',updated_at=? WHERE workflow_id=? AND revision=? AND continuation_id=? AND status='active'").run(now(), workflow.workflowId, request.expectedRevision, request.expectedContinuationId); if (update.changes !== 1) fail('stale', 'workflow revision changed');
      const response = { operationId: request.operationId, status: 'expired', workflowId: workflow.workflowId, revision: request.expectedRevision + 1 };
      writeEvent(payload, workflow.entityId, 'workflow.expired', storedVisibility(record.visibility), { workflowId: workflow.workflowId, revision: request.expectedRevision + 1 });
      db.prepare('INSERT INTO v2_extension_receipts VALUES(?,?,?,?,?,?)').run(request.operationId, workflow.campaignId, member.principalId, payloadHash, json(response), now()); assertCurrentLock(workflow.campaignId, lock); assertAuthorityVersion(workflow.campaignId, workflowAuthorityVersion); db.exec('COMMIT;'); return response;
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
  return { createEntity, read, list, availableCommands, events, executeCommand, listReactions, viewReaction, submitReaction, declineReaction, expireReaction, adjudicateReaction, startWorkflow, readWorkflow, expireWorkflow, snapshot };
}
