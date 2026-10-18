import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createV2ExtensionKernel } from './v2-extensions.mjs';
import { starshipCommands, starshipEffectHandlers, starshipEntity, starshipRefs, starshipResolvers, starshipWorkflow } from '../../examples/example.starship/v2/extensions.mjs';

const campaignId = 'campaign-136';
const moduleRef = { id: 'example.starship.system', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
const allRefs = [moduleRef, ...Object.values(starshipRefs)];
const lock = { lockVersion: 1, campaignId, entries: allRefs.map(ref => ({ ...ref, source: 'bundled', optional: false })), rootModule: { id: moduleRef.id, version: moduleRef.implementationVersion, digest: moduleRef.digest } };
const data = () => ({ power: 40, safe: false, allocations: { propulsion: 0, lifeSupport: 0 }, engineeringLog: [] });
const make = ({ failureAt, currentLock = lock, requireTransactionalLockRead = false } = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'potomac-v2-extensions-')), 'host.sqlite');
  const db = new DatabaseSync(path);
  let time = '2026-10-17T12:00:00.000Z';
  let pinnedLock = currentLock;
  let lockReadHook;
  const roles = new Map([['gm-1', 'gm'], ['player-a', 'player'], ['player-b', 'player'], ['player-c', 'player']]);
  const effectHandlers = starshipEffectHandlers.map(handler => ({ ...handler, apply: context => { assert.equal(context.db, undefined); assert.equal(context.transaction, undefined); assert(Object.isFrozen(context.entity.data)); assert(Object.isFrozen(context.effect.payload)); return handler.apply(context); } }));
  const resolvers = starshipResolvers.map(resolver => ({ ...resolver, resolve: input => { assert.equal(input.db, undefined); assert.equal(input.transaction, undefined); assert(Object.isFrozen(input)); assert(Object.isFrozen(input.state.data)); return resolver.resolve(input); } }));
  const kernel = createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers, resolvers,
    authenticate: principalId => roles.has(principalId) ? { principalId, role: roles.get(principalId) } : undefined,
    getCampaignLock: id => {
      if (id !== campaignId) return undefined;
      if (requireTransactionalLockRead && !db.isTransaction) throw new Error('campaign lock was read outside the command transaction');
      lockReadHook?.(db);
      return pinnedLock;
    },
    validateLock: (id, value) => { if (id !== campaignId || value.campaignId !== id || value.lockVersion !== 1) throw new Error('lock mismatch'); },
    now: () => time, createId: () => 'continuation-1', failureAt
  });
  return { db, path, kernel, setTime: value => { time = value; }, getTime: () => time, setLock: value => { pinnedLock = value; }, getLock: () => pinnedLock, setLockReadHook: value => { lockReadHook = value; }, roles };
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
  assert.throws(() => createV2ExtensionKernel({ db, entities: [{ ...starshipEntity, fieldVisibility: [{ path: 'unlisted.secret', roles: ['gm'] }] }], commands: [], effectHandlers: [], resolvers: [], authenticate: () => undefined, getCampaignLock: () => lock, validateLock: () => undefined }), /not declared by the entity schema/);
  assert.throws(() => createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [{ ...starshipWorkflow, initialState: starshipWorkflow.terminalStates[0] }], effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers, authenticate: () => undefined, getCampaignLock: () => lock, validateLock: () => undefined }), /initial workflow state cannot be terminal/);
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
  const first = make(); create(first.kernel); const started = first.kernel.startWorkflow(workflowStart());
  assert.deepEqual(first.kernel.startWorkflow(workflowStart()), started, 'workflow-start retry is idempotent after current entity authorization');
  assert.throws(() => first.kernel.executeCommand(workflowCommand({ principalId: 'player-c' })), error => error.code === 'unavailable' || error.code === 'unauthorized');
  const inspected = first.kernel.executeCommand(workflowCommand());
  assert.equal(inspected.workflow.state, 'example.starship.engineering.isolated');
  assert.equal(inspected.workflow.revision, 2);
  assert.deepEqual(first.kernel.executeCommand(workflowCommand()), inspected, 'exact retry returns the stored receipt after current authorization');
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

