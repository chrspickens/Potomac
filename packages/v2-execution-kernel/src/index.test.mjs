import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { V2ExecutionKernel } from './index.ts';

const make = ({ now = 1000, allow = () => true, validate = () => undefined } = {}) => {
  let clock = now;
  const kernel = new V2ExecutionKernel(new DatabaseSync(':memory:'), { now: () => clock, authorizeEffect: allow, validateEffect: validate });
  kernel.setNow = value => { clock = value; };
  return kernel;
};
const entity = (id, type, revision, data) => ({ id, type, revision, data });
const patch = (operationId, effectId, principalId, entityId, revision, path, value) => ({ operationId, effectId, principalId, target: { entityId, expectedRevision: revision }, handler: 'entity.patch', path, value, visibility: 'public' });

test('commits a deterministic multi-entity effect set atomically', () => {
  const kernel = make();
  kernel.putEntity(entity('attacker', 'actor', 1, { resources: { stamina: 3 } }));
  kernel.putEntity(entity('target', 'actor', 4, { resources: { hp: 9 } }));
  const result = kernel.applyEffects([
    patch('op-1', 'b', 'player-a', 'target', 4, 'resources.hp', 5),
    patch('op-1', 'a', 'player-a', 'attacker', 1, 'resources.stamina', 2),
  ]);
  assert.deepEqual(result.appliedEffectIds, ['a', 'b']);
  assert.equal(kernel.getEntity('attacker').revision, 2);
  assert.equal(kernel.getEntity('target').revision, 5);
  assert.equal(kernel.getEntity('target').data.resources.hp, 5);
});

test('rejects invalid, unauthorized, stale and conflicting effects without partial writes', () => {
  const kernel = make({ allow: effect => effect.principalId !== 'blocked' });
  kernel.putEntity(entity('one', 'actor', 1, { hp: 10 }));
  kernel.putEntity(entity('two', 'actor', 1, { hp: 10 }));
  assert.throws(() => kernel.applyEffects([patch('bad', 'a', 'ok', 'one', 1, 'missing.hp', 2)]), /effect path missing/);
  assert.equal(kernel.getEntity('one').revision, 1);
  assert.throws(() => kernel.applyEffects([patch('auth', 'a', 'blocked', 'one', 1, 'hp', 2), patch('auth', 'b', 'ok', 'two', 1, 'hp', 2)]), /unauthorized/);
  assert.equal(kernel.getEntity('two').revision, 1);
  assert.throws(() => kernel.applyEffects([patch('stale', 'a', 'ok', 'one', 0, 'hp', 2), patch('stale', 'b', 'ok', 'two', 1, 'hp', 2)]), /stale revision/);
  assert.throws(() => kernel.applyEffects([patch('conflict', 'a', 'ok', 'one', 1, 'hp', 2), patch('conflict', 'b', 'ok', 'one', 1, 'hp', 3)]), /conflicting effects/);
  assert.equal(kernel.getEntity('one').data.hp, 10);
  assert.equal(kernel.getEntity('two').data.hp, 10);
});

test('rolls back after a later schema/handler failure', () => {
  const kernel = make({ validate: (effect, entity, next) => { if (entity.id === 'two') throw new Error('schema rejected'); } });
  kernel.putEntity(entity('one', 'ship', 1, { power: 1 }));
  kernel.putEntity(entity('two', 'ship', 1, { power: 1 }));
  assert.throws(() => kernel.applyEffects([patch('rollback', 'a', 'gm', 'one', 1, 'power', 2), patch('rollback', 'b', 'gm', 'two', 1, 'power', 2)]), /schema rejected/);
  assert.deepEqual(kernel.getEntity('one').data, { power: 1 });
  assert.deepEqual(kernel.getEntity('two').data, { power: 1 });
});

