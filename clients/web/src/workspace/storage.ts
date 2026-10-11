import { createDefaultWorkspace, sanitizeWorkspace, WORKSPACE_SCHEMA_VERSION } from './state.ts';
import type { WorkspaceLoadResult, WorkspaceState } from './types.ts';

export function workspaceStorageKey(campaignId: string, localProfileId: string): string {
  return `potomac:workspace:v${WORKSPACE_SCHEMA_VERSION}:${encodeURIComponent(campaignId)}:${encodeURIComponent(localProfileId)}`;
}

export function loadWorkspace(campaignId: string, localProfileId: string, actorIds: string[] = []): WorkspaceState {
  return loadWorkspaceWithRecovery(campaignId, localProfileId, actorIds).state;
}

export function loadWorkspaceWithRecovery(campaignId: string, localProfileId: string, actorIds: string[] = []): WorkspaceLoadResult {
  const fallback = createDefaultWorkspace(campaignId, localProfileId, actorIds);
  let raw: string | null;
  try {
    if (typeof globalThis.localStorage === 'undefined') return { state: fallback, recovered: true, reason: 'missing' };
    raw = globalThis.localStorage.getItem(workspaceStorageKey(campaignId, localProfileId));
  } catch {
    return { state: fallback, recovered: true, reason: 'missing' };
  }
  if (raw === null) return { state: fallback, recovered: true, reason: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: fallback, recovered: true, reason: 'invalid-json' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed)) {
    return { state: fallback, recovered: true, reason: 'invalid-layout' };
  }
  if (parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    return { state: fallback, recovered: true, reason: 'schema-mismatch' };
  }
  const result = sanitizeWorkspace(parsed, campaignId, localProfileId);
  return { ...result, ...(result.recovered ? { reason: 'invalid-layout' as const } : {}) };
}

export function saveWorkspace(state: WorkspaceState): void {
  const safe = sanitizeWorkspace(state, state.campaignId, state.localProfileId).state;
  const storage = globalThis.localStorage;
  if (typeof storage === 'undefined') throw new Error('localStorage is unavailable');
  storage.setItem(workspaceStorageKey(state.campaignId, state.localProfileId), JSON.stringify(safe));
}