test('reloads participants inside BEGIN IMMEDIATE and rejects retries after participant revocation', () => {
  const context = make({ requireTransactionalLockRead: true }); create(context.kernel); context.kernel.startWorkflow(workflowStart());
  context.setLockReadHook(db => {
    context.setLockReadHook(undefined);
    db.prepare('UPDATE v2_extension_workflows SET participants=? WHERE workflow_id=?').run(JSON.stringify(['player-a']), 'recovery-1');
  });
  assert.throws(() => context.kernel.executeCommand(workflowCommand()), error => error.code === 'unavailable');
  context.db.prepare('UPDATE v2_extension_workflows SET participants=? WHERE workflow_id=?').run(JSON.stringify(['player-b']), 'recovery-1');
  const applied = context.kernel.executeCommand(workflowCommand());
  assert.equal(applied.workflow.revision, 2);
  context.db.prepare('UPDATE v2_extension_workflows SET participants=? WHERE workflow_id=?').run(JSON.stringify(['player-a']), 'recovery-1');
  assert.throws(() => context.kernel.executeCommand(workflowCommand()), error => error.code === 'unavailable');
  context.db.close();
});

test('exact command retries recheck authentication and current entity ownership', () => {
  const context = make(); create(context.kernel);
  const commandId = 'example.starship.reactor.owner-command';
  const playerCommand = { ...starshipCommands[0], commandId, permission: { roles: ['player'], ownership: 'owner' } };
  const kernel = createV2ExtensionKernel({ db: context.db, entities: [starshipEntity], commands: [...starshipCommands, playerCommand], workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers,
    authenticate: id => context.roles.has(id) ? { principalId: id, role: context.roles.get(id) } : undefined,
    getCampaignLock: () => lock, validateLock: () => undefined });
  const request = { ...powerRequest({ principalId: 'player-a', commandId }), operationId: 'owner-retry' };
  const result = kernel.executeCommand(request);
  assert.deepEqual(kernel.executeCommand(request), result);
  context.roles.delete('player-a');
  assert.throws(() => kernel.executeCommand(request), error => error.code === 'unauthorized');
  context.roles.set('player-a', 'player');
  context.db.prepare('UPDATE v2_extension_entities SET owner_principal_id=? WHERE entity_id=?').run('player-c', 'reactor-1');
  assert.throws(() => kernel.executeCommand(request), error => error.code === 'unavailable' || error.code === 'unauthorized');
  context.db.close();
});

test('commits effect-free workflow transitions and rejects a replayed competing attempt', () => {
  const context = make(); create(context.kernel); context.kernel.startWorkflow(workflowStart());
  const applied = context.kernel.executeCommand(workflowCommand());
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events').get().count, 0);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_events WHERE kind=?').get('command.workflow-transitioned').count, 1);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('inspect-1').count, 1);
  assert.throws(() => context.kernel.executeCommand(workflowCommand({ operationId: 'competing-transition' })), error => error.code === 'stale');
  assert.deepEqual(context.kernel.executeCommand(workflowCommand()), applied);
  context.db.close();
});

