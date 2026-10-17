import type { CapabilityLock, CapabilityManifest, Resolver, ResolutionInput, ResolutionTranscript, ResolverExecutionLimits, ResolverExecutionResult, ResolverRef, ResolverOutput, TranscriptProjection, TranscriptStore } from "@potomac/contracts";
import type { JsonValue } from "@potomac/contracts";

const DEFAULT_LIMITS: ResolverExecutionLimits = { maxRandomValues: 128, maxOutcomes: 64, maxEffects: 64, maxDecisions: 128, maxStateBytes: 1_000_000, maxInputBytes: 256_000 };
const jsonSize = (value: JsonValue): number => canonicalJson(value).length;
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const checkResolverLock = (ref: ResolverRef, lock: CapabilityLock): void => {
  const entry = lock.lockVersion === 1 && lock.entries.find((candidate) => candidate.id === ref.id);
  if (!entry || entry.apiVersion !== ref.apiVersion || entry.implementationVersion !== ref.implementationVersion || entry.digest !== ref.digest) fail("lock_mismatch", "resolver is not in the exact campaign lock");
};
const validateInput = (input: ResolutionInput, limits: ResolverExecutionLimits): void => {
  if (!input.operationId || !input.campaignId || !input.principalId || !input.logicalTime || !Number.isFinite(Date.parse(input.logicalTime))) fail("malformed_input", "operation, campaign, principal and logical time are required");
  if (jsonSize(input.state) > limits.maxStateBytes || jsonSize(input.input) > limits.maxInputBytes) fail("budget_exceeded", "input exceeds execution bounds");
  const values = input.randomness.reduce((sum, item) => sum + item.values.length, 0);
  if (values > limits.maxRandomValues || input.randomness.some((item) => !item.requestId || item.values.length !== item.count || item.values.some((value) => !Number.isFinite(value)))) fail("malformed_input", "host randomness does not match its requests");
};
const validateOutput = (output: ResolverOutput, limits: ResolverExecutionLimits): void => {
  if (!output || !Array.isArray(output.outcomes) || !Array.isArray(output.effects) || !Array.isArray(output.decisions)) fail("invalid_output", "resolver output shape is invalid");
  if (output.outcomes.length > limits.maxOutcomes || output.effects.length > limits.maxEffects || output.decisions.length > limits.maxDecisions) fail("budget_exceeded", "resolver output exceeds execution bounds");
  for (const effect of output.effects) if (!effect.effectId || !effect.handler || !effect.targetId) fail("invalid_output", "effect identity is required");
};
export function executeResolver(resolver: Resolver, input: ResolutionInput, lock: CapabilityLock, digest: (canonicalTranscript: string) => `sha256:${string}`, limits: ResolverExecutionLimits = DEFAULT_LIMITS): ResolverExecutionResult {
  checkResolverLock(resolver.ref, lock); validateInput(input, limits);
  const output = resolver.resolve(structuredClone(input)); validateOutput(output, limits);
  const transcriptBase = { transcriptVersion: 1 as const, resolver: resolver.ref, input: { operationId: input.operationId, campaignId: input.campaignId, principalId: input.principalId, logicalTime: input.logicalTime, state: input.state, input: input.input }, randomness: input.randomness, decisions: output.decisions, outcomes: output.outcomes, effects: output.effects, ...(output.continuation ? { continuation: output.continuation } : {}) };
  const transcript = { ...transcriptBase, digest: digest(canonicalJson(transcriptBase)) } as ResolutionTranscript;
  return { transcript, replay: (replayInput) => { const replayed = executeResolver(resolver, replayInput, lock, digest, limits).transcript; if (canonicalJson({ ...replayed, digest: undefined }) !== canonicalJson({ ...transcript, digest: undefined })) fail("transcript_mismatch", "replay transcript differs"); } };
}
export function createTranscriptStore(): TranscriptStore {
  const project = (transcript: ResolutionTranscript, role: "public" | "gm"): TranscriptProjection => ({ role, transcript: structuredClone({ transcriptVersion: transcript.transcriptVersion, resolver: transcript.resolver, input: { operationId: transcript.input.operationId, campaignId: transcript.input.campaignId, logicalTime: transcript.input.logicalTime }, randomness: role === "gm" ? transcript.randomness : [], decisions: transcript.decisions.filter((decision) => decision.visibility === "public" || (role === "gm" && decision.visibility === "gm")), outcomes: transcript.outcomes.filter((outcome) => outcome.visibility === "public" || (role === "gm" && outcome.visibility === "gm")), effects: transcript.effects.filter((effect) => effect.visibility === "public" || (role === "gm" && effect.visibility === "gm")), ...(transcript.continuation && role === "gm" ? { continuation: transcript.continuation } : {}) }) });
  return { putPrivate: () => undefined, project };
}
export function resolverManifest(ref: ResolverRef): CapabilityManifest { return { formatVersion: 2, id: ref.id, api: { id: ref.id, apiVersion: ref.apiVersion }, implementationVersion: ref.implementationVersion, digest: ref.digest, kind: "resolver", provides: [{ id: ref.id, apiVersion: ref.apiVersion }], requires: [], trust: "bundled-trusted" }; }
