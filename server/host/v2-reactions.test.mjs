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
const make = ({ ordering = 'simultaneous', failureAt, authenticate = () => true, authorizeResponder = () => true, authorizeGm = () => true } = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'potomac-v2-reactions-')), 'host.sqlite'); const db = new DatabaseSync(path); let clock = '2026-10-17T00:00:00.000Z';
  const kernel = createV2ReactionKernel({ db, authenticate, authorizeResponder, authorizeGm, validateLock: (campaignId, value) => { if (campaignId !== value.campaignId || value.rootModule.id !== resolver.id) throw new Error('lock mismatch'); }, validateInput: (input, schema) => { if (!input || typeof input.choice !== 'string' || !schema.required.includes('choice')) throw new Error('invalid action input'); }, now: () => clock, failureAt, complete: ({ decisions }) => ({ effects: decisions.some(decision => decision.decision === 'accept') ? [{ effectId: 'defense-effect', visibility: 'public' }] : [] }), applyEffects: (effects, { db: transactionDb }) => { transactionDb.exec('CREATE TABLE IF NOT EXISTS reaction_effects(effect_id TEXT PRIMARY KEY, payload TEXT NOT NULL)'); for (const effect of effects) transactionDb.prepare('INSERT INTO reaction_effects VALUES(?,?)').run(effect.effectId, JSON.stringify(effect)); }, });
  return { db, kernel, path, setTime: value => { clock = value; } };
};

test('persists windows, accepts simultaneous responders deterministically, and restores after restart', () => {
  const first = make(); first.kernel.open(windowFor()); first.kernel.submit({ operationId: 'submit-a', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'protect' }, decision: 'accept' });
  assert.equal(first.kernel.view('window-1', 'public').status, 'pending');
  const reopened = new DatabaseSync(first.path); const restored = createV2ReactionKernel({ db: reopened, authenticate: () => true, authorizeResponder: () => true, authorizeGm: () => true, validateLock: () => undefined, validateInput: () => undefined, complete: ({ decisions }) => ({ effects: decisions.length ? [{ effectId: 'defense-effect' }] : [] }), applyEffects: (effects, { db }) => { db.exec('CREATE TABLE IF NOT EXISTS reaction_effects(effect_id TEXT PRIMARY KEY)'); for (const effect of effects) db.prepare('INSERT INTO reaction_effects VALUES(?)').run(effect.effectId); } });
  assert.equal(restored.view('window-1', 'public').status, 'pending');
  const result = restored.submit({ operationId: 'submit-b', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'evade' }, decision: 'accept' }); assert.equal(result.status, 'resolved'); assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM reaction_effects').get().count, 1);
});

test('uses deterministic priority and submission tie-breaking, explicit decline and expiry', () => {
  const priority = make({ ordering: 'priorityThenSubmission' }); priority.kernel.open(windowFor({ ordering: 'priorityThenSubmission' })); const result = priority.kernel.submit({ operationId: 'priority-1', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'evade' }, decision: 'accept' }); assert.equal(result.status, 'resolved');
  const declined = make(); declined.kernel.open(windowFor({ windowId: 'window-decline' })); assert.equal(declined.kernel.submit({ operationId: 'decline-1', windowId: 'window-decline', principalId: 'player-a', actionId: 'shield', input: { choice: 'no' }, decision: 'decline' }).status, 'declined');
  const expired = make(); expired.kernel.open(windowFor({ windowId: 'window-expired' })); expired.setTime('2026-10-19T00:00:00.000Z'); assert.equal(expired.kernel.submit({ operationId: 'expired-1', windowId: 'window-expired', principalId: 'player-a', actionId: 'shield', input: { choice: 'late' }, decision: 'accept' }).status, 'expired');
});

test('rejects unauthorized responders/GM, invalid actions, stale retries and hides private choices', () => {
  const denied = make({ authenticate: () => false }); denied.kernel.open(windowFor()); assert.throws(() => denied.kernel.submit({ operationId: 'denied', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /unauthenticated/);
  const unauthorized = make({ authorizeResponder: () => false }); unauthorized.kernel.open(windowFor()); assert.throws(() => unauthorized.kernel.submit({ operationId: 'denied-2', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }), /not eligible/);
  const hidden = make({ authorizeGm: () => false }); hidden.kernel.open(windowFor({ windowId: 'hidden-window', visibility: 'private', eligible: [{ principalId: 'player-a', priority: 1, actions: [action('secret', 'private')] }, { principalId: 'player-b', priority: 1, actions: [action('dodge', 'private')] }] })); hidden.kernel.submit({ operationId: 'hidden-1', windowId: 'hidden-window', principalId: 'player-a', actionId: 'secret', input: { choice: 'secret' }, decision: 'accept' }); assert.deepEqual(hidden.kernel.view('hidden-window', 'public').eligiblePrincipalIds, []); assert.equal(hidden.kernel.view('hidden-window', 'public').submissions.length, 0); assert.throws(() => hidden.kernel.adjudicate('hidden-window', 'player-a'), /unauthorized/);
});

test('retries are idempotent and transaction failures roll back submissions, effects and terminal state', () => {
  const kernel = make(); kernel.kernel.open(windowFor()); const submission = { operationId: 'retry-1', windowId: 'window-1', principalId: 'player-a', actionId: 'shield', input: { choice: 'x' }, decision: 'accept' }; kernel.kernel.submit(submission); assert.deepEqual(kernel.kernel.submit(submission), kernel.kernel.view('window-1', 'gm')); kernel.kernel.submit({ operationId: 'retry-2', windowId: 'window-1', principalId: 'player-b', actionId: 'dodge', input: { choice: 'y' }, decision: 'accept' }); assert.throws(() => kernel.kernel.submit({ ...submission, input: { choice: 'changed' } }), /another submission/);
  const failed = make({ failureAt: 'after-submission' }); failed.kernel.open(windowFor()); assert.throws(() => failed.kernel.submit({ ...submission, operationId: 'failure-1' }), /failure after submission/); assert.equal(failed.db.prepare('SELECT COUNT(*) AS count FROM v2_reaction_submissions').get().count, 0); assert.equal(failed.kernel.view('window-1', 'gm').status, 'pending');
  const adjudicated = make(); adjudicated.kernel.open(windowFor({ windowId: 'gm-window' })); assert.equal(adjudicated.kernel.adjudicate('gm-window', 'gm-1').status, 'resolved');
});

test('supports contrasting narrative interruption and dice-pool decisions through the same contract', () => {
  const narrative = make(); narrative.kernel.open(windowFor({ windowId: 'narrative', eligible: [{ principalId: 'player-a', priority: 2, actions: [action('interrupt')] }] })); assert.equal(narrative.kernel.submit({ operationId: 'narrative-1', windowId: 'narrative', principalId: 'player-a', actionId: 'interrupt', input: { choice: 'speak' }, decision: 'accept' }).status, 'resolved');
  const pool = make(); pool.kernel.open(windowFor({ windowId: 'pool', eligible: [{ principalId: 'player-a', priority: 2, actions: [action('roll-pool')] }] })); assert.equal(pool.kernel.submit({ operationId: 'pool-1', windowId: 'pool', principalId: 'player-a', actionId: 'roll-pool', input: { choice: 'successes:2' }, decision: 'accept' }).status, 'resolved');
});
