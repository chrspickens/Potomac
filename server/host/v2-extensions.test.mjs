import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV2ExtensionKernel } from './v2-extensions.mjs';
import { starshipCommands, starshipEffectHandlers, starshipEntity, starshipRefs, starshipResolvers, starshipWorkflow } from '../../examples/example.starship/v2/extensions.mjs';

const campaignId = 'campaign-136';
const moduleRef = { id: 'example.starship.system', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
const allRefs = [moduleRef, ...Object.values(starshipRefs)];
const lock = { lockVersion: 1, campaignId, entries: allRefs.map(ref => ({ ...ref, source: 'bundled', optional: false })), rootModule: { id: moduleRef.id, version: moduleRef.implementationVersion, digest: moduleRef.digest } };
const data = () => ({ power: 40, safe: false, allocations: { propulsion: 0, lifeSupport: 0 }, engineeringLog: [] });
const make = ({ failureAt, currentLock = lock } = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'potomac-v2-extensions-')), 'host.sqlite');
  const db = new DatabaseSync(path);
  let time = '2026-10-17T12:00:00.000Z';
  let pinnedLock = currentLock;
  const roles = new Map([['gm-1', 'gm'], ['player-a', 'player'], ['player-b', 'player'], ['player-c', 'player']]);
  const effectHandlers = starshipEffectHandlers.map(handler => ({ ...handler, apply: context => { assert.equal(context.db, undefined); assert.equal(context.transaction, undefined); return handler.apply(context); } }));
  const resolvers = starshipResolvers.map(resolver => ({ ...resolver, resolve: input => { assert.equal(input.db, undefined); assert.equal(input.transaction, undefined); return resolver.resolve(input); } }));
  const kernel = createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers, resolvers,
    authenticate: principalId => roles.has(principalId) ? { principalId, role: roles.get(principalId) } : undefined,
    getCampaignLock: id => id === campaignId ? pinnedLock : undefined,
    validateLock: (id, value) => { if (id !== campaignId || value.campaignId !== id || value.lockVersion !== 1) throw new Error('lock mismatch'); },
    now: () => time, createId: () => 'continuation-1', failureAt
  });
  return { db, path, kernel, setTime: value => { time = value; }, setLock: value => { pinnedLock = value; }, roles };
};
const create = (kernel, overrides = {}) => kernel.createEntity({ operationId: 'create-reactor', campaignId, principalId: 'gm-1', entityId: 'reactor-1', typeId: starshipEntity.typeId, visibility: 'owner', ownerPrincipalId: 'player-a', data: data(), ...overrides });
const powerRequest = (overrides = {}) => ({ operationId: 'route-1', campaignId, principalId: 'gm-1', commandId: 'example.starship.reactor.allocate-power', entityId: 'reactor-1', expectedRevision: 1, input: { subsystem: 'propulsion', amount: 7 }, ...overrides });
const workflowStart = (overrides = {}) => ({ operationId: 'workflow-start', campaignId, principalId: 'gm-1', workflowId: 'recovery-1', workflowType: starshipWorkflow.workflowType, entityId: 'reactor-1', expectedEntityRevision: 1, stateData: {}, participants: ['player-b'], expiresAt: '2026-10-17T13:00:00.000Z', ...overrides });
const workflowCommand = (overrides = {}) => ({ operationId: 'inspect-1', campaignId, principalId: 'player-b', commandId: 'example.starship.engineering.inspect', entityId: 'reactor-1', expectedRevision: 1, input: { finding: 'Conduit coupling is warped' }, workflow: { workflowId: 'recovery-1', expectedRevision: 1, expectedContinuationId: 'continuation-1', transitionId: 'example.starship.engineering.inspect-step' }, ...overrides });
const stabilizeCommand = (overrides = {}) => ({ operationId: 'stabilize-1', campaignId, principalId: 'player-b', commandId: 'example.starship.engineering.stabilize', entityId: 'reactor-1', expectedRevision: 1, input: { tool: 'ceramic bypass' }, workflow: { workflowId: 'recovery-1', expectedRevision: 2, expectedContinuationId: 'inspect-1.inspection', transitionId: 'example.starship.engineering.stabilize-step' }, ...overrides });

test('stores versioned entities, applies a host-authorized power command and filters private data', () => {
  const { db, kernel } = make(); create(kernel);
  assert.equal(kernel.read(campaignId, 'reactor-1', 'player-a').schemaVersion, 1);
  assert.throws(() => kernel.read(campaignId, 'reactor-1', 'player-b'), error => error.code === 'unavailable');
  assert.deepEqual(kernel.list(campaignId, starshipEntity.typeId, 'player-b'), []);
  assert.throws(() => kernel.executeCommand(powerRequest({ principalId: 'player-a' })), error => error.code === 'unauthorized');
  const result = kernel.executeCommand(powerRequest());
  assert.equal(result.revision, 2);
  assert.equal(kernel.read(campaignId, 'reactor-1', 'player-a').data.allocations.propulsion, 7);
  assert.equal(db.prepare('SELECT revision FROM v2_effect_entities WHERE entity_id=?').get('reactor-1').revision, 2);
  assert.equal(kernel.events(campaignId, 'player-b').length, 0);
  assert.equal(kernel.events(campaignId, 'player-a').length, 2);
  db.close();
});

