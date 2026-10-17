import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV2EffectKernel } from './v2-effects.mjs';

const digest = value => `sha256:${Buffer.from(String(value)).toString('hex').padEnd(64, '0').slice(0, 64)}`;
const ref = { id: 'example.resource-delta', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: digest('handler') };
const lock = { lockVersion: 1, campaignId: 'campaign-1', entries: [{ id: ref.id, apiVersion: ref.apiVersion, implementationVersion: ref.implementationVersion, digest: ref.digest, source: 'bundled', optional: false }], rootModule: { id: ref.id, version: ref.implementationVersion, digest: ref.digest } };
const proposal = (overrides = {}) => ({ operationId: 'op-1', campaignId: 'campaign-1', principalId: 'gm-1', moduleId: 'module.rules', lock, effects: [{ effectId: 'effect-1', handler: ref, target: { entityId: 'actor-a', expectedRevision: 1, visibility: 'public' }, payload: { amount: 2 }, visibility: 'public' }], ...overrides });
const make = ({ failureAt, authorize = () => true, authenticate = principalId => principalId === 'gm-1', handlerVisibility = 'public' } = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'potomac-v2-effects-')), 'host.sqlite'); const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS campaign (id TEXT PRIMARY KEY); INSERT INTO campaign VALUES (\'campaign-1\');');
  const handler = { ...ref, atomic: true, conflict: 'reject-overlap', targetType: 'actor', targetVisibility: handlerVisibility, payloadSchema: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false }, eventKind: 'resource.changed', eventVisibility: handlerVisibility, eventSchema: { type: 'object', required: ['effectId', 'score'], properties: { effectId: { type: 'string' }, score: { type: 'integer' } }, additionalProperties: false }, apply: ({ entity, effect }) => ({ data: { ...entity.data, score: entity.data.score + effect.payload.amount }, revision: entity.revision + 1, event: { kind: 'resource.changed', visibility: handlerVisibility, payload: { effectId: effect.effectId, score: entity.data.score + effect.payload.amount } } }) };
  const kernel = createV2EffectKernel({ db, handlers: [handler], authenticate, authorize: context => authorize({ ...context, canReadTarget: context.entity?.visibility === 'public' }), failureAt, validateLock: (campaignId, value) => { if (campaignId !== value.campaignId || value.rootModule.id !== ref.id) throw new Error('lock mismatch'); } });
  db.prepare('INSERT INTO v2_effect_entities(campaign_id,entity_id,entity_type,revision,visibility,data) VALUES(?,?,?,?,?,?)').run('campaign-1', 'actor-a', 'actor', 1, 'public', JSON.stringify({ score: 3 }));
  return { db, kernel, path, handler };
};

