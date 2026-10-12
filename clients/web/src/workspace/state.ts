import { getBrickDefinition } from './registry.ts';
import type {
  BrickBinding,
  BrickInstance,
  BrickLayout,
  Dashboard,
  DashboardGroup,
  WorkspaceState,
} from './types.ts';

export const WORKSPACE_SCHEMA_VERSION = 1;
const MAX_COORDINATE = 1000;
const MAX_DIMENSION = 12;

function newId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return `${prefix}-${randomUUID ? randomUUID.call(globalThis.crypto) : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function createDefaultWorkspace(
  campaignId: string,
  localProfileId: string,
  actorIds: string[] = [],
): WorkspaceState {
  const combatId = 'dashboard-combat';
  const planningId = 'dashboard-planning';
  const combatBricks: BrickInstance[] = [];
  actorIds.forEach((entityId, index) => {
    combatBricks.push(createBrick('characters.sheet', { mode: 'pinned', entityId }, { x: index * 4, y: 0 }));
  });
  combatBricks.push(
    createBrick('encounters.summary', { mode: 'follow', contextKey: 'session.activeEncounter' }, { x: actorIds.length * 4, y: 0 }),
    createBrick('activity.log', { mode: 'none' }, { x: 0, y: 3 }),
  );
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    campaignId,
    localProfileId,
    activeGroupId: 'group-combat',
    activeDashboardId: combatId,
    groups: [
      { id: 'group-combat', name: 'Combat', dashboardIds: [combatId] },
      { id: 'group-planning', name: 'Planning', dashboardIds: [planningId] },
    ],
    dashboards: [
      { id: combatId, name: 'Combat', bricks: combatBricks },
      { id: planningId, name: 'Planning', bricks: [] },
    ],
  };
}

export function createBrick(typeId: string, binding?: BrickBinding, position: Pick<BrickLayout, 'x' | 'y'> = { x: 0, y: 0 }): BrickInstance {
  const definition = getBrickDefinition(typeId);
  if (!definition) throw new Error(`Unknown brick type: ${typeId}`);
  const requested = binding ?? definition.defaultBinding;
  if (!requested) throw new Error(`Brick type ${typeId} requires an explicit binding`);
  if (!isSupportedBinding(typeId, requested)) throw new Error(`Unsupported binding for brick type: ${typeId}`);
  return {
    id: newId('brick'),
    typeId,
    definitionVersion: definition.version,
    binding: requested,
    options: {},
    layout: {
      ...position,
      w: definition.defaultSize.w,
      h: definition.defaultSize.h,
    },
  };
}

export function isSupportedBinding(typeId: string, binding: unknown): binding is BrickBinding {
  if (!isRecord(binding) || typeof binding.mode !== 'string') return false;
  const definition = getBrickDefinition(typeId);
  if (!definition || !definition.supportedBindings.includes(binding.mode as BrickBinding['mode'])) return false;
  if (binding.mode === 'none') return true;
  if (binding.mode === 'pinned') return typeof binding.entityId === 'string' && binding.entityId.trim().length > 0;
  return binding.mode === 'follow' && binding.contextKey === 'session.activeEncounter';
}

export function addDashboard(state: WorkspaceState, name: string, groupId = state.activeGroupId): WorkspaceState {
  if (!state.groups.some((group) => group.id === groupId)) return state;
  const id = newId('dashboard');
  return {
    ...state,
    dashboards: [...state.dashboards, { id, name: name.trim() || 'New dashboard', bricks: [] }],
    groups: state.groups.map((group) => group.id === groupId ? { ...group, dashboardIds: [...group.dashboardIds, id] } : group),
    activeGroupId: groupId,
    activeDashboardId: id,
  };
}

export function renameDashboard(state: WorkspaceState, dashboardId: string, name: string): WorkspaceState {
  const cleanName = name.trim();
  return cleanName ? { ...state, dashboards: state.dashboards.map((dashboard) => dashboard.id === dashboardId ? { ...dashboard, name: cleanName } : dashboard) } : state;
}

export function deleteDashboard(state: WorkspaceState, dashboardId: string): WorkspaceState {
  const target = state.dashboards.find((dashboard) => dashboard.id === dashboardId);
  if (!target || state.dashboards.length <= 1) return state;
  const dashboards = state.dashboards.filter((dashboard) => dashboard.id !== dashboardId);
  const groups = state.groups.map((group) => ({ ...group, dashboardIds: group.dashboardIds.filter((id) => id !== dashboardId) }));
  const fallback = dashboards[0];
  const activeDashboardId = state.activeDashboardId === dashboardId ? fallback.id : state.activeDashboardId;
  const activeGroupId = groups.find((group) => group.dashboardIds.includes(activeDashboardId))?.id ?? groups[0].id;
  return { ...state, dashboards, groups, activeDashboardId, activeGroupId };
}

export function selectDashboard(state: WorkspaceState, dashboardId: string): WorkspaceState {
  const group = state.groups.find((candidate) => candidate.dashboardIds.includes(dashboardId));
  return group ? { ...state, activeGroupId: group.id, activeDashboardId: dashboardId } : state;
}

export function addGroup(state: WorkspaceState, name: string): WorkspaceState {
  const id = newId('group');
  return { ...state, groups: [...state.groups, { id, name: name.trim() || 'New group', dashboardIds: [] }] };
}

export function deleteGroup(state: WorkspaceState, groupId: string): WorkspaceState {
  if (state.groups.length <= 1) return state;
  const removed = state.groups.find((group) => group.id === groupId);
  if (!removed) return state;
  const target = state.groups.find((group) => group.id !== groupId);
  if (!target) return state;
  const groups = state.groups
    .filter((group) => group.id !== groupId)
    .map((group) => group.id === target.id
      ? { ...group, dashboardIds: [...group.dashboardIds, ...removed.dashboardIds.filter((id) => !group.dashboardIds.includes(id))] }
      : group);
  const activeGroupId = state.activeGroupId === groupId ? target.id : state.activeGroupId;
  return { ...state, groups, activeGroupId };
}

export function renameGroup(state: WorkspaceState, groupId: string, name: string): WorkspaceState {
  const cleanName = name.trim();
  return cleanName ? { ...state, groups: state.groups.map((group) => group.id === groupId ? { ...group, name: cleanName } : group) } : state;
}

export function moveDashboardToGroup(state: WorkspaceState, dashboardId: string, groupId: string): WorkspaceState {
  if (!state.dashboards.some((dashboard) => dashboard.id === dashboardId) || !state.groups.some((group) => group.id === groupId)) return state;
  const groups = state.groups.map((group) => ({
    ...group,
    dashboardIds: group.id === groupId
      ? [...group.dashboardIds.filter((id) => id !== dashboardId), dashboardId]
      : group.dashboardIds.filter((id) => id !== dashboardId),
  }));
  return { ...state, groups, ...(state.activeDashboardId === dashboardId ? { activeGroupId: groupId } : {}) };
}

export function addBrick(state: WorkspaceState, dashboardId: string, typeId: string, binding?: BrickBinding): WorkspaceState {
  const dashboard = state.dashboards.find((candidate) => candidate.id === dashboardId);
  if (!dashboard) return state;
  const brick = createBrick(typeId, binding, { x: 0, y: dashboard.bricks.reduce((max, item) => Math.max(max, item.layout.y + item.layout.h), 0) });
  return updateDashboard(state, dashboardId, (current) => ({ ...current, bricks: [...current.bricks, brick] }));
}

export function moveBrick(state: WorkspaceState, dashboardId: string, brickId: string, x: number, y: number): WorkspaceState {
  if (!isFiniteInteger(x) || !isFiniteInteger(y)) return state;
  return updateBrick(state, dashboardId, brickId, (brick) => ({ ...brick, layout: { ...brick.layout, x: clamp(x, 0, MAX_COORDINATE), y: clamp(y, 0, MAX_COORDINATE) } }));
}

export function resizeBrick(state: WorkspaceState, dashboardId: string, brickId: string, w: number, h: number): WorkspaceState {
  if (!isFiniteInteger(w) || !isFiniteInteger(h)) return state;
  return updateBrick(state, dashboardId, brickId, (brick) => ({ ...brick, layout: { ...brick.layout, w: clamp(w, 1, MAX_DIMENSION), h: clamp(h, 1, MAX_DIMENSION) } }));
}

export function removeBrick(state: WorkspaceState, dashboardId: string, brickId: string): WorkspaceState {
  return updateDashboard(state, dashboardId, (dashboard) => ({ ...dashboard, bricks: dashboard.bricks.filter((brick) => brick.id !== brickId) }));
}

export function configureBrick(state: WorkspaceState, dashboardId: string, brickId: string, configuration: { binding?: BrickBinding; options?: Record<string, unknown> }): WorkspaceState {
  return updateBrick(state, dashboardId, brickId, (brick) => {
    if (configuration.binding && !isSupportedBinding(brick.typeId, configuration.binding)) return brick;
    const definition = getBrickDefinition(brick.typeId);
    if (configuration.options && definition && !definition.validateOptions(configuration.options)) return brick;
    return { ...brick, ...(configuration.binding ? { binding: configuration.binding } : {}), ...(configuration.options ? { options: configuration.options } : {}) };
  });
}

export function updateDashboard(state: WorkspaceState, dashboardId: string, update: (dashboard: Dashboard) => Dashboard): WorkspaceState {
  return { ...state, dashboards: state.dashboards.map((dashboard) => dashboard.id === dashboardId ? update(dashboard) : dashboard) };
}

function updateBrick(state: WorkspaceState, dashboardId: string, brickId: string, update: (brick: BrickInstance) => BrickInstance): WorkspaceState {
  return updateDashboard(state, dashboardId, (dashboard) => ({ ...dashboard, bricks: dashboard.bricks.map((brick) => brick.id === brickId ? update(brick) : brick) }));
}

export function sanitizeWorkspace(value: unknown, campaignId: string, localProfileId: string): { state: WorkspaceState; recovered: boolean } {
  const fallback = createDefaultWorkspace(campaignId, localProfileId);
  if (!isRecord(value) || value.schemaVersion !== WORKSPACE_SCHEMA_VERSION || !Array.isArray(value.groups) || !Array.isArray(value.dashboards)) {
    return { state: fallback, recovered: true };
  }
  let recovered = false;
  const dashboardIds = new Set<string>();
  const dashboards: Dashboard[] = [];
  for (const raw of value.dashboards) {
    if (!isRecord(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !Array.isArray(raw.bricks) || dashboardIds.has(raw.id)) {
      recovered = true;
      continue;
    }
    dashboardIds.add(raw.id);
    const brickIds = new Set<string>();
    const bricks: BrickInstance[] = [];
    for (const item of raw.bricks) {
      const brick = sanitizeBrick(item);
      if (!brick || brickIds.has(brick.id)) {
        recovered = true;
        continue;
      }
      if (JSON.stringify(brick) !== JSON.stringify(item)) recovered = true;
      brickIds.add(brick.id);
      bricks.push(brick);
    }
    dashboards.push({ id: raw.id, name: raw.name, bricks });
  }
  if (dashboards.length === 0) return { state: fallback, recovered: true };
  const groupIds = new Set<string>();
  const groups: DashboardGroup[] = [];
  for (const raw of value.groups) {
    if (!isRecord(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !Array.isArray(raw.dashboardIds) || groupIds.has(raw.id)) {
      recovered = true;
      continue;
    }
    groupIds.add(raw.id);
    const members = [...new Set(raw.dashboardIds.filter((id): id is string => typeof id === 'string' && dashboardIds.has(id)))];
    if (members.length !== raw.dashboardIds.length) recovered = true;
    groups.push({ id: raw.id, name: raw.name, dashboardIds: members });
  }
  const assigned = new Set(groups.flatMap((group) => group.dashboardIds));
  const orphanIds = dashboards.map((dashboard) => dashboard.id).filter((id) => !assigned.has(id));
  if (groups.length === 0 || orphanIds.length) {
    recovered = true;
    if (!groups.some((group) => group.id === 'group-recovered')) groups.push({ id: 'group-recovered', name: 'Recovered', dashboardIds: [] });
    const target = groups.find((group) => group.id === 'group-recovered');
    if (target) target.dashboardIds.push(...orphanIds);
  }
  const activeDashboardId = isNonEmptyString(value.activeDashboardId) && dashboardIds.has(value.activeDashboardId) ? value.activeDashboardId : dashboards[0].id;
  const activeGroupId = groups.find((group) => group.dashboardIds.includes(activeDashboardId))?.id ?? groups[0].id;
  if (activeDashboardId !== value.activeDashboardId || activeGroupId !== value.activeGroupId) recovered = true;
  return {
    state: {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      campaignId,
      localProfileId,
      groups,
      dashboards,
      activeDashboardId,
      activeGroupId,
    },
    recovered,
  };
}

function sanitizeBrick(value: unknown): BrickInstance | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.typeId)) return undefined;
  const version = isFiniteInteger(value.definitionVersion) && value.definitionVersion > 0 ? value.definitionVersion : 1;
  const rawLayout = isRecord(value.layout) ? value.layout : {};
  const layout = {
    x: sanitizedInteger(rawLayout.x, 0, MAX_COORDINATE, 0),
    y: sanitizedInteger(rawLayout.y, 0, MAX_COORDINATE, 0),
    w: sanitizedInteger(rawLayout.w, 1, MAX_DIMENSION, 4),
    h: sanitizedInteger(rawLayout.h, 1, MAX_DIMENSION, 3),
  };
  const definition = getBrickDefinition(value.typeId);
  let binding: BrickBinding;
  if (isSupportedBinding(value.typeId, value.binding)) binding = value.binding;
  else if (isOpaqueBinding(value.binding)) binding = value.binding;
  else binding = definition?.defaultBinding ?? { mode: 'none' };
  const rawOptions = isRecord(value.options) ? value.options : {};
  const options = definition && !definition.validateOptions(rawOptions) ? {} : rawOptions;
  return {
    id: value.id,
    typeId: value.typeId,
    definitionVersion: version,
    binding,
    options,
    layout,
  };
}

function isOpaqueBinding(value: unknown): value is BrickBinding {
  if (!isRecord(value)) return false;
  if (value.mode === 'none') return true;
  if (value.mode === 'pinned') return typeof value.entityId === 'string';
  return value.mode === 'follow' && value.contextKey === 'session.activeEncounter';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isFiniteInteger(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value); }
function sanitizedInteger(value: unknown, min: number, max: number, fallback: number): number { return isFiniteInteger(value) ? clamp(value, min, max) : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
