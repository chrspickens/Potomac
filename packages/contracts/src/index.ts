export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FieldDefinition = {
  path: string;
  label: string;
  kind: "stat" | "resource" | "text";
};

export type Expression =
  | { literal: JsonPrimitive }
  | { ref: string }
  | { op: "add" | "sub" | "mul" | "div" | "subtract" | "multiply" | "divide" | "gt" | "gte" | "eq" | "and" | "or"; left: Expression; right: Expression }
  | { op: "not"; value: Expression };

export type ActionDefinition = {
  id: string;
  label?: string;
  policy?: "selfService" | "gmReview";
  reconciliation?: "commutative";
  input?: { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  requires?: Expression;
  effects: Array<{ op: "changeResource"; resource: string; amount: Expression }>;
  roll?: { dice: number; sides: number; label: string };
  resolution?: { dice: Array<{ count: number; sides: number; role?: string }>; modifier?: Expression; targetInput?: string; compareTotals?: boolean; comparison?: "gt" | "gte" };
};

export type SystemModule = {
  formatVersion: number;
  id: string;
  version: string;
  name: string;
  schema: Record<string, unknown>;
  view: { title: string; fields: FieldDefinition[]; actions: string[] };
  actions: ActionDefinition[];
};

export type Actor = {
  id: string;
  name: string;
  moduleId: string;
  moduleVersion: string;
  revision: number;
  data: Record<string, JsonValue>;
  gmNotes?: string;
};

export type ActionRequest = {
  operationId: string;
  actorId: string;
  baseRevision: number;
  actionId: string;
};

export type ActorProjection = Omit<Actor, "gmNotes"> & { gmNotes?: string };

// A host-bound intent, never a locally committed actor update. The authenticated
// member is verified against memberId again by the host on every submission.
export type OfflineOperation = {
  operationId: string;
  campaignId: string;
  memberId: string;
  entityId: string;
  baseRevision: number;
  moduleId: string;
  moduleVersion: string;
  schemaVersion: number;
  actionId: string;
  parameters: Record<string, unknown>;
  dependencies?: Array<{ entityId: string; revision: number }>;
};

export type OfflineReceiptStatus = "applied" | "awaitingReview" | "rejected" | "conflicted";

export type OfflineReceipt = {
  operationId: string;
  entityId: string;
  status: OfflineReceiptStatus;
  revision?: number;
  proposalId?: string;
  reasonCode?: string;
  reason?: string | null;
};
