import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOperationState, offlineScopeKey } from './storage.ts';

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
