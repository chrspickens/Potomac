import test from 'node:test';
import assert from 'node:assert/strict';
import { canReplaceSessionMetadata, isSessionMetadata, MAP_CACHE_MAX_IMAGE_BYTES, MAP_CACHE_MAX_SCENES, nextOperationState, offlineScopeKey, validateAuthorizedMapCache } from './storage.ts';

test('offline map cache enforces a finite, bounded scene and image budget', () => {
  assert.equal(MAP_CACHE_MAX_SCENES, 20);
  assert.equal(MAP_CACHE_MAX_IMAGE_BYTES, 20 * 1024 * 1024);
  const scene = { id: 'map-a', campaignId: 'campaign-a', name: 'Map', kind: 'world', revision: 1, width: 100, height: 80, grid: { type: 'none', size: 0 }, visibility: 'shared', archived: false, pieces: [] };
  validateAuthorizedMapCache([{ scene, cachedAt: 1, background: new Blob(['image']) }], 'campaign-a');
  assert.throws(() => validateAuthorizedMapCache([{ scene, cachedAt: 1, background: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) }], 'campaign-a'), /per-image/);
  assert.throws(() => validateAuthorizedMapCache([0, 1, 2].map(index => ({ scene: { ...scene, id: `image-map-${index}` }, cachedAt: 1, background: new Blob([new Uint8Array(10 * 1024 * 1024)]) })), 'campaign-a'), /20 MiB/);
  assert.throws(() => validateAuthorizedMapCache(Array.from({ length: 21 }, (_, index) => ({ scene: { ...scene, id: `map-${index}` }, cachedAt: 1 })), 'campaign-a'), /20 scenes/);
  assert.throws(() => validateAuthorizedMapCache([{ scene, cachedAt: -1 }], 'campaign-a'), /timestamp/);
  assert.throws(() => validateAuthorizedMapCache([{ scene, cachedAt: 1 }, { scene, cachedAt: 2 }], 'campaign-a'), /Duplicate/);
});

test('offline map cache accepts only well-formed typed map or Lore pin destinations', () => {
  const base = { id: 'map-a', campaignId: 'campaign-a', name: 'Map', kind: 'world', revision: 1, width: 100, height: 80, grid: { type: 'none', size: 0 }, visibility: 'shared', archived: false };
  const pin = { id: 'pin-1', sceneId: 'map-a', kind: 'pin', x: 2, y: 3, visible: true, revision: 1 };
  const valid = destination => validateAuthorizedMapCache([{ scene: { ...base, pieces: [{ ...pin, destination }] }, cachedAt: 1 }], 'campaign-a');
  valid({ kind: 'map_scene', sceneId: 'map-b', name: 'Other map', label: 'Passage' });
  valid({ kind: 'lore_entry', entryId: 'lore-sunken-archive', title: 'Sunken Archive', label: 'Read journal' });
  assert.throws(() => valid({ kind: 'lore_entry', entryId: 'lore-private', title: 'Private entry' }), /destination/);
  assert.throws(() => valid({ kind: 'lore_entry', entryId: 'lore-private', title: 'Private entry', label: '', sceneId: 'map-secret' }), /destination/);
});

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
