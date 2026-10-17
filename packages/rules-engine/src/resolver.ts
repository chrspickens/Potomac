import { createHash } from "node:crypto";
import type { CapabilityLock, CapabilityManifest, Resolver, ResolutionInput, ResolutionTranscript, ResolverExecutionLimits, ResolverExecutionResult, ResolverRef, ResolverOutput, TranscriptProjection, TranscriptStore, RandomInput } from "@potomac/contracts";

const DEFAULT_LIMITS: ResolverExecutionLimits = { maxRandomValues: 128, maxOutcomes: 64, maxEffects: 64, maxDecisions: 128, maxStateBytes: 1_000_000, maxInputBytes: 256_000, maxJsonDepth: 32, maxTranscriptBytes: 2_000_000 };
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
function canonical(value: unknown, depth = 0, maxDepth = 32): string {
  if (depth > maxDepth) fail("invalid_json", "JSON value exceeds maximum depth");
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("invalid_json", "JSON values must contain finite numbers"); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
  if (typeof value !== "object" || value === undefined) fail("invalid_json", "JSON values cannot contain undefined or unsupported values");
  if (Array.isArray(value)) return `[${value.map((item, index) => index in value ? canonical(item, depth + 1, maxDepth) : fail("invalid_json", `JSON array has a hole at ${index}`)).join(",")}]`;
  const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) fail("invalid_json", "JSON values must be plain objects");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => { if (RESERVED_KEYS.has(key)) fail("invalid_json", `Unsafe JSON key: ${key}`); return `${JSON.stringify(key)}:${canonical(object[key], depth + 1, maxDepth)}`; }).join(",")}}`;
}
export const canonicalJson = (value: unknown): string => canonical(value);
export const sha256Canonical = (value: unknown): `sha256:${string}` => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const digestPattern = /^sha256:[0-9a-f]{64}$/; const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const checkResolverLock = (ref: ResolverRef, lock: CapabilityLock, campaignId: string): void => {
  if (!lock || lock.lockVersion !== 1 || !idPattern.test(lock.campaignId) || !Array.isArray(lock.entries) || lock.campaignId !== campaignId) fail("lock_mismatch", "campaign identity does not match the exact capability lock");
  const matches = lock.entries.filter((entry) => entry.id === ref.id); if (matches.length !== 1 || matches[0].apiVersion !== ref.apiVersion || matches[0].implementationVersion !== ref.implementationVersion || matches[0].digest !== ref.digest) fail("lock_mismatch", "resolver is not in the exact campaign lock");
  if (!idPattern.test(ref.id) || !semverPattern.test(ref.apiVersion) || !semverPattern.test(ref.implementationVersion) || !digestPattern.test(ref.digest)) fail("lock_mismatch", "resolver identity is malformed or unverified");
  if (lock.entries.some((entry) => !idPattern.test(entry.id) || !semverPattern.test(entry.apiVersion) || !semverPattern.test(entry.implementationVersion) || !digestPattern.test(entry.digest))) fail("lock_mismatch", "lock contains malformed or unverified entries");
};
function validateRandomness(randomness: RandomInput[], limits: ResolverExecutionLimits): void {
  if (!Array.isArray(randomness)) fail("malformed_input", "randomness must be an array"); const ids = new Set<string>(); let total = 0;
  for (const item of randomness) {
    if (!item || !idPattern.test(item.requestId) || ids.has(item.requestId) || !["die", "pool", "draw"].includes(item.kind)) fail("malformed_input", "randomness contains a duplicate or unsupported request"); ids.add(item.requestId);
    if (!Number.isInteger(item.count) || item.count <= 0 || item.count > limits.maxRandomValues || !Array.isArray(item.values) || item.values.length !== item.count) fail("malformed_input", "randomness does not match its request");
    if (item.kind !== "draw" && (!Number.isInteger(item.sides) || item.sides < 2 || item.sides > 10000)) fail("malformed_input", "die and pool requests require bounded sides");
    if (item.kind === "draw" && item.sides !== undefined) fail("malformed_input", "draw requests cannot specify sides");
    if (item.values.some((value) => !Number.isInteger(value) || (item.kind !== "draw" && (value < 1 || value > item.sides!)) || (item.kind === "draw" && value < 0)) || (item.kind === "draw" && new Set(item.values).size !== item.values.length)) fail("malformed_input", "randomness contains invalid results"); total += item.values.length;
  }
  if (total > limits.maxRandomValues) fail("budget_exceeded", "randomness exceeds execution bounds");
}
function validateInput(input: ResolutionInput, limits: ResolverExecutionLimits): void {
  if (!input || !idPattern.test(input.operationId) || !idPattern.test(input.campaignId) || !idPattern.test(input.principalId) || !input.logicalTime || !Number.isFinite(Date.parse(input.logicalTime))) fail("malformed_input", "operation, campaign, principal and logical time are required");
  try { if (canonicalJson(input.state).length > limits.maxStateBytes || canonicalJson(input.input).length > limits.maxInputBytes) fail("budget_exceeded", "input exceeds execution bounds"); } catch (error) { if ((error as { code?: string }).code === "budget_exceeded") throw error; fail("malformed_input", (error as Error).message); }
  validateRandomness(input.randomness, limits);
}
function containsNestedVisibility(value: unknown): boolean { if (!value || typeof value !== "object") return false; if (Array.isArray(value)) return value.some(containsNestedVisibility); return Object.entries(value).some(([key, child]) => key === "visibility" || containsNestedVisibility(child)); }
function validateOutput(output: ResolverOutput, input: ResolutionInput, limits: ResolverExecutionLimits): void {
  if (!output || !Array.isArray(output.outcomes) || !Array.isArray(output.effects) || !Array.isArray(output.decisions)) fail("invalid_output", "resolver output shape is invalid");
  if (output.outcomes.length > limits.maxOutcomes || output.effects.length > limits.maxEffects || output.decisions.length > limits.maxDecisions) fail("budget_exceeded", "resolver output exceeds execution bounds");
  const decisions = new Set<string>(); for (const decision of output.decisions) { if (!idPattern.test(decision.id) || decisions.has(decision.id) || !["public", "gm", "private"].includes(decision.visibility) || containsNestedVisibility(decision.data)) fail("invalid_output", "decision identity or visibility is invalid"); decisions.add(decision.id); }
  const effects = new Set<string>(); for (const effect of output.effects) { if (!idPattern.test(effect.effectId) || effects.has(effect.effectId) || !idPattern.test(effect.handler) || !idPattern.test(effect.targetId) || !["public", "gm", "private"].includes(effect.visibility) || containsNestedVisibility(effect.payload)) fail("invalid_output", "effect identity, reference or visibility is invalid"); effects.add(effect.effectId); }
  for (const outcome of output.outcomes) if (!idPattern.test(outcome.kind) || !["public", "gm", "private"].includes(outcome.visibility) || containsNestedVisibility(outcome.data)) fail("invalid_output", "outcome kind or visibility is invalid");
  if (output.continuation && (!idPattern.test(output.continuation.continuationId) || !Number.isInteger(output.continuation.step) || output.continuation.step < 1 || !["command", "timeout", "reaction"].includes(output.continuation.resumeOn) || !Number.isFinite(Date.parse(output.continuation.expiresAt)) || Date.parse(output.continuation.expiresAt) <= Date.parse(input.logicalTime))) fail("invalid_output", "continuation identity, step or expiry is invalid");
  try { if (canonicalJson(output).length > limits.maxTranscriptBytes) fail("budget_exceeded", "resolver output exceeds transcript bounds"); } catch (error) { if ((error as { code?: string }).code === "budget_exceeded") throw error; fail("invalid_output", (error as Error).message); }
}
const withoutDigest = (transcript: ResolutionTranscript): Omit<ResolutionTranscript, "digest"> => { const { digest: _digest, ...base } = transcript; return base; };
export function executeResolver(resolver: Resolver, input: ResolutionInput, lock: CapabilityLock, digest: (canonicalTranscript: string) => `sha256:${string}` = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`, limits: ResolverExecutionLimits = DEFAULT_LIMITS): ResolverExecutionResult {
  checkResolverLock(resolver.ref, lock, input.campaignId); validateInput(input, limits); const output = resolver.resolve(structuredClone(input)); validateOutput(output, input, limits);
  const transcriptBase = { transcriptVersion: 1 as const, resolver: resolver.ref, input: { operationId: input.operationId, campaignId: input.campaignId, principalId: input.principalId, logicalTime: input.logicalTime, state: input.state, input: input.input }, randomness: input.randomness, decisions: output.decisions, outcomes: output.outcomes, effects: output.effects, ...(output.continuation ? { continuation: output.continuation } : {}) };
  const transcript = { ...transcriptBase, digest: digest(canonicalJson(transcriptBase)) } as ResolutionTranscript; if (!digestPattern.test(transcript.digest)) fail("invalid_output", "transcript digest is not a SHA-256 digest"); if (canonicalJson(transcript).length > limits.maxTranscriptBytes) fail("budget_exceeded", "transcript exceeds execution bounds");
  return { transcript, replay: (replayInput, storedTranscript) => { if (storedTranscript && (storedTranscript.digest !== digest(canonicalJson(withoutDigest(storedTranscript))) || !digestPattern.test(storedTranscript.digest))) fail("transcript_mismatch", "stored transcript integrity verification failed"); const replayed = executeResolver(resolver, replayInput, lock, digest, limits).transcript; if (canonicalJson(withoutDigest(replayed)) !== canonicalJson(withoutDigest(transcript))) fail("transcript_mismatch", "replay transcript differs"); if (storedTranscript && canonicalJson(withoutDigest(storedTranscript)) !== canonicalJson(withoutDigest(replayed))) fail("transcript_mismatch", "stored transcript differs from replay"); } };
}
export function createTranscriptStore(): TranscriptStore {
  const project = (transcript: ResolutionTranscript, role: "public" | "gm"): TranscriptProjection => ({ role, transcript: structuredClone({ transcriptVersion: transcript.transcriptVersion, resolver: transcript.resolver, input: { operationId: transcript.input.operationId, campaignId: transcript.input.campaignId, logicalTime: transcript.input.logicalTime }, randomness: role === "gm" ? transcript.randomness : transcript.randomness.filter((item) => item.visibility === "public"), decisions: transcript.decisions.filter((item) => item.visibility === "public" || (role === "gm" && item.visibility !== "private")), outcomes: transcript.outcomes.filter((item) => item.visibility === "public" || (role === "gm" && item.visibility !== "private")), effects: transcript.effects.filter((item) => item.visibility === "public" || (role === "gm" && item.visibility !== "private")), ...(transcript.continuation && role === "gm" ? { continuation: transcript.continuation } : {}) }) });
  return { putPrivate: () => undefined, project };
}
export function resolverManifest(ref: ResolverRef): CapabilityManifest { return { formatVersion: 2, id: ref.id, api: { id: ref.id, apiVersion: ref.apiVersion }, implementationVersion: ref.implementationVersion, digest: ref.digest, kind: "resolver", provides: [{ id: ref.id, apiVersion: ref.apiVersion }], requires: [], trust: "bundled-trusted" }; }
