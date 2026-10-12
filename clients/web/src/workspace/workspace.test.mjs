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
import { getBrickDefinition, registerBrickDefinition } from './registry.ts';

test('default workspace includes Combat and Planning with optional actor bricks', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  assert.deepEqual(state.groups.map((group) => group.name), ['Combat', 'Planning']);
  assert.deepEqual(state.dashboards[0].bricks.map((brick) => brick.typeId), [
    'characters.sheet', 'table.session', 'table.participants', 'table.activity', 'encounters.summary', 'activity.log',
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
  assert.equal(removeBrick(configured, combat.id, character.id).dashboards[0].bricks.length, 5);
  const other = initial.dashboards[1];
  const withAddedBrick = addBrick(initial, other.id, 'activity.log');
  assert.equal(withAddedBrick.dashboards[0].bricks.length, 6);
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

test('trusted fourth brick contribution registers a renderer and resolves only through the authorized adapter', () => {
  const unregister = registerBrickDefinition({
    typeId: 'test.trusted-activity', version: 1, ownerAppId: 'test', title: 'Trusted test brick',
    supportedBindings: ['none'], defaultBinding: { mode: 'none' }, defaultSize: { w: 2, h: 2 },
    resolve: (_binding, adapter) => adapter.getActivity(), render: () => null,
    validateOptions: options => options !== null && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).length === 0,
  });
  try {
    assert.equal(getBrickDefinition('test.trusted-activity')?.title, 'Trusted test brick');
    const state = createDefaultWorkspace('campaign-a', 'profile-a');
    const updated = addBrick(state, state.dashboards[0].id, 'test.trusted-activity');
    assert.equal(updated.dashboards[0].bricks.at(-1)?.typeId, 'test.trusted-activity');
  } finally {
    unregister();
  }
  assert.equal(getBrickDefinition('test.trusted-activity'), undefined);
});

test('recovery clamps bad layouts, preserves unknown bricks, and resets incompatible schema', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a');
  state.dashboards[0].bricks.push({
    id: 'future-brick-1', typeId: 'future.widget', definitionVersion: 3,
    binding: { mode: 'none' }, options: { theme: 'violet' },
    layout: { x: -5, y: 7, w: 0, h: 100 },
  });
  const sanitized = sanitizeWorkspace(state, 'campaign-a', 'profile-a');
  const future = sanitized.state.dashboards[0].bricks.at(-1);
  assert.equal(sanitized.recovered, true);
  assert.equal(future.typeId, 'future.widget');
  assert.deepEqual(future.layout, { x: 0, y: 7, w: 1, h: 12 });
  const incompatible = sanitizeWorkspace({ ...state, schemaVersion: 99 }, 'campaign-a', 'profile-a');
  assert.equal(incompatible.recovered, true);
  assert.equal(incompatible.state.schemaVersion, 1);
  assert.equal(incompatible.state.dashboards.length, 2);
});

test('recovery preserves unsupported saved bindings for explicit repair', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  const brick = state.dashboards[0].bricks[0];
  brick.binding = { mode: 'none' };
  const recovered = sanitizeWorkspace(state, 'campaign-a', 'profile-a');
  assert.deepEqual(recovered.state.dashboards[0].bricks[0].binding, { mode: 'none' });
});

test('brick option validation rejects unsupported edits and recovers known options while retaining unknown configuration', () => {
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  const dashboard = state.dashboards[0];
  const character = dashboard.bricks[0];
  const allowed = configureBrick(state, dashboard.id, character.id, { options: { compact: true } });
  assert.deepEqual(allowed.dashboards[0].bricks[0].options, { compact: true });
  assert.deepEqual(configureBrick(allowed, dashboard.id, character.id, { options: { compact: true, unsupported: true } }), allowed);

  const persisted = structuredClone(state);
  persisted.dashboards[0].bricks[0].options = { unsupported: 'old-setting' };
  persisted.dashboards[0].bricks.push({
    id: 'future-with-options', typeId: 'future.widget', definitionVersion: 4,
    binding: { mode: 'none' }, options: { futureSetting: { enabled: true } },
    layout: { x: 0, y: 8, w: 3, h: 2 },
  });
  const recovered = sanitizeWorkspace(persisted, 'campaign-a', 'profile-a');
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state.dashboards[0].bricks[0].options, {});
  assert.deepEqual(recovered.state.dashboards[0].bricks.at(-1).options, { futureSetting: { enabled: true } });
});

test('local storage round-trips per campaign and local profile, with visible recovery status', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = createDefaultWorkspace('campaign-a', 'profile-a', ['actor-1']);
  saveWorkspace(state);
  assert.equal(loadWorkspace('campaign-a', 'profile-a').dashboards[0].bricks.length, 6);
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
