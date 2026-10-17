import { strict as assert } from "node:assert";
import test from "node:test";
import { CapabilityRegistry, validateCapabilityLock, validateCapabilityManifest } from "./v2.js";

const digest = (n: string) => `sha256:${n.repeat(64).slice(0, 64)}` as const;
const manifest = (id: string, version: `${number}.${number}.${number}`, requires = [], conflicts = []) => ({ formatVersion: 2 as const, id, api: { id, apiVersion: "1.0.0" as const }, implementationVersion: version, digest: digest(id[0]), kind: "module" as const, provides: [{ id, apiVersion: "1.0.0" as const }], requires, conflicts, trust: "declarative-untrusted" as const });

test("validates manifests and registers parallel implementations", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.root", "1.0.0"));
  registry.register(manifest("example.root", "2.0.0"));
  assert.equal(registry.list().length, 2);
  assert.throws(() => validateCapabilityManifest({}), /invalid_manifest/);
});

test("resolves deterministic exact locks and ignores missing optional dependencies", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.root", "1.0.0", [{ id: "example.optional", apiRange: "^1.0.0", optional: true }]));
  const report = registry.resolve("campaign-1", "example.root", "1.0.0");
  assert.equal(report.status, "resolved");
  assert.deepEqual(report.lock?.entries.map((entry) => entry.id), ["example.root"]);
  assert.equal(registry.resolve("campaign-1", "example.root", "1.0.0").lock?.rootModule.digest, report.lock?.rootModule.digest);
});

test("rejects required missing dependencies, conflicts, cycles, and lock digest mismatches", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.a", "1.0.0", [{ id: "example.missing", apiRange: "^1.0.0", optional: false }]));
  assert.equal(registry.resolve("c", "example.a", "1.0.0").status, "missing");
  const cycle = new CapabilityRegistry();
  cycle.register(manifest("example.cycle-a", "1.0.0", [{ id: "example.cycle-b", apiRange: "=1.0.0", optional: false }]));
  cycle.register(manifest("example.cycle-b", "1.0.0", [{ id: "example.cycle-a", apiRange: "=1.0.0", optional: false }]));
  assert.equal(cycle.resolve("c", "example.cycle-a", "1.0.0").status, "cycle");
  const conflict = new CapabilityRegistry();
  conflict.register(manifest("example.conflict-a", "1.0.0", [{ id: "example.conflict-b", apiRange: "=1.0.0", optional: false }]));
  conflict.register(manifest("example.conflict-b", "1.0.0", [], [{ id: "example.conflict-a", apiRange: "=1.0.0", reason: "incompatible" }]));
  assert.equal(conflict.resolve("c", "example.conflict-a", "1.0.0").status, "conflict");
  assert.throws(() => validateCapabilityLock({ lockVersion: 1, campaignId: "c", entries: [{ id: "example.a", apiVersion: "1.0.0", implementationVersion: "1.0.0", digest: digest("z"), source: "archive", optional: false }], rootModule: { id: "example.a", version: "1.0.0", digest: digest("z") } }, () => false), /lock_digest_mismatch/);
});