test('validates descriptors and entity data against the supported schema dialect', () => {
  const { db } = make();
  assert.throws(() => createV2ExtensionKernel({ db, entities: [{ ...starshipEntity, schema: { type: 'object', properties: {}, patternProperties: {} } }], commands: [], effectHandlers: [], resolvers: [], authenticate: () => undefined, getCampaignLock: () => lock, validateLock: () => undefined }), /unsupported schema keyword/);
  const kernel = createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers, authenticate: id => ({ principalId: id, role: id === 'gm-1' ? 'gm' : 'player' }), getCampaignLock: () => lock, validateLock: () => undefined });
  assert.throws(() => create(kernel, { data: { ...data(), power: 'many' } }), error => error.code === 'invalid');
  db.close();
});

test('rejects stale revisions and changed-payload retries while exact retries remain idempotent', () => {
  const { db, kernel } = make(); create(kernel);
  const first = kernel.executeCommand(powerRequest());
  assert.deepEqual(kernel.executeCommand(powerRequest()), first);
  assert.throws(() => kernel.executeCommand(powerRequest({ input: { subsystem: 'propulsion', amount: 8 } })), error => error.code === 'idempotency_conflict');
  assert.throws(() => kernel.executeCommand(powerRequest({ operationId: 'route-2' })), error => error.code === 'stale');
  db.close();
});

test('uses typed serialized workflow states, participant authorization, restart recovery and cancellation', () => {
  const first = make(); create(first.kernel); first.kernel.startWorkflow(workflowStart());
  assert.throws(() => first.kernel.executeCommand(workflowCommand({ principalId: 'player-c' })), error => error.code === 'unavailable' || error.code === 'unauthorized');
  const inspected = first.kernel.executeCommand(workflowCommand());
  assert.equal(inspected.workflow.state, 'example.starship.engineering.isolated');
  assert.equal(inspected.workflow.revision, 2);
  assert.deepEqual(first.kernel.readWorkflow('recovery-1', 'player-a').stateData, { finding: 'Conduit coupling is warped' });
  assert.throws(() => first.kernel.executeCommand(workflowCommand({ input: { finding: 'Changed retry payload' } })), error => error.code === 'idempotency_conflict');
  assert.throws(() => first.kernel.executeCommand(workflowCommand({ operationId: 'bad-transition', workflow: { ...workflowCommand().workflow, transitionId: 'example.starship.engineering.stabilize-step' } })), error => error.code === 'conflict' || error.code === 'stale');
  const snapshot = JSON.parse(JSON.stringify(first.kernel.snapshot(campaignId)));
  assert.equal(snapshot.data.v2_extension_workflows[0].continuation_id, 'inspect-1.inspection');
  const dbPath = first.path; first.db.close();
  const reopenedDb = new DatabaseSync(dbPath);
  const reopened = createV2ExtensionKernel({ db: reopenedDb, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers, authenticate: id => ({ principalId: id, role: id === 'gm-1' ? 'gm' : 'player' }), getCampaignLock: () => lock, validateLock: () => undefined, now: () => '2026-10-17T12:01:00.000Z' });
  assert.equal(reopened.readWorkflow('recovery-1', 'player-b').state, 'example.starship.engineering.isolated');
  const aborted = reopened.executeCommand({ operationId: 'cancel-1', campaignId, principalId: 'player-b', commandId: 'example.starship.engineering.cancel', entityId: 'reactor-1', expectedRevision: 1, input: {}, workflow: { workflowId: 'recovery-1', expectedRevision: 2, expectedContinuationId: 'inspect-1.inspection', transitionId: 'example.starship.engineering.cancel-step' } });
  assert.equal(aborted.workflow.status, 'cancelled');
  assert.throws(() => reopened.executeCommand({ operationId: 'cancel-again', campaignId, principalId: 'player-b', commandId: 'example.starship.engineering.cancel', entityId: 'reactor-1', expectedRevision: 1, input: {}, workflow: { workflowId: 'recovery-1', expectedRevision: 3, expectedContinuationId: aborted.workflow.continuationId, transitionId: 'example.starship.engineering.cancel-step' } }), error => error.code === 'unavailable');
  reopenedDb.close();
});

