import test from 'node:test';
import assert from 'node:assert/strict';
import { canReplaceSessionMetadata, isSessionMetadata, nextOperationState, offlineScopeKey } from './storage.ts';

test('offline scope key keeps host, campaign, and member identities distinct', () => {
  const base = { host: 'https://host.example', campaignId: 'campaign-1', memberId: 'member-1' };
  assert.notEqual(offlineScopeKey(base), offlineScopeKey({ ...base, host: 'https://other.example' }));
  assert.notEqual(offlineScopeKey(base), offlineScopeKey({ ...base, campaignId: 'campaign-2' }));
  assert.notEqual(offlineScopeKey(base), offlineScopeKey({ ...base, memberId: 'member-2' }));
});

test('queued operation states allow retry and host receipt transitions only', () => {
  assert.equal(nextOperationState('queued', 'submitting'), true);
  assert.equal(nextOperationState('submitting', 'queued'), true);
  assert.equal(nextOperationState('submitting', 'awaitingReview'), true);
  assert.equal(nextOperationState('awaitingReview', 'applied'), true);
  assert.equal(nextOperationState('applied', 'queued'), false);
  assert.equal(nextOperationState('rejected', 'applied'), false);
});

test('only unsent queued work is eligible for local cancellation', () => {
  assert.equal(nextOperationState('queued', 'submitting'), true);
  assert.equal(nextOperationState('submitting', 'applied'), true);
  assert.equal(nextOperationState('applied', 'queued'), false);
  assert.equal(nextOperationState('awaitingReview', 'queued'), false);
});

test('cached recovery metadata validates and never regresses event or session revisions', () => {
  const session = { revision: 4, current: { id: 's1', status: 'active', revision: 2, startedAt: 't1', updatedAt: 't2', finishedAt: null }, history: [] };
  const current = { cursor: 20, lastSyncedAt: 2, activeEncounter: null, encounters: [], session };
  assert.equal(isSessionMetadata(current), true);
  assert.equal(canReplaceSessionMetadata({ ...current, cursor: 19 }, current), false);
  assert.equal(canReplaceSessionMetadata({ ...current, session: { ...session, revision: 3 } }, current), false);
  assert.equal(canReplaceSessionMetadata({ ...current, cursor: 21, session: { ...session, revision: 5 } }, current), true);
  assert.equal(canReplaceSessionMetadata({ cursor: 21, lastSyncedAt: 3, activeEncounter: null, encounters: [] }, current), false);
  assert.equal(isSessionMetadata({ ...current, session: { ...session, current: { ...session.current, revision: -1 } } }), false);
  assert.equal(isSessionMetadata({ ...current, session: { ...session, current: { ...session.current, status: 'unknown' } } }), false);
});
