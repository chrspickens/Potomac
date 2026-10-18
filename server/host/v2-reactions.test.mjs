import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV2ReactionKernel } from './v2-reactions.mjs';

const digest = value => `sha256:${Buffer.from(String(value)).toString('hex').padEnd(64, '0').slice(0, 64)}`;
const resolver = { id: 'example.defense', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: digest('resolver') };
const lock = { lockVersion: 1, campaignId: 'campaign-1', entries: [{ id: resolver.id, apiVersion: resolver.apiVersion, implementationVersion: resolver.implementationVersion, digest: resolver.digest, source: 'bundled', optional: false }], rootModule: { id: resolver.id, version: resolver.implementationVersion, digest: resolver.digest } };
const action = (id, visibility = 'public') => ({ actionId: id, inputSchema: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'], additionalProperties: false }, visibility });
const windowFor = (overrides = {}) => ({ windowId: 'window-1', parentOperationId: 'attack-1', campaignId: 'campaign-1', resolver, lock, eligible: [{ principalId: 'player-a', priority: 10, actions: [action('shield')] }, { principalId: 'player-b', priority: 10, actions: [action('dodge')] }], ordering: 'simultaneous', expiresAt: '2026-10-18T00:00:00.000Z', continuation: { step: 1, hidden: 'gm-only' }, visibility: 'public', ...overrides });
const make = ({ ordering = 'simultaneous', failureAt, authenticate = () => true, authorizeResponder = () => true, authorizeGm = () => true, validateLock = (campaignId, value) => { if (campaignId !== value.campaignId || value.rootModule.id !== resolver.id) throw new Error('lock mismatch'); } } = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'potomac-v2-reactions-')), 'host.sqlite'); const db = new DatabaseSync(path); let clock = '2026-10-17T00:00:00.000Z';
  const kernel = createV2ReactionKernel({ db, authenticate, authorizeResponder, authorizeGm, authorizeView: ({ principalId, window }) => ({ role: principalId === 'gm-1' ? 'gm' : window.eligible.some(item => item.principalId === principalId) ? 'responder' : window.visibility === 'public' ? 'public' : null }), authorizeExpiry: ({ principalId }) => principalId === 'gm-1', validateLock, validateInput: (input, schema) => { if (!input || typeof input.choice !== 'string' || !schema.required.includes('choice')) throw new Error('invalid action input'); }, now: () => clock, failureAt, complete: ({ decisions }) => ({ effects: decisions.some(decision => decision.decision === 'accept') ? [{ effectId: 'defense-effect', visibility: 'public' }] : [] }), applyEffects: (effects, context) => { assert.equal(Object.hasOwn(context, 'db'), false, 'reaction completion callbacks are not handed the database'); db.exec('CREATE TABLE IF NOT EXISTS reaction_effects(effect_id TEXT PRIMARY KEY, payload TEXT NOT NULL)'); for (const effect of effects) db.prepare('INSERT INTO reaction_effects VALUES(?,?)').run(effect.effectId, JSON.stringify(effect)); }, });
  return { db, kernel, path, setTime: value => { clock = value; } };
};

test('persists windows, accepts simultaneous responders deterministically, and restores after restart', () => {
  const first = make(); first.kernel.open(windowFor(), 'gm-1'); first.kernel.submit({ operationId: 'submit-a', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'protect' }, decision: 'accept' });
  assert.equal(first.kernel.view('window-1', 'player-a').status, 'pending');
  const reopened = new DatabaseSync(first.path); const restored = createV2ReactionKernel({ db: reopened, authenticate: () => true, authorizeResponder: () => true, authorizeGm: () => true, authorizeView: () => ({ role: 'gm' }), authorizeExpiry: () => true, validateLock: () => undefined, validateInput: () => undefined, now: () => '2026-10-17T00:00:00.000Z', complete: ({ decisions }) => ({ effects: decisions.length ? [{ effectId: 'defense-effect' }] : [] }), applyEffects: effects => { reopened.exec('CREATE TABLE IF NOT EXISTS reaction_effects(effect_id TEXT PRIMARY KEY)'); for (const effect of effects) reopened.prepare('INSERT INTO reaction_effects VALUES(?)').run(effect.effectId); } });
  assert.equal(restored.view('window-1', 'gm-1').status, 'pending');
  const result = restored.submit({ operationId: 'submit-b', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'evade' }, decision: 'accept' }); assert.equal(result.status, 'resolved'); assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM reaction_effects').get().count, 1);
});