test('commits effects, workflow state, event and receipt together at failure boundaries', () => {
  const failed = make({ failureAt: 'after-command-effects' }); create(failed.kernel); const start = workflowStart(); failed.kernel.startWorkflow(start);
  failed.kernel.executeCommand(workflowCommand());
  assert.throws(() => failed.kernel.executeCommand(stabilizeCommand()), /failure after command effects/);
  assert.equal(failed.kernel.read(campaignId, 'reactor-1', 'player-a').revision, 1);
  assert.equal(failed.kernel.readWorkflow('recovery-1', 'player-a').revision, 2);
  assert.equal(failed.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events').get().count, 0);
  assert.equal(failed.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('stabilize-1').count, 0);
  failed.db.close();
  const failedTransition = make({ failureAt: 'after-workflow-transition' }); create(failedTransition.kernel); failedTransition.kernel.startWorkflow(workflowStart());
  failedTransition.kernel.executeCommand(workflowCommand());
  assert.throws(() => failedTransition.kernel.executeCommand(stabilizeCommand()), /failure after workflow transition/);
  assert.equal(failedTransition.kernel.readWorkflow('recovery-1', 'player-a').revision, 2);
  failedTransition.db.close();
});

test('rejects conflicting effects and missing exact capability locks fail closed', () => {
  const { db, kernel } = make(); create(kernel);
  const conflictingResolvers = starshipResolvers.map(resolver => resolver.ref.id === starshipRefs.powerResolver.id ? { ...resolver, resolve: input => {
    const effect = { effectId: 'effect-a', handler: starshipRefs.allocateEffect.id, targetId: input.state.entityId, payload: { subsystem: input.input.subsystem, amount: input.input.amount }, visibility: 'private' };
    return { outcomes: [], decisions: [], effects: [effect, { ...effect, effectId: 'effect-b' }] };
  } } : resolver);
  const conflict = createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers: conflictingResolvers, authenticate: id => ({ principalId: id, role: id === 'gm-1' ? 'gm' : 'player' }), getCampaignLock: () => lock, validateLock: () => undefined });
  assert.throws(() => conflict.executeCommand(powerRequest()), error => error.code === 'conflict');
  assert.equal(conflict.read(campaignId, 'reactor-1', 'player-a').revision, 1);
  const noCapability = make(); create(noCapability.kernel); noCapability.setLock({ ...lock, entries: lock.entries.filter(entry => entry.id !== starshipRefs.entity.id) });
  assert.throws(() => noCapability.kernel.read(campaignId, 'reactor-1', 'player-a'), error => error.code === 'unsupported');
  db.close(); noCapability.db.close();
});

test('rechecks declared authorization for every effect target inside the transaction', () => {
  const context = make(); create(context.kernel); create(context.kernel, { operationId: 'create-reactor-b', entityId: 'reactor-b', ownerPrincipalId: 'player-b' });
  const commandId = 'example.starship.reactor.transfer-power';
  const transferCommand = { ...starshipCommands[0], commandId, permission: { roles: ['player'], ownership: 'owner' }, inputSchema: { type: 'object', properties: { subsystem: { type: 'string', enum: ['propulsion'] }, amount: { type: 'integer', minimum: 1 }, targetId: { type: 'string' } }, required: ['subsystem', 'amount', 'targetId'], additionalProperties: false } };
  const resolvers = starshipResolvers.map(resolver => resolver.ref.id === starshipRefs.powerResolver.id ? { ...resolver, resolve: input => ({ outcomes: [], decisions: [], effects: [{ effectId: `${input.operationId}.transfer`, handler: starshipRefs.allocateEffect.id, targetId: input.input.targetId, payload: { subsystem: input.input.subsystem, amount: input.input.amount }, visibility: 'private' }] }) } : resolver);
  const kernel = createV2ExtensionKernel({ db: context.db, entities: [starshipEntity], commands: [...starshipCommands, transferCommand], workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers, authenticate: id => ({ principalId: id, role: id === 'gm-1' ? 'gm' : 'player' }), getCampaignLock: () => lock, validateLock: () => undefined });
  assert.throws(() => kernel.executeCommand({ operationId: 'transfer-denied', campaignId, principalId: 'player-a', commandId, entityId: 'reactor-1', expectedRevision: 1, expectedRevisions: { 'reactor-b': 1 }, input: { subsystem: 'propulsion', amount: 3, targetId: 'reactor-b' } }), error => error.code === 'unauthorized');
  assert.equal(kernel.read(campaignId, 'reactor-b', 'player-b').revision, 1);
  context.db.close();
});

test('expires workflow with host time and preserves private serialized state', () => {
  const context = make(); create(context.kernel); context.kernel.startWorkflow(workflowStart()); context.setTime('2026-10-17T13:01:00.000Z');
  const expiration = { operationId: 'expire-1', workflowId: 'recovery-1', principalId: 'gm-1', expectedRevision: 1, expectedContinuationId: 'continuation-1' };
  const result = context.kernel.expireWorkflow(expiration);
  assert.equal(result.status, 'expired');
  assert.deepEqual(context.kernel.expireWorkflow(expiration), result);
  assert.throws(() => context.kernel.readWorkflow('recovery-1', 'player-c'), error => error.code === 'unavailable');
  context.db.close();
});
