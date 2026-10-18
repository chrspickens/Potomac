import type { CapabilityDigest, CapabilityLock, JsonValue, SemVer } from "./index.js";

export type EffectVisibility = "public" | "gm" | "private";
export type EffectHandlerRef = { id: string; apiVersion: SemVer; implementationVersion: SemVer; digest: CapabilityDigest };
export type EffectTarget = { entityId: string; expectedRevision: number; visibility: EffectVisibility };
export type SemanticEffectProposal = {
  operationId: string; campaignId: string; principalId: string; moduleId: string;
  commandId?: string; authorizedParticipants?: string[]; workflowEntityId?: string;
  lock: CapabilityLock; effects: Array<{
    effectId: string; handler: EffectHandlerRef; target: EffectTarget; payload: JsonValue; visibility: EffectVisibility;
  }>;
};
export type EffectHandlerEntitySnapshot = { entityType: string; revision: number; visibility: EffectVisibility; data: JsonValue };
export type EffectHandlerInvocation = {
  entity: Readonly<EffectHandlerEntitySnapshot>;
  effect: Readonly<{ effectId: string; handler: EffectHandlerRef; target: EffectTarget; payload: JsonValue; visibility: EffectVisibility }>;
};
export type EffectHandlerDescriptor = EffectHandlerRef & {
  atomic: true; targetType: string; payloadSchema: JsonValue; eventSchema: JsonValue; eventKind: string;
  /** Host defaults omitted target visibility to public; authors should declare it explicitly. */
  targetVisibility?: EffectVisibility;
  eventVisibility: EffectVisibility; conflict: "reject-overlap";
  /** Trusted bundled callback only; receives immutable snapshots and no DB/transaction handle. */
  apply: (input: Readonly<EffectHandlerInvocation>) => EffectMutationProposal;
};
export type EffectMutationProposal = { data: JsonValue; revision: number; event: { kind: string; visibility: EffectVisibility; payload: JsonValue } };
export type EffectEvent = { eventId: string; operationId: string; effectId: string; entityId: string; kind: string; visibility: EffectVisibility; payload: JsonValue };
export type EffectReceipt = { operationId: string; payloadHash: CapabilityDigest; status: "applied"; eventIds: string[]; hidden: boolean };