test('commits multi-entity effects, events and receipt atomically in deterministic order', () => {
  const { db, kernel } = make();
  db.prepare('INSERT INTO v2_effect_entities VALUES(?,?,?,?,?,?)').run('campaign-1', 'actor-b', 'actor', 1, 'public', JSON.stringify({ score: 4 }));
  const second = { effectId: 'effect-2', handler: ref, target: { entityId: 'actor-b', expectedRevision: 1, visibility: 'public' }, payload: { amount: 1 }, visibility: 'public' };
  const receipt = kernel.apply(proposal({ effects: [second, proposal().effects[0]] }));
  assert.deepEqual(receipt.eventIds, ['op-1:effect-1', 'op-1:effect-2']);
  assert.equal(db.prepare('SELECT revision FROM v2_effect_entities WHERE entity_id=?').get('actor-a').revision, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events').get().count, 2);
});

test('rejects unauthorized, hidden and stale targets before mutation', () => {
  assert.throws(() => make({ authorize: () => false }).kernel.apply(proposal()), /unauthorized/);
  const hidden = make(); hidden.db.prepare('UPDATE v2_effect_entities SET visibility=\'private\' WHERE entity_id=\'actor-a\'').run();
  assert.throws(() => hidden.kernel.apply(proposal()), /revision or visibility/);
  const stale = make(); assert.throws(() => stale.kernel.apply(proposal({ effects: [{ ...proposal().effects[0], target: { ...proposal().effects[0].target, expectedRevision: 2 } }] })), /revision/);
});

test('binds retries to canonical payload identity and rejects altered reuse', () => {
  const { db, kernel, handler } = make(); const first = kernel.apply(proposal()); assert.deepEqual(kernel.apply({ ...proposal(), effects: [{ ...proposal().effects[0], payload: { amount: 2 } }] }), first);
  assert.throws(() => kernel.apply({ ...proposal(), effects: [{ ...proposal().effects[0], payload: { amount: 3 } }] }), /different campaign, principal or proposal/);
  const unauthenticatedRetry = createV2EffectKernel({ db, handlers: [handler], authenticate: () => false, authorize: () => true, validateLock: () => undefined });
  assert.throws(() => unauthenticatedRetry.apply(proposal()), /unauthenticated/);
});

test('rolls back after effect and receipt failure injection, including restart visibility', () => {
  const afterEffect = make({ failureAt: 'after-effect' }); assert.throws(() => afterEffect.kernel.apply(proposal()), /failure after effect/); assert.equal(afterEffect.db.prepare('SELECT revision FROM v2_effect_entities WHERE entity_id=\'actor-a\'').get().revision, 1); assert.equal(afterEffect.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_receipts').get().count, 0);
  const afterReceipt = make({ failureAt: 'after-receipt' }); assert.throws(() => afterReceipt.kernel.apply(proposal()), /failure after receipt/); assert.equal(afterReceipt.db.prepare('SELECT revision FROM v2_effect_entities WHERE entity_id=\'actor-a\'').get().revision, 1); afterReceipt.db.close(); const reopened = new DatabaseSync(afterReceipt.path); assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM v2_effect_receipts').get().count, 0); reopened.close();
});

test('rejects overlapping targets, bad schemas and keeps hidden events out of public results', () => {
  const { kernel } = make(); const overlap = proposal({ effects: [proposal().effects[0], { ...proposal().effects[0], effectId: 'effect-2' }] }); assert.throws(() => kernel.apply(overlap), /overlapping/);
  assert.throws(() => kernel.apply(proposal({ effects: [{ ...proposal().effects[0], payload: { amount: 99 } }] })), /out of range/);
  const hiddenKernel = make({ handlerVisibility: 'private' }); const hidden = hiddenKernel.kernel.apply(proposal({ operationId: 'private-op', effects: [{ ...proposal().effects[0], visibility: 'private', target: { ...proposal().effects[0].target, visibility: 'private' } }] }));
  assert.equal(hidden.eventIds.length, 0); assert.equal(hiddenKernel.kernel.publicEvents('campaign-1', 'private-op').length, 0); assert.equal(hiddenKernel.kernel.readReceipt('private-op').response.includes('score'), false);
});

test('rejects wrong target types, handler database access assumptions and unsupported schema keywords', () => {
  const wrongType = make(); wrongType.db.prepare("UPDATE v2_effect_entities SET entity_type='lore' WHERE entity_id='actor-a'").run(); assert.throws(() => wrongType.kernel.apply(proposal()), /target type/);
  const malicious = make(); malicious.handler.apply = context => { assert.equal(context.db, undefined); return { data: { ...context.entity.data, score: 4 }, revision: 2, event: { kind: 'resource.changed', visibility: 'public', payload: { effectId: 'effect-1', score: 4 } } }; assert.fail('unreachable'); }; assert.doesNotThrow(() => malicious.kernel.apply(proposal()));
  const unsupported = make(); unsupported.handler.payloadSchema = { type: 'object', additionalProperties: false, properties: {}, patternProperties: {} }; assert.throws(() => unsupported.kernel.apply(proposal()), /unsupported schema keyword/);
});
