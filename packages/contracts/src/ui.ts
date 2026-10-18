import type { CapabilityDigest, CapabilityLock, JsonValue, SemVer } from "./index.js";
import type { ExtensionCommandDescriptor, ExtensionEntityDescriptor, ExtensionWorkflowDescriptor } from "./extensions.js";

/** A reference is exact: API, implementation, and artifact digest are all pinned. */
export type UiCapabilityRef = { id: string; apiVersion: SemVer; implementationVersion: SemVer; digest: CapabilityDigest };
export type UiContributionKind = "sheet" | "panel" | "action-control" | "form" | "display" | "resource" | "brick";
export type UiVisibilityCondition = { path: string; equals: JsonValue };
export type UiNode =
  | { kind: "group"; id: string; label?: string; children: UiNode[]; visibleWhen?: UiVisibilityCondition }
  | { kind: "section"; id: string; label?: string; children: UiNode[]; visibleWhen?: UiVisibilityCondition }
  | { kind: "slot"; id: string; slotId: string }
  | { kind: "display"; id: string; path: string; label: string; visibleWhen?: UiVisibilityCondition }
  | { kind: "resource"; id: string; label: string; currentPath: string; maximumPath: string; visibleWhen?: UiVisibilityCondition }
  | { kind: "workflow-status"; id: string; workflowTypeId: string; label: string }
  | { kind: "command"; id: string; commandId: string; label: string; visibleWhen?: UiVisibilityCondition; workflowTypeId?: string; transitionId?: string; visibleWhenWorkflowState?: string }
  | { kind: "form"; id: string; commandId: string; label: string; visibleWhen?: UiVisibilityCondition; workflowTypeId?: string; transitionId?: string; visibleWhenWorkflowState?: string };

export type UiCommandContract = {
  commandId: string;
  capability: UiCapabilityRef;
  inputSchema: JsonValue;
};
export type UiWorkflowContract = { workflowTypeId: string; capability: UiCapabilityRef; states: string[]; transitions: Array<{ transitionId: string; commandId: string }> };
export type UiWorkflowProjection = { workflowId: string; campaignId: string; entityId: string; workflowTypeId: string; capability: UiCapabilityRef; revision: number; continuationId: string; state: string; status: "active" | "completed" | "cancelled" | "expired" };
export type UiDescriptorCatalog = {
  entities: Array<Pick<ExtensionEntityDescriptor, "typeId" | "schemaVersion" | "capability" | "schema">>;
  commands: Array<Pick<ExtensionCommandDescriptor, "commandId" | "entityTypeId" | "capability" | "inputSchema">>;
  workflows: Array<Pick<ExtensionWorkflowDescriptor, "workflowType" | "entityTypeId" | "capability" | "states" | "transitions">>;
};

export type UiContribution = {
  contractVersion: 1;
  contributionId: string;
  contributionVersion: SemVer;
  kind: UiContributionKind;
  capability: UiCapabilityRef;
  entityTypeId: string;
  entityCapability: UiCapabilityRef;
  entitySchemaVersion: number;
  entitySchema: JsonValue;
  commands: UiCommandContract[];
  workflows: UiWorkflowContract[];
  slots: string[];
  nodes: UiNode[];
};

/** The host sends only this already-authorized/redacted entity projection. */
export type UiEntityProjection = {
  campaignId: string;
  entityId: string;
  typeId: string;
  capability: UiCapabilityRef;
  schemaVersion: number;
  revision: number;
  data: JsonValue;
};

/** Authorization is supplied by the host, never inferred from a UI binding or role label. */
export type UiHostContext = {
  lock: CapabilityLock;
  principalId: string;
  allowedCommandIds: string[];
  submitCommand: (request: { operationId: string; campaignId: string; principalId: string; commandId: string; entityId: string; expectedRevision: number; input: Record<string, JsonValue>; workflow?: { workflowId: string; expectedRevision: number; expectedContinuationId: string; transitionId: string } }) => Promise<unknown>;
  workflow?: UiWorkflowProjection;
};

export type UiRenderStatus = "ready" | "loading" | "unavailable" | "error";
