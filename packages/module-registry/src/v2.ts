import type {
  CapabilityConflict,
  CapabilityDependency,
  CapabilityDigest,
  CapabilityLock,
  CapabilityManifest,
  CapabilityId,
  LockedCapability,
  SemVer,
} from "@potomac/contracts";

export type ResolutionStatus = "resolved" | "missing" | "incompatible" | "conflict" | "digestMismatch" | "cycle";
export type ResolutionReport = {
  status: ResolutionStatus;
  missing: CapabilityDependency[];
  conflicts: CapabilityConflict[];
  selected: LockedCapability[];
  diagnostics: string[];
  lock?: CapabilityLock;
};

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const parseVersion = (value: string): [number, number, number] | undefined => {
  const match = SEMVER.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};
const compare = (a: string, b: string): number => {
  const left = parseVersion(a)!, right = parseVersion(b)!;
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};
const satisfies = (version: string, range: string): boolean => {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (range === "*" || range === "") return true;
  const exact = range.match(/^=(\d+\.\d+\.\d+)$/)?.[1] ?? (SEMVER.test(range) ? range : undefined);
  if (exact) return version === exact;
  const caret = range.match(/^\^(\d+\.\d+\.\d+)$/)?.[1];
  if (caret) { const base = parseVersion(caret)!; return parsed[0] === base[0] && compare(version, caret) >= 0; }
  const tilde = range.match(/^~(\d+\.\d+\.\d+)$/)?.[1];
  if (tilde) { const base = parseVersion(tilde)!; return parsed[0] === base[0] && parsed[1] === base[1] && compare(version, tilde) >= 0; }
  return false;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  const manifest = value as Partial<CapabilityManifest>;
  if (!manifest || manifest.formatVersion !== 2 || typeof manifest.id !== "string" || !ID.test(manifest.id) ||
      !manifest.api || manifest.api.id !== manifest.id || !SEMVER.test(manifest.api.apiVersion) ||
      typeof manifest.implementationVersion !== "string" || !SEMVER.test(manifest.implementationVersion) ||
      typeof manifest.digest !== "string" || !DIGEST.test(manifest.digest) ||
      !["module", "library", "resolver", "entity", "ui"].includes(manifest.kind ?? "") ||
      !["bundled-trusted", "declarative-untrusted", "reviewed-handler"].includes(manifest.trust ?? "") ||
      !Array.isArray(manifest.provides) || !Array.isArray(manifest.requires)) throw new Error("invalid_manifest");
  for (const ref of manifest.provides) if (!ref || typeof ref.id !== "string" || !ID.test(ref.id) || typeof ref.apiVersion !== "string" || !SEMVER.test(ref.apiVersion)) throw new Error("invalid_manifest_reference");
  for (const ref of manifest.requires) if (!ref || typeof ref.id !== "string" || !ID.test(ref.id)) throw new Error("invalid_manifest_reference");
  for (const dep of manifest.requires) if (typeof dep.apiRange !== "string" || typeof dep.optional !== "boolean") throw new Error("invalid_dependency");
  return structuredClone(manifest as CapabilityManifest);
}

export class CapabilityRegistry {
  private readonly manifests = new Map<CapabilityId, CapabilityManifest[]>();
  register(value: unknown, verifyDigest: (manifest: CapabilityManifest) => boolean = () => true): void {
    const manifest = validateCapabilityManifest(value);
    if (!verifyDigest(manifest)) throw new Error("digest_mismatch");
    const existing = this.manifests.get(manifest.id) ?? [];
    if (existing.some((item) => item.implementationVersion === manifest.implementationVersion && item.digest === manifest.digest)) throw new Error("duplicate_capability");
    this.manifests.set(manifest.id, [...existing, manifest].sort((a, b) => compare(b.implementationVersion, a.implementationVersion)));
  }
  list(): CapabilityManifest[] { return [...this.manifests.values()].flat().map((manifest) => structuredClone(manifest)); }
  resolve(campaignId: string, rootId: CapabilityId, rootVersion: SemVer, source: LockedCapability["source"] = "bundled"): ResolutionReport {
    const root = this.manifests.get(rootId)?.find((item) => item.implementationVersion === rootVersion);
    if (!root) return { status: "missing", missing: [{ id: rootId, apiRange: `=${rootVersion}`, optional: false }], conflicts: [], selected: [], diagnostics: ["missing_root"] };
    const selected = new Map<string, LockedCapability>(); const visiting = new Set<string>();
    const missing: CapabilityDependency[] = []; const conflicts: CapabilityConflict[] = []; const diagnostics: string[] = [];
    const visit = (manifest: CapabilityManifest, optional: boolean): void => {
      const key = `${manifest.id}@${manifest.implementationVersion}`;
      if (visiting.has(key)) { diagnostics.push(`cycle:${key}`); return; }
      if (selected.has(manifest.id)) return;
      visiting.add(key);
      for (const conflict of manifest.conflicts ?? []) if ([...selected.values()].some((item) => item.id === conflict.id && (!conflict.apiRange || satisfies(item.apiVersion, conflict.apiRange)))) conflicts.push(conflict);
      selected.set(manifest.id, { id: manifest.id, apiVersion: manifest.api.apiVersion, implementationVersion: manifest.implementationVersion, digest: manifest.digest, source, optional });
      for (const dependency of manifest.requires) {
        const candidates = this.manifests.get(dependency.id)?.filter((item) => satisfies(item.api.apiVersion, dependency.apiRange));
        if (!candidates?.length) { if (!dependency.optional) missing.push(dependency); continue; }
        visit(candidates[0], dependency.optional);
      }
      visiting.delete(key);
    };
    visit(root, false);
    for (const manifest of [...this.manifests.values()].flat().filter((item) => selected.has(item.id))) {
      for (const conflict of manifest.conflicts ?? []) if ([...selected.values()].some((item) => item.id === conflict.id && (!conflict.apiRange || satisfies(item.apiVersion, conflict.apiRange)))) conflicts.push(conflict);
    }
    const status: ResolutionStatus = diagnostics.some((item) => item.startsWith("cycle:")) ? "cycle" : conflicts.length ? "conflict" : missing.length ? "missing" : "resolved";
    const entries = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
    const lock = status === "resolved" ? { lockVersion: 1 as const, campaignId, entries, rootModule: { id: root.id, version: root.implementationVersion, digest: root.digest } } : undefined;
    return { status, missing, conflicts: [...new Map(conflicts.map((conflict) => [`${conflict.id}:${conflict.reason}`, conflict])).values()], selected: entries, diagnostics, lock: lock ? freeze(lock) : undefined };
  }
}

export function validateCapabilityLock(lock: unknown, digestExists: (digest: CapabilityDigest) => boolean): CapabilityLock {
  const value = lock as CapabilityLock;
  if (!value || value.lockVersion !== 1 || typeof value.campaignId !== "string" || !Array.isArray(value.entries) || !value.rootModule) throw new Error("invalid_lock");
  const entries = value.entries.map((entry) => { if (!entry.id || !SEMVER.test(entry.apiVersion) || !SEMVER.test(entry.implementationVersion) || !DIGEST.test(entry.digest) || !digestExists(entry.digest)) throw new Error("lock_digest_mismatch"); return entry; });
  if (!entries.some((entry) => entry.id === value.rootModule.id && entry.implementationVersion === value.rootModule.version && entry.digest === value.rootModule.digest)) throw new Error("lock_root_missing");
  return freeze(structuredClone({ ...value, entries }));
}
