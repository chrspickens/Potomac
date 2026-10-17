import { strict as assert } from "node:assert";
import test from "node:test";
import { CapabilityRegistry, validateCapabilityLock, validateCapabilityManifest } from "./v2.ts";

const digest = (n) => `sha256:${n.repeat(64).slice(0, 64)}`;
const manifest = (id, version, requires = [], conflicts = []) => ({ formatVersion: 2, id, api: { id, apiVersion: "1.0.0" }, implementationVersion: version, digest: digest(id[0]), kind: "module", provides: [{ id, apiVersion: "1.0.0" }], requires, conflicts, trust: "declarative-untrusted" });
const verify = () => true;

test("validates manifests, trust metadata and parallel implementations", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.root", "1.0.0"), verify);
  registry.register(manifest("example.root", "2.0.0"), verify);
  assert.equal(registry.list().length, 2);
  assert.throws(() => registry.register({ ...manifest("example.root", "1.0.0"), digest: digest("b") }, verify), /duplicate_capability_identity/);
  assert.throws(() => validateCapabilityManifest({}), /invalid_manifest/);
  assert.throws(() => validateCapabilityManifest({ ...manifest("example.bad", "1.0.0"), trust: "unknown" }), /invalid_manifest/);
});

test("resolves deterministic exact locks and ignores missing optional dependencies", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.root", "1.0.0", [{ id: "example.optional", apiRange: "^1.0.0", optional: true }]), verify);
  const report = registry.resolve("campaign-1", "example.root", "1.0.0");
  assert.equal(report.status, "resolved");
  assert.deepEqual(report.lock?.entries.map((entry) => entry.id), ["example.root"]);
  assert.equal(registry.resolve("campaign-1", "example.root", "1.0.0").lock?.rootModule.digest, report.lock?.rootModule.digest);
});

test("rejects required missing dependencies, cycles, conflicts and lock digest mismatches", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.a", "1.0.0", [{ id: "example.missing", apiRange: "^1.0.0", optional: false }]), verify);
  assert.equal(registry.resolve("c", "example.a", "1.0.0").status, "missing");
  const cycle = new CapabilityRegistry();
  cycle.register(manifest("example.cycle-a", "1.0.0", [{ id: "example.cycle-b", apiRange: "=1.0.0", optional: false }]), verify);
  cycle.register(manifest("example.cycle-b", "1.0.0", [{ id: "example.cycle-a", apiRange: "=1.0.0", optional: false }]), verify);
  assert.equal(cycle.resolve("c", "example.cycle-a", "1.0.0").status, "cycle");
  const conflict = new CapabilityRegistry();
  conflict.register(manifest("example.conflict-a", "1.0.0", [{ id: "example.conflict-b", apiRange: "=1.0.0", optional: false }]), verify);
  conflict.register(manifest("example.conflict-b", "1.0.0", [], [{ id: "example.conflict-a", apiRange: "=1.0.0", reason: "incompatible" }]), verify);
  assert.equal(conflict.resolve("c", "example.conflict-a", "1.0.0").status, "conflict");
  assert.throws(() => validateCapabilityLock({ lockVersion: 1, campaignId: "c", entries: [{ id: "example.a", apiVersion: "1.0.0", implementationVersion: "1.0.0", digest: digest("b"), source: "archive", optional: false }], rootModule: { id: "example.a", version: "1.0.0", digest: digest("b") } }, [manifest("example.a", "1.0.0")], () => false), /lock_digest_mismatch/);
});

test("rejects incompatible diamond constraints and unsupported ranges", () => {
  const registry = new CapabilityRegistry();
  registry.register(manifest("example.root", "1.0.0", [{ id: "example.left", apiRange: "=1.0.0", optional: false }, { id: "example.right", apiRange: "=1.0.0", optional: false }]), verify);
  registry.register(manifest("example.left", "1.0.0", [{ id: "example.shared", apiRange: "=1.0.0", optional: false }]), verify);
  registry.register(manifest("example.right", "1.0.0", [{ id: "example.shared", apiRange: "=2.0.0", optional: false }]), verify);
  registry.register(manifest("example.shared", "1.0.0"), verify);
  assert.equal(registry.resolve("c", "example.root", "1.0.0").status, "incompatible");
  assert.throws(() => registry.register(manifest("example.bad", "1.0.0", [{ id: "example.shared", apiRange: "^1.2", optional: false }]), verify), /invalid_dependency_range/);
});

test("rejects tampered locks and missing or extra closure entries", () => {
  const registry = new CapabilityRegistry();
  const root = manifest("example.lock-root", "1.0.0", [{ id: "example.lock-dep", apiRange: "=1.0.0", optional: false }]);
  const dep = manifest("example.lock-dep", "1.0.0");
  registry.register(root, verify); registry.register(dep, verify);
  const lock = registry.resolve("c", "example.lock-root", "1.0.0").lock;
  assert.equal(validateCapabilityLock(lock, registry.list(), verify).campaignId, "c");
  assert.throws(() => validateCapabilityLock({ ...lock, entries: lock.entries.slice(0, 1) }, registry.list(), verify), /lock_root_missing/);
  const extra = manifest("example.extra", "1.0.0");
  assert.throws(() => validateCapabilityLock({ ...lock, entries: [...lock.entries, { ...lock.entries[0], id: extra.id, digest: extra.digest }] }, [...registry.list(), extra], verify), /lock_extra_entry/);
  const tampered = { ...lock, entries: lock.entries.map((entry) => entry.id === "example.lock-dep" ? { ...entry, digest: digest("b") } : entry) };
  assert.throws(() => validateCapabilityLock(tampered, registry.list(), verify), /lock_digest_mismatch/);
});
