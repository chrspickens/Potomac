import { strict as assert } from "node:assert";
import test from "node:test";
import { createTranscriptStore, executeResolver, resolverManifest } from "./resolver.ts";

const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const hash = (value) => digest((value.length.toString(16).padStart(2, "0"))[0]);
const ref = (id, version = "1.0.0", d = digest(id[0])) => ({ id, apiVersion: "1.0.0", implementationVersion: version, digest: d });
const lockFor = (...refs) => ({ lockVersion: 1, campaignId: "campaign-1", entries: refs.map((item) => ({ id: item.id, apiVersion: item.apiVersion, implementationVersion: item.implementationVersion, digest: item.digest, source: "bundled", optional: false })), rootModule: { id: refs[0].id, version: refs[0].implementationVersion, digest: refs[0].digest } });
const input = (values = [17]) => ({ operationId: "op-1", campaignId: "campaign-1", principalId: "gm-1", logicalTime: "2026-10-17T00:00:00.000Z", state: { secret: "hidden", score: 2 }, input: { difficulty: 10 }, randomness: [{ requestId: "roll-1", kind: "pool", count: values.length, sides: 20, values }] });
const d20 = { ref: ref("example.d20"), resolve: (request) => ({ outcomes: [{ kind: "check", data: { success: request.randomness[0].values[0] >= request.input.difficulty }, visibility: "public" }], effects: [], decisions: [{ id: "private-thought", data: { secret: request.state.secret }, visibility: "private" }] }) };
const pool = { ref: ref("example.pool"), resolve: (request) => ({ outcomes: [{ kind: "successes", data: { count: request.randomness[0].values.filter((value) => value >= 5).length }, visibility: "public" }], effects: [], decisions: [] }) };

test("registers and selects two resolvers in one module without Core branches", () => {
  const moduleLock = lockFor(d20.ref, pool.ref);
  assert.equal(resolverManifest(d20.ref).kind, "resolver");
  assert.equal(executeResolver(d20, input(), moduleLock, hash).transcript.resolver.id, "example.d20");
  assert.equal(executeResolver(pool, input([5, 2, 6]), moduleLock, hash).transcript.outcomes[0].kind, "successes");
});

test("replays deterministically and detects changed host inputs", () => {
  const result = executeResolver(d20, input(), lockFor(d20.ref), hash);
  assert.doesNotThrow(() => result.replay(input()));
  assert.throws(() => result.replay(input([18])), /replay transcript differs/);
  assert.throws(() => executeResolver({ ...d20, ref: ref("example.d20", "1.0.0", digest("b")) }, input(), lockFor(d20.ref), hash), /resolver is not in the exact campaign lock/);
});

test("rejects malformed randomness and bounded output", () => {
  assert.throws(() => executeResolver(d20, { ...input(), randomness: [{ ...input().randomness[0], count: 2, values: [1] }] }, lockFor(d20.ref), hash), /host randomness/);
  assert.throws(() => executeResolver({ ref: d20.ref, resolve: () => ({ outcomes: [], effects: Array.from({ length: 65 }, (_, index) => ({ effectId: String(index), handler: "resource.delta", targetId: "actor-1", payload: 1, visibility: "public" })), decisions: [] }) }, input(), lockFor(d20.ref), hash), /output exceeds execution bounds/);
});

test("keeps private state, randomness and decisions out of public projections", () => {
  const transcript = executeResolver(d20, input(), lockFor(d20.ref), hash).transcript;
  const store = createTranscriptStore();
  const publicView = store.project(transcript, "public").transcript;
  const gmView = store.project(transcript, "gm").transcript;
  assert.equal(publicView.randomness.length, 0);
  assert.equal(publicView.decisions.length, 0);
  assert.equal(publicView.input.state, undefined);
  assert.equal(gmView.randomness.length, 1);
  assert.equal(gmView.decisions.length, 0);
});
