import type { CapabilityDigest, CapabilityId, CapabilityLock, JsonValue, SemVer } from "./index.js";
import type { ResolverRef } from "./resolver.js";
import type { EffectHandlerRef } from "./effects.js";

export type ExtensionCapabilityRef = {
  id: CapabilityId;
  apiVersion: SemVer;
  implementationVersion: SemVer;
  digest: CapabilityDigest;
};
export type ExtensionVisibility = "public" | "gm" | "owner";
export type ExtensionOwnership =
  | { kind: "campaign" }
  | { kind: "principal" };
export type ExtensionPermission = {
  roles: Array<"gm" | "player">;
  ownership: "any" | "owner" | "gm" | "owner-or-participant";
  /** Where declared effects may target. Campaign-visible still requires source authorization and target read access. */
  effectTargetPolicy?: "source-entity" | "campaign-visible";
  /** Host guard: reject the command while any durable reaction continuation is pending for its source entity. */
  noPendingContinuations?: boolean;
};
export type MigrationIdentity = {
  migrationId: CapabilityId;
  fromSchemaVersion: number;
  toSchemaVersion: number;
};
export type ExtensionEntityDescriptor = {
  descriptorVersion: 1;
  typeId: CapabilityId;
  schemaVersion: number;
  capability: ExtensionCapabilityRef;
  schema: JsonValue;
  ownership: ExtensionOwnership;
  visibility: ExtensionVisibility[];
  /** Entity data paths omitted from projections for roles not explicitly listed. */
  fieldVisibility?: Array<{ path: string; roles: Array<"gm" | "player"> }>;
  creationRoles: Array<"gm" | "player">;
  migration: MigrationIdentity;
};
export type ExtensionCommandDescriptor = {
  descriptorVersion: 1;
  commandId: CapabilityId;
  capability: ExtensionCapabilityRef;
  entityTypeId: CapabilityId;
  inputSchema: JsonValue;
  resultSchema: JsonValue;
  permission: ExtensionPermission;
  workflowOnly?: boolean;
  resolver: ResolverRef;
  effects: EffectHandlerRef[];
};
export type ExtensionWorkflowState = { stateId: string; schema: JsonValue };
export type ExtensionWorkflowTransition = {
  transitionId: string;
  commandId: CapabilityId;
  from: string[];
  to: string;
  kind: "transition" | "cancel";
  participantPolicy: "command" | "owner-or-participant" | "gm";
};
export type ExtensionWorkflowDescriptor = {
  descriptorVersion: 1;
  workflowType: CapabilityId;
  capability: ExtensionCapabilityRef;
  entityTypeId: CapabilityId;
  initialState: string;
  terminalStates: string[];
  states: ExtensionWorkflowState[];
  transitions: ExtensionWorkflowTransition[];
  expirationRoles: Array<"gm" | "player">;
};
export type ExtensionEntityRecord = {
  campaignId: string;
  entityId: string;
  typeId: CapabilityId;
  capability: ExtensionCapabilityRef;
  schemaVersion: number;
  migrationId: CapabilityId;
  revision: number;
  visibility: ExtensionVisibility;
  ownerPrincipalId: string | null;
  data: JsonValue;
};
export type ExtensionCommandRequest = {
  operationId: string;
  campaignId: string;
  principalId: string;
  commandId: CapabilityId;
  entityId: string;
  expectedRevision: number;
  expectedRevisions?: Record<string, number>;
  input: JsonValue;
  workflow?: {
    workflowId: string;
    expectedRevision: number;
    expectedContinuationId: string;
    transitionId: string;
  };
};
export type ExtensionCommandAppliedResult = {
  operationId: string;
  status: "applied";
  entityId: string;
  revision: number;
  outcomes: Array<{ kind: string; data: JsonValue; visibility: "public" | "gm" | "private" }>;
  workflow?: { workflowId: string; revision: number; state: string; continuationId: string; status: "active" | "completed" | "cancelled" };
};
export type ExtensionCommandPendingResult = {
  operationId: string;
  status: "pending";
  entityId: string;
  revision: number;
  outcomes: Array<{ kind: string; data: JsonValue; visibility: "public" | "gm" | "private" }>;
  windowId: string;
};
export type ExtensionCommandConflictedResult = { operationId: string; status: "conflicted"; entityId: string; windowId: string; reasonCode: string };
export type ExtensionCommandResult = ExtensionCommandAppliedResult | ExtensionCommandPendingResult | ExtensionCommandConflictedResult;
export type ExtensionWorkflowRecord = {
  workflowId: string;
  campaignId: string;
  entityId: string;
  workflowType: CapabilityId;
  revision: number;
  state: string;
  stateData: JsonValue;
  continuationId: string;
  participants: string[];
  expiresAt: string;
  status: "active" | "completed" | "cancelled" | "expired";
};
export type ExtensionLockCheck = (campaignId: string, lock: CapabilityLock, capability: ExtensionCapabilityRef) => void;