test('uses deterministic priority and submission tie-breaking, explicit decline and expiry', () => {
  const priority = make({ ordering: 'priorityThenSubmission' }); priority.kernel.open(windowFor({ ordering: 'priorityThenSubmission' }), 'gm-1'); const result = priority.kernel.submit({ operationId: 'priority-1', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'evade' }, decision: 'accept' }); assert.equal(result.status, 'resolved');
  const declined = make(); declined.kernel.open(windowFor({ windowId: 'window-decline' }), 'gm-1'); assert.equal(declined.kernel.submit({ operationId: 'decline-1', windowId: 'window-decline', principalId: 'player-a', actionId: 'shield', input: { choice: 'no' }, decision: 'decline' }).status, 'pending');
  const expired = make(); expired.kernel.open(windowFor({ windowId: 'window-expired' }), 'gm-1'); expired.setTime('2026-10-19T00:00:00.000Z'); assert.equal(expired.kernel.expire('window-expired', 'gm-1').status, 'expired');
});

test('rejects unauthorized responders/GM, invalid actions, stale retries and hides private choices', () => {
  const denied = make({ authenticate: () => false }); assert.throws(() => denied.kernel.submit({ operationId: 'denied', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /unauthenticated/);
  const unauthorized = make({ authorizeResponder: () => false }); unauthorized.kernel.open(windowFor(), 'gm-1'); assert.throws(() => unauthorized.kernel.submit({ operationId: 'denied-2', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /not eligible/);
  const hidden = make({ authorizeGm: ({ principalId }) => principalId === 'gm-1' }); hidden.kernel.open(windowFor({ windowId: 'hidden-window', visibility: 'private', eligible: [{ principalId: 'player-a', priority: 1, actions: [action('secret', 'private')] }, { principalId: 'player-b', priority: 1, actions: [action('dodge', 'private')] }] }), 'gm-1'); hidden.kernel.submit({ operationId: 'hidden-1', windowId: 'hidden-window', principalId: 'player-a', actionId: 'secret', input: { choice: 'secret' }, decision: 'accept' }); assert.deepEqual(hidden.kernel.view('hidden-window', 'player-a').eligiblePrincipalIds, ['player-a']); assert.equal(hidden.kernel.view('hidden-window', 'player-a').submissions.length, 1); assert.throws(() => hidden.kernel.view('hidden-window', 'public'), /unauthorized/); assert.throws(() => hidden.kernel.adjudicate('hidden-window', 'player-a'), /unauthorized/);
});

test('retries are idempotent and transaction failures roll back submissions, effects and terminal state', () => {
  const kernel = make(); kernel.kernel.open(windowFor(), 'gm-1'); const submission = { operationId: 'retry-1', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }; kernel.kernel.submit(submission); assert.throws(() => kernel.kernel.submit({ ...submission, operationId: 'retry-duplicate' }), /already decided/); assert.deepEqual(kernel.kernel.submit(submission), kernel.kernel.view('window-1', 'player-a')); kernel.kernel.submit({ operationId: 'retry-2', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'y' }, decision: 'accept' }); assert.throws(() => kernel.kernel.submit({ ...submission, input: { choice: 'changed' } }), /another submission/);
  const failed = make({ failureAt: 'after-submission' }); failed.kernel.open(windowFor(), 'gm-1'); assert.throws(() => failed.kernel.submit({ ...submission, operationId: 'failure-1' }), /failure after submission/); assert.equal(failed.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_submissions').get().count, 0); assert.equal(failed.kernel.view('window-1', 'gm-1').status, 'pending');
  const adjudicated = make(); adjudicated.kernel.open(windowFor({ windowId: 'gm-window' }), 'gm-1'); assert.equal(adjudicated.kernel.adjudicate('gm-window', 'gm-1').status, 'resolved');
});

test('supports contrasting narrative interruption and dice-pool decisions through the same contract', () => {
  const narrative = make(); narrative.kernel.open(windowFor({ windowId: 'narrative', eligible: [{ principalId: 'player-a', priority: 2, actions: [action('interrupt')] }] }), 'gm-1'); assert.equal(narrative.kernel.submit({ operationId: 'narrative-1', windowId: 'narrative', principalId: 'player-a', actionId: 'interrupt', input: { choice: 'speak' }, decision: 'accept' }).status, 'resolved');
  const pool = make(); pool.kernel.open(windowFor({ windowId: 'pool', eligible: [{ principalId: 'player-a', priority: 2, actions: [action('roll-pool')] }] }), 'gm-1'); assert.equal(pool.kernel.submit({ operationId: 'pool-1', windowId: 'pool', principalId: 'player-a', actionId: 'roll-pool', input: { choice: 'successes:2' }, decision: 'accept' }).status, 'resolved');
});

test('reaction submission refuses an enclosing command transaction without rolling it back', () => {
  const value = make();
  value.kernel.open(windowFor({ eligible: [{ principalId: 'player-a', priority: 1, actions: [action('shield')] }] }), 'gm-1');
  value.db.exec('CREATE TABLE enclosing_write(value TEXT)');
  value.db.exec('BEGIN IMMEDIATE');
  value.db.prepare('INSERT INTO enclosing_write VALUES(?)').run('kept-until-owner-rolls-back');
  assert.throws(() => value.kernel.submit({ operationId: 'nested-submit', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'yes' }, decision: 'accept' }), /cannot be nested/);
  assert.equal(value.db.isTransaction, true, 'reaction rejection leaves transaction ownership with the caller');
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM enclosing_write').get().count, 1);
  value.db.exec('ROLLBACK');
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM enclosing_write').get().count, 0);
  assert.equal(value.kernel.view('window-1', 'gm-1').status, 'pending');
});

test('host transaction seam composes open, submission, expiry and terminal effects without taking ownership', () => {
  const value = make();
  value.db.exec('CREATE TABLE host_writes(value TEXT)');
  value.db.exec('BEGIN IMMEDIATE');
  value.kernel.openInTransaction(windowFor(), 'gm-1');
  value.db.prepare('INSERT INTO host_writes VALUES(?)').run('same-commit');
  assert.equal(value.db.isTransaction, true);
  value.db.exec('COMMIT');
  assert.equal(value.kernel.view('window-1', 'gm-1').status, 'pending');
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM host_writes').get().count, 1);

  value.db.exec('BEGIN IMMEDIATE');
  value.kernel.openInTransaction(windowFor({ windowId: 'rolled-back-window' }), 'gm-1');
  value.db.prepare('INSERT INTO host_writes VALUES(?)').run('same-rollback');
  value.db.exec('ROLLBACK');
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_windows WHERE window_id=?').get('rolled-back-window').count, 0);
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM host_writes WHERE value=?').get('same-rollback').count, 0);

  const accepted = { operationId: 'tx-a', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' };
  value.db.exec('BEGIN IMMEDIATE');
  value.kernel.submitInTransaction(accepted);
  assert.equal(value.db.isTransaction, true);
  assert.deepEqual(value.kernel.submitInTransaction(accepted), value.kernel.view('window-1', 'player-a'));
  assert.throws(() => value.kernel.submitInTransaction({ ...accepted, input: { choice: 'changed' } }), /another submission/);
  assert.equal(value.db.isTransaction, true, 'errors leave transaction ownership with host');
  value.db.exec('ROLLBACK');
  assert.equal(value.kernel.view('window-1', 'gm-1').submissions.length, 0);

  value.db.exec('BEGIN IMMEDIATE');
  value.kernel.submitInTransaction(accepted);
  value.kernel.submitInTransaction({ operationId: 'tx-b', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'y' }, decision: 'accept' });
  assert.equal(value.db.isTransaction, true);
  value.db.exec('COMMIT');
  assert.equal(value.kernel.view('window-1', 'gm-1').status, 'resolved');
  assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM reaction_effects').get().count, 1);
});

test('transaction-aware failures after creation, decision, expiry and completion leave rollback to host', () => {
  for (const [failureAt, phase] of [['after-open', 'open'], ['after-submission', 'submit'], ['after-transition', 'transition']]) {
    const value = make({ failureAt });
    value.db.exec('BEGIN IMMEDIATE');
    if (phase !== 'open') value.kernel.openInTransaction(windowFor(), 'gm-1');
    assert.throws(() => phase === 'open' ? value.kernel.openInTransaction(windowFor(), 'gm-1') : phase === 'submit'
      ? value.kernel.submitInTransaction({ operationId: 'fail-submit', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' })
      : value.kernel.adjudicateInTransaction('window-1', 'gm-1'), /failure after/);
    assert.equal(value.db.isTransaction, true, `${phase}: caller still owns transaction`);
    value.db.exec('ROLLBACK');
    assert.equal(value.db.isTransaction, false);
    assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_windows').get().count, 0);
    assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_submissions').get().count, 0);
    assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_events').get().count, 0);
  }
  const expiry = make({ failureAt: 'after-transition' });
  expiry.kernel.open(windowFor(), 'gm-1'); expiry.setTime('2026-10-19T00:00:00.000Z');
  expiry.db.exec('BEGIN IMMEDIATE');
  assert.throws(() => expiry.kernel.expireInTransaction('window-1', 'gm-1'), /failure after/);
  assert.equal(expiry.db.isTransaction, true);
  expiry.db.exec('ROLLBACK');
  assert.equal(expiry.kernel.view('window-1', 'gm-1').status, 'pending');
  assert.equal(expiry.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_events').get().count, 0);
});

test('transaction-aware calls require host transaction and retain ordering, authority and visibility checks', () => {
  const value = make();
  assert.throws(() => value.kernel.openInTransaction(windowFor(), 'gm-1'), /requires an active host transaction/);
  value.kernel.open(windowFor({ visibility: 'private', eligible: [{ principalId: 'player-a', priority: 10, actions: [action('shield', 'private')] }, { principalId: 'player-b', priority: 10, actions: [action('dodge', 'private')] }] }), 'gm-1');
  value.db.exec('BEGIN IMMEDIATE');
  value.kernel.submitInTransaction({ operationId: 'priority-tx', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'y' }, decision: 'accept' });
  assert.equal(value.kernel.view('window-1', 'player-b').submissions[0].actionId, 'hidden');
  assert.throws(() => value.kernel.submitInTransaction({ operationId: 'dup-tx', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'z' }, decision: 'accept' }), /already decided/);
  value.db.exec('ROLLBACK');
  let lockValid = true;
  const stale = make({ validateLock: () => { if (!lockValid) throw new Error('stale lock'); } });
  stale.kernel.open(windowFor(), 'gm-1');
  lockValid = false;
  stale.db.exec('BEGIN IMMEDIATE');
  assert.throws(() => stale.kernel.submitInTransaction({ operationId: 'stale-lock', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /stale lock/);
  assert.equal(stale.db.isTransaction, true);
  stale.db.exec('ROLLBACK');
  let grant = true;
  const revoked = make({ authorizeResponder: () => grant });
  revoked.kernel.open(windowFor(), 'gm-1'); grant = false;
  revoked.db.exec('BEGIN IMMEDIATE');
  assert.throws(() => revoked.kernel.submitInTransaction({ operationId: 'revoked', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /not eligible/);
  assert.equal(revoked.db.isTransaction, true);
  revoked.db.exec('ROLLBACK');
});
