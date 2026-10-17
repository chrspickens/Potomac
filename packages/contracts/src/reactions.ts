import type { CapabilityLock, JsonValue, ResolverRef } from "./index.js";
import type { EffectVisibility } from "./effects.js";

export type ReactionStatus = "pending" | "resolved" | "declined" | "expired";
export type ReactionOrdering = "priorityThenSubmission" | "simultaneous";
export type ReactionAction = { actionId: string; inputSchema: JsonValue; visibility: EffectVisibility };
export type EligibleResponder = { principalId: string; priority: number; actions: ReactionAction[] };
export type ReactionWindow = {
  windowId: string; parentOperationId: string; campaignId: string; resolver: ResolverRef; lock: CapabilityLock;
  eligible: EligibleResponder[]; ordering: ReactionOrdering; expiresAt: string; continuation: JsonValue;
  visibility: EffectVisibility;
};
export type ReactionSubmission = { operationId: string; windowId: string; principalId: string; actionId: string; input: JsonValue; decision: "accept" | "decline" };
export type ReactionView = { windowId: string; parentOperationId: string; campaignId: string; status: ReactionStatus; expiresAt: string; eligiblePrincipalIds: string[]; submissions: Array<{ principalId: string; actionId: string; decision: "accept" | "decline" }> };
