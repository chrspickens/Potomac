import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addBrick,
  configureBrick,
  createDefaultWorkspace,
  createBrick,
  deleteDashboard,
  moveBrick,
  removeBrick,
  resizeBrick,
  sanitizeWorkspace,
  selectDashboard,
} from './index.ts';
import { loadWorkspace, loadWorkspaceWithRecovery, saveWorkspace, workspaceStorageKey } from './storage.ts';

test('default workspace includes Combat and Planning with optional actor bricks', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  assert.deepEqual(state.groups.map((group) => group.name), ['Combat', 'Planning']);
  assert.deepEqual(state.dashboards[0].bricks.map((brick) => brick.typeId), [
    'characters.sheet', 'encounters.summary', 'activity.log',
  ]);
  assert.equal(state.dashboards[0].bricks[0].binding.mode, 'pinned');
});

test('brick edits are immutable and retain independent instances and dashboard contents', () => {
  const initial = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  const combat = initial.dashboards[0];
  const character = combat.bricks[0];
  const moved = moveBrick(initial, combat.id, character.id, 2, 1);
  const resized = resizeBrick(moved, combat.id, character.id, 7, 5);
  const configured = configureBrick(resized, combat.id, character.id, { binding: { mode: 'pinned', entityId: 'actor-2' }, options: { compact: true } });
  assert.deepEqual(character.layout, { x: 0, y: 0, w: 4, h: 3 });
  assert.deepEqual(configured.dashboards[0].bricks[0], {
    ...character,
    binding: { mode: 'pinned', entityId: 'actor-2' },
    options: { compact: true },
    layout: { x: 2, y: 1, w: 7, h: 5 },
  });
  assert.equal(removeBrick(configured, combat.id, character.id).dashboards[0].bricks.length, 2);
  const other = initial.dashboards[1];
  const withAddedBrick = addBrick(initial, other.id, 'activity.log');
  assert.equal(withAddedBrick.dashboards[0].bricks.length, 3);
  assert.equal(withAddedBrick.dashboards[1].bricks.length, 1);
  assert.equal(selectDashboard(initial, other.id).activeDashboardId, other.id);
});

test('binding validation rejects unsupported and malformed binding values', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  const id = state.dashboards[0].bricks[0].id;
  const invalid = configureBrick(state, state.dashboards[0].id, id, { binding: { mode: 'follow', contextKey: 'session.activeEncounter' } });
  assert.deepEqual(invalid.dashboards[0].bricks[0].binding, { mode: 'pinned', entityId: 'actor-1' });
  assert.deepEqual(configureBrick(state, state.dashboards[0].id, id, { binding: { mode: 'pinned', entityId: '' } }), state);
  assert.throws(() => createBrick('characters.sheet'), /requires an explicit binding/);
  assert.throws(() => createBrick('characters.sheet', { mode: 'none' }), /Unsupported binding/);
  assert.equal(createBrick('characters.sheet', { mode: 'pinned', entityId: 'actor-9' }).binding.mode, 'pinned');
});

test('recovery clamps bad layouts, preserves unknown bricks, and resets incompatible schema', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a');
  state.dashboards[0].bricks.push({
    id: 'future-brick-1', typeId: 'future.widget', definitionVersion: 3,
    binding: { mode: 'none' }, options: { theme: 'violet' },
    layout: { x: -5, y: 7, w: 0, h: 100 },
  });
  const sanitized = sanitizeWorkspace(state, 'campaign-a', 'profile-a');
  const future = sanitized.state.dashboards[0].bricks[2];
  assert.equal(sanitized.recovered, true);
  assert.equal(future.typeId, 'future.widget');
  assert.deepEqual(future.layout, { x: 0, y: 7, w: 1, h: 12 });
  const incompatible = sanitizeWorkspace({ ...state, schemaVersion: 99 }, 'campaign-a', 'profile-a');
  assert.equal(incompatible.recovered, true);
  assert.equal(incompatible.state.schemaVersion, 1);
  assert.equal(incompatible.state.dashboards.length, 2);
});

test('local storage round-trips per campaign and local profile, with visible recovery status', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  saveWorkspace(state);
  assert.equal(loadWorkspace('campaign-a', 'profile-a').dashboards[0].bricks.length, 3);
  assert.equal(loadWorkspace('campaign-b', 'profile-a', ['actor-2']).dashboards[0].bricks[0].binding.entityId, 'actor-2');
  assert.equal(loadWorkspace('campaign-a', 'profile-b').campaignId, 'campaign-a');
  assert.notEqual(workspaceStorageKey('campaign-a', 'profile-a'), workspaceStorageKey('campaign-a', 'profile-b'));
  values.set(workspaceStorageKey('campaign-a', 'profile-a'), '{');
  assert.equal(loadWorkspaceWithRecovery('campaign-a', 'profile-a').reason, 'invalid-json');
  values.set(workspaceStorageKey('campaign-a', 'profile-a'), JSON.stringify({ schemaVersion: 99 }));
  assert.equal(loadWorkspaceWithRecovery('campaign-a', 'profile-a').reason, 'schema-mismatch');
  delete globalThis.localStorage;
});

test('dashboard deletion keeps at least one dashboard', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a');
  const reduced = deleteDashboard(state, state.dashboards[0].id);
  assert.equal(reduced.dashboards.length, 1);
  assert.equal(deleteDashboard(reduced, reduced.dashboards[0].id), reduced);
});