test('serializes two concurrent attempts to advance one workflow continuation', async () => {
  const context = make(); create(context.kernel); context.kernel.startWorkflow(workflowStart()); context.db.close();
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT); const ready = new Int32Array(gate);
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const { createV2ExtensionKernel } = await import(workerData.kernelUrl);
      const starship = await import(workerData.exampleUrl);
      const db = new DatabaseSync(workerData.path); db.exec('PRAGMA busy_timeout=5000');
      const kernel = createV2ExtensionKernel({ db, entities: [starship.starshipEntity], commands: starship.starshipCommands, workflows: [starship.starshipWorkflow], effectHandlers: starship.starshipEffectHandlers, resolvers: starship.starshipResolvers,
        authenticate: principalId => ({ principalId, role: principalId === 'gm-1' ? 'gm' : 'player' }),
        getCampaignLock: () => workerData.lock, validateLock: () => undefined, now: () => '2026-10-17T12:00:00.000Z' });
      Atomics.add(new Int32Array(workerData.gate), 0, 1); Atomics.wait(new Int32Array(workerData.gate), 0, 1);
      try {
        kernel.executeCommand({ operationId: workerData.operationId, campaignId: workerData.campaignId, principalId: 'player-b', commandId: 'example.starship.engineering.inspect', entityId: 'reactor-1', expectedRevision: 1, input: { finding: 'Coupling is distorted' }, workflow: { workflowId: 'recovery-1', expectedRevision: 1, expectedContinuationId: 'continuation-1', transitionId: 'example.starship.engineering.inspect-step' } });
        parentPort.postMessage({ status: 'applied' });
      } catch (error) { parentPort.postMessage({ status: 'rejected', code: error.code || error.message }); }
      db.close();
    })().catch(error => parentPort.postMessage({ status: 'worker-error', message: error.message }));
  `;
  const start = operationId => new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { gate, path: context.path, campaignId, operationId, kernelUrl: new URL('./v2-extensions.mjs', import.meta.url).href, exampleUrl: new URL('../../examples/example.starship/v2/extensions.mjs', import.meta.url).href, lock } });
    worker.once('message', resolve); worker.once('error', reject);
  });
  const resultsPromise = Promise.all([start('concurrent-a'), start('concurrent-b')]);
  while (Atomics.load(ready, 0) < 2) await new Promise(resolve => setTimeout(resolve, 5));
  Atomics.store(ready, 0, 2); Atomics.notify(ready, 0, 2);
  const results = await resultsPromise;
  assert.equal(results.filter(result => result.status === 'applied').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.code === 'stale').length, 1);
  const db = new DatabaseSync(context.path);
  assert.equal(db.prepare('SELECT revision FROM v2_extension_workflows WHERE workflow_id=?').get('recovery-1').revision, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_extension_events WHERE kind=?').get('command.workflow-transitioned').count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts').get().count, 3);
  db.close();
});

test('rejects a campaign capability lock changed during resolver execution', () => {
  const context = make({ requireTransactionalLockRead: true }); create(context.kernel); context.kernel.startWorkflow(workflowStart());
  const resolvers = starshipResolvers.map(resolver => resolver.ref.id === starshipRefs.inspectResolver.id ? {
    ...resolver,
    resolve: input => {
      context.setLock({ ...lock, entries: lock.entries.filter(entry => entry.id !== starshipRefs.workflow.id) });
      return resolver.resolve(input);
    }
  } : resolver);
  const kernel = createV2ExtensionKernel({ db: context.db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers,
    authenticate: id => context.roles.has(id) ? { principalId: id, role: context.roles.get(id) } : undefined,
    getCampaignLock: id => {
      if (id !== campaignId) return undefined;
      if (!context.db.isTransaction) throw new Error('campaign lock was read outside the command transaction');
      return context.getLock();
    },
    validateLock: (id, value) => { if (id !== campaignId || value.campaignId !== id || value.lockVersion !== 1) throw new Error('lock mismatch'); }, now: context.getTime
  });
  assert.throws(() => kernel.executeCommand(workflowCommand()), error => error.code === 'unsupported');
  assert.equal(context.db.prepare('SELECT revision FROM v2_extension_workflows WHERE workflow_id=?').get('recovery-1').revision, 1);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('inspect-1').count, 0);
  context.db.close();
});

test('resolver receives a deeply immutable transaction snapshot', () => {
  const context = make(); create(context.kernel); context.kernel.startWorkflow(workflowStart());
  const resolvers = starshipResolvers.map(resolver => resolver.ref.id === starshipRefs.inspectResolver.id ? {
    ...resolver,
    resolve: input => { input.state.data.allocations.propulsion = 99; return resolver.resolve(input); }
  } : resolver);
  const kernel = createV2ExtensionKernel({ db: context.db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers,
    authenticate: id => context.roles.has(id) ? { principalId: id, role: context.roles.get(id) } : undefined,
    getCampaignLock: id => id === campaignId ? lock : undefined, validateLock: () => undefined, now: context.getTime });
  assert.throws(() => kernel.executeCommand(workflowCommand()), TypeError);
  assert.equal(context.db.prepare('SELECT data FROM v2_effect_entities WHERE entity_id=?').get('reactor-1').data.includes('99'), false);
  assert.equal(context.db.prepare('SELECT revision FROM v2_extension_workflows WHERE workflow_id=?').get('recovery-1').revision, 1);
  context.db.close();
});

test('rejects hidden nested data in events before it can enter public projections', () => {
  const context = make(); create(context.kernel);
  const source = starshipEffectHandlers[0];
  const eventSchema = { type: 'object', properties: {
    effectId: { type: 'string' }, subsystem: { type: 'string' }, allocated: { type: 'integer' },
    details: { type: 'object', properties: { visibility: { type: 'string' }, secret: { type: 'string' } }, required: ['visibility', 'secret'], additionalProperties: false }
  }, required: ['effectId', 'subsystem', 'allocated', 'details'], additionalProperties: false };
  const handlers = starshipEffectHandlers.map((handler, index) => index !== 0 ? handler : ({ ...handler, eventSchema,
    apply: input => {
      const next = source.apply(input);
      return { ...next, event: { ...next.event, payload: { ...next.event.payload, details: { visibility: 'gm', secret: 'not-for-players' } } } };
    }
  }));
  const kernel = createV2ExtensionKernel({ db: context.db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: handlers, resolvers: starshipResolvers,
    authenticate: id => context.roles.has(id) ? { principalId: id, role: context.roles.get(id) } : undefined,
    getCampaignLock: id => id === campaignId ? lock : undefined, validateLock: () => undefined });
  assert.throws(() => kernel.executeCommand(powerRequest()), /nested visibility/);
  assert.equal(context.db.prepare('SELECT revision FROM v2_effect_entities WHERE entity_id=?').get('reactor-1').revision, 1);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events').get().count, 0);
  context.db.close();
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
  const failedTransition = make({ failureAt: 'after-command-effects' }); create(failedTransition.kernel); failedTransition.kernel.startWorkflow(workflowStart());
  failedTransition.kernel.executeCommand(workflowCommand());
  assert.throws(() => failedTransition.kernel.executeCommand(stabilizeCommand()), /failure after command effects/);
  assert.equal(failedTransition.kernel.readWorkflow('recovery-1', 'player-a').revision, 2);
  failedTransition.db.close();

  for (const failureAt of ['after-workflow-transition', 'after-command-event', 'after-command-receipt']) {
    const laterFailure = make({ failureAt }); create(laterFailure.kernel); laterFailure.kernel.startWorkflow(workflowStart());
    assert.throws(() => laterFailure.kernel.executeCommand(workflowCommand()), /failure after/);
    assert.equal(laterFailure.kernel.readWorkflow('recovery-1', 'player-a').revision, 1);
    assert.equal(laterFailure.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_events WHERE kind=?').get('command.workflow-transitioned').count, 0);
    assert.equal(laterFailure.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('inspect-1').count, 0);
    laterFailure.db.close();
  }

  const afterAllWrites = make(); create(afterAllWrites.kernel); afterAllWrites.kernel.startWorkflow(workflowStart()); afterAllWrites.kernel.executeCommand(workflowCommand());
  const path = afterAllWrites.path; afterAllWrites.db.close();
  const db = new DatabaseSync(path);
  const failingKernel = createV2ExtensionKernel({ db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow], effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers,
    authenticate: id => afterAllWrites.roles.has(id) ? { principalId: id, role: afterAllWrites.roles.get(id) } : undefined,
    getCampaignLock: () => lock, validateLock: () => undefined, now: afterAllWrites.getTime, failureAt: 'after-command-receipt' });
  assert.throws(() => failingKernel.executeCommand(stabilizeCommand()), /failure after command receipt/);
  assert.equal(failingKernel.read(campaignId, 'reactor-1', 'player-a').revision, 1);
  assert.equal(failingKernel.readWorkflow('recovery-1', 'player-a').revision, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_effect_receipts WHERE operation_id=?').get('stabilize-1').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get('stabilize-1').count, 0);
  db.close();
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
  context.roles.set('gm-1', 'player');
  assert.throws(() => context.kernel.expireWorkflow(expiration), error => error.code === 'unauthorized' || error.code === 'unavailable');
  assert.throws(() => context.kernel.readWorkflow('recovery-1', 'player-c'), error => error.code === 'unavailable');
  context.db.close();
});

test('campaign-visible effect targets require current source command authority and a visible target', () => {
  const context = make();
  const actor = {
    ...starshipEntity,
    typeId: 'example.starship.combatant',
    ownership: { kind: 'principal' },
    visibility: ['owner'],
    schema: { ...starshipEntity.schema, properties: { ...starshipEntity.schema.properties, pilot: { type: 'string', minLength: 1 } }, required: [...starshipEntity.schema.required, 'pilot'] }
  };
  const target = { ...starshipEntity, typeId: 'example.starship.target', ownership: { kind: 'campaign' }, visibility: ['public'], migration: { ...starshipEntity.migration, migrationId: 'example.starship.target.v1-initial' } };
  const command = {
    ...starshipCommands[0],
    entityTypeId: actor.typeId,
    permission: { roles: ['player'], ownership: 'owner', effectTargetPolicy: 'campaign-visible' },
    inputSchema: { ...starshipCommands[0].inputSchema, properties: { ...starshipCommands[0].inputSchema.properties, targetId: { type: 'string', minLength: 1 } }, required: [...starshipCommands[0].inputSchema.required, 'targetId'] }
  };
  const effectHandlers = starshipEffectHandlers.map(handler => {
    if (handler.id !== starshipRefs.allocateEffect.id) return handler;
    return { ...handler, targetType: target.typeId, targetVisibility: 'public', eventVisibility: 'public', apply: context => { const result = handler.apply(context); return { ...result, event: { ...result.event, visibility: 'public' } }; } };
  });
  const resolvers = starshipResolvers.map(item => item.ref.id === starshipRefs.powerResolver.id ? {
    ...item,
    resolve: input => ({ outcomes: [], decisions: [], effects: [{ effectId: `${input.operationId}.allocate`, handler: starshipRefs.allocateEffect.id, targetId: input.input.targetId, payload: { subsystem: input.input.subsystem, amount: input.input.amount }, visibility: 'public' }] })
  } : item);
  const kernel = createV2ExtensionKernel({
    db: context.db, entities: [actor, target], commands: [command], effectHandlers, resolvers,
    authenticate: id => context.roles.has(id) ? { principalId: id, role: context.roles.get(id) } : undefined,
    getCampaignLock: () => lock, validateLock: () => undefined
  });
  kernel.createEntity({ operationId: 'pilot-a-create', campaignId, principalId: 'gm-1', entityId: 'reactor-1', typeId: actor.typeId, visibility: 'owner', ownerPrincipalId: 'player-a', data: { ...data(), pilot: 'player-a' } });
  kernel.createEntity({ operationId: 'target-create', campaignId, principalId: 'gm-1', entityId: 'reactor-2', typeId: target.typeId, visibility: 'public', data: data() });
  const request = { operationId: 'pilot-a-route', campaignId, principalId: 'player-a', commandId: command.commandId, entityId: 'reactor-1', expectedRevision: 1, expectedRevisions: { 'reactor-2': 1 }, input: { subsystem: 'propulsion', amount: 3, targetId: 'reactor-2' } };
  assert.equal(kernel.executeCommand(request).status, 'applied');
  assert.equal(kernel.read(campaignId, 'reactor-2', 'player-b').data.allocations.propulsion, 3);
  assert.throws(() => kernel.executeCommand({ ...request, operationId: 'pilot-b-route', principalId: 'player-b', expectedRevisions: { 'reactor-2': 2 } }), error => error.code === 'unavailable' || error.code === 'unauthorized');
  assert.equal(kernel.read(campaignId, 'reactor-2', 'player-b').revision, 2);
  context.db.close();
});
