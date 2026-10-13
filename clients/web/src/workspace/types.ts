import type { ComponentType } from 'react';
import type { Activity, Encounter, LoreArticle, Role, SessionSnapshot } from '../api.ts';
import type { Actor } from '../modules.ts';

export type BrickSize = { w: number; h: number };

export type BrickLayout = BrickSize & { x: number; y: number };

export type BrickBinding =
  | { mode: 'follow'; contextKey: 'session.activeEncounter' }
  | { mode: 'pinned'; entityId: string }
  | { mode: 'none' };

export type BrickInstance = {
  id: string;
  typeId: string;
  definitionVersion: number;
  binding: BrickBinding;
  options: Record<string, unknown>;
  layout: BrickLayout;
};

export type Dashboard = { id: string; name: string; bricks: BrickInstance[] };
export type DashboardGroup = { id: string; name: string; dashboardIds: string[] };

export type WorkspaceState = {
  schemaVersion: number;
  localProfileId: string;
  campaignId: string;
  activeGroupId: string;
  activeDashboardId: string;
  groups: DashboardGroup[];
  dashboards: Dashboard[];
};

export type AuthorizedBrickDataAdapter = {
  getActor(entityId: string): Actor | undefined;
  getEncounter(entityId: string): Encounter | undefined;
  getActorOptions(): Array<{ id: string; label: string }>;
  getEncounterOptions(): Array<{ id: string; label: string }>;
  getActiveEncounter(): Encounter | undefined;
  getActivity(): Activity[];
  getParticipants(): Array<{ actor: Actor; status?: string }>;
  getParticipantsForEncounter?(encounterId: string): Array<{ actor: Actor; status?: string }> | undefined;
  getSession(): SessionSnapshot | undefined;
  getRole(): Role;
  getLore?(entityId: string): LoreArticle | undefined;
  getLoreOptions?(): Array<{ id: string; label: string }>;
  getRelatedLore?(): LoreArticle[];
};

export type BrickRenderProps<TData = unknown> = {
  brick: BrickInstance;
  data: TData | undefined;
  adapter: AuthorizedBrickDataAdapter;
  busy: boolean;
  offline?: boolean;
  onAction: (actor: Actor, actionId: string) => void;
  onSessionCommand?: (command: 'start' | 'pause' | 'resume' | 'finish', encounter?: { id: string; revision: number }) => void;
  onOpenApp?: (appId: 'table' | 'characters' | 'encounters' | 'lore', entityId?: string) => void;
};

export type BrickDefinition<TData = unknown> = {
  typeId: string;
  version: number;
  ownerAppId: string;
  title: string;
  supportedBindings: BrickBinding['mode'][];
  defaultSize: BrickSize;
  defaultBinding?: BrickBinding;
  resolve: (binding: BrickBinding, adapter: AuthorizedBrickDataAdapter) => TData | undefined;
  render: ComponentType<BrickRenderProps<TData>>;
  validateOptions: (options: unknown) => options is Record<string, unknown>;
  getBindingOptions?: (adapter: AuthorizedBrickDataAdapter) => Array<{ id: string; label: string }>;
};

export type WorkspaceLoadResult = {
  state: WorkspaceState;
  recovered: boolean;
  reason?: 'missing' | 'invalid-json' | 'invalid-layout' | 'schema-mismatch';
};