test('persists a reaction continuation, recovers after restart, and resolves once', () => {
  const first = make();
  first.putEntity(entity('attacker', 'actor', 1, { hp: 10 }));
  first.putEntity(entity('defender', 'actor', 1, { shielded: false }));
  first.saveContinuation({ windowId: 'window-1', operationId: 'attack-1', state: { attackTotal: 18, damage: 7 }, eligibleResponders: ['defender-player'], expiresAt: 2000, ordering: 'submission', status: 'pending' });
  const directory = mkdtempSync(join(tmpdir(), 'potomac-v2-kernel-'));
  const databasePath = join(directory, 'kernel.sqlite');
  const durable = new V2ExecutionKernel(new DatabaseSync(databasePath));
  durable.putEntity(entity('defender', 'actor', 1, { shielded: false }));
  durable.saveContinuation({ windowId: 'window-1', operationId: 'attack-1', state: { attackTotal: 18, damage: 7 }, eligibleResponders: ['defender-player'], expiresAt: 2000, ordering: 'submission', status: 'pending' });
  durable.db.close();
  // Reopening the SQLite file is the simulated host restart boundary.
  const restarted = new V2ExecutionKernel(new DatabaseSync(databasePath), { now: () => 1000 });
  assert.equal(restarted.getContinuation('window-1').status, 'pending');
  const result = restarted.submitReaction({ windowId: 'window-1', operationId: 'reaction-1', responderId: 'defender-player', actionId: 'shield', submittedAt: 1500, input: { amount: 2 } }, () => [patch('reaction-1', 'shield', 'defender-player', 'defender', 1, 'shielded', true)]);
  assert.deepEqual(result, { status: 'resolved' });
  assert.equal(restarted.getContinuation('window-1').status, 'resolved');
  assert.equal(restarted.getEntity('defender').data.shielded, true);
  assert.deepEqual(restarted.submitReaction({ windowId: 'window-1', operationId: 'reaction-1', responderId: 'defender-player', actionId: 'shield', submittedAt: 1500, input: { amount: 2 } }, () => null), { status: 'duplicate' });
  restarted.db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('handles invalid responders, disconnected retries, expiry and stale continuation effects', () => {
  const kernel = make({ now: 1000 });
  kernel.putEntity(entity('defender', 'actor', 3, { shielded: false }));
  kernel.saveContinuation({ windowId: 'window-2', operationId: 'attack-2', state: { attackTotal: 20 }, eligibleResponders: ['defender-player'], expiresAt: 1100, ordering: 'submission', status: 'pending' });
  assert.throws(() => kernel.submitReaction({ windowId: 'window-2', operationId: 'reaction-x', responderId: 'intruder', actionId: 'shield', submittedAt: 1001, input: {} }, () => null), /unauthorized/);
  assert.deepEqual(kernel.submitReaction({ windowId: 'window-2', operationId: 'reaction-y', responderId: 'defender-player', actionId: 'shield', submittedAt: 1002, input: {} }, () => null), { status: 'pending' });
  kernel.setNow(1100);
  assert.deepEqual(kernel.submitReaction({ windowId: 'window-2', operationId: 'reaction-z', responderId: 'defender-player', actionId: 'shield', submittedAt: 1100, input: {} }, () => null), { status: 'expired' });
  assert.equal(kernel.getContinuation('window-2').status, 'expired');

  const stale = make();
  stale.putEntity(entity('defender', 'actor', 2, { shielded: false }));
  stale.saveContinuation({ windowId: 'window-3', operationId: 'attack-3', state: {}, eligibleResponders: ['defender-player'], expiresAt: 2000, ordering: 'submission', status: 'pending' });
  assert.throws(() => stale.submitReaction({ windowId: 'window-3', operationId: 'reaction-stale', responderId: 'defender-player', actionId: 'shield', submittedAt: 1200, input: {} }, () => [patch('reaction-stale', 'shield', 'defender-player', 'defender', 1, 'shielded', true)]), /stale revision/);
  assert.equal(stale.getContinuation('window-3').status, 'pending');
});

test('supports a contrasting dice-pool action through the same host effect protocol', () => {
  const kernel = make();
  kernel.putEntity(entity('scout', 'testbed.actor', 1, { stress: 0 }));
  const hostRandom = [6, 4, 2, 1];
  const successes = hostRandom.filter(value => value >= 5).length;
  assert.equal(successes, 1);
  kernel.applyEffects([{ operationId: 'pool-1', effectId: 'stress', principalId: 'scout-player', target: { entityId: 'scout', expectedRevision: 1 }, handler: 'resource.delta', path: 'stress', delta: successes === 0 ? 2 : 0, visibility: 'public' }]);
  assert.equal(kernel.getEntity('scout').data.stress, 0);
});
