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

export type BrickDefinition = {
  typeId: string;
  version: number;
  ownerAppId: string;
  title: string;
  supportedBindings: BrickBinding['mode'][];
  defaultSize: BrickSize;
  defaultBinding?: BrickBinding;
};

export type WorkspaceLoadResult = {
  state: WorkspaceState;
  recovered: boolean;
  reason?: 'missing' | 'invalid-json' | 'invalid-layout' | 'schema-mismatch';
};
