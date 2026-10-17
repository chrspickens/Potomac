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
const incrementUpperBound = (base: [number, number, number], range: string): [number, number, number] | undefined => {
  if (range.startsWith("^")) return base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
  if (range.startsWith("~")) return [base[0], base[1] + 1, 0];
  return undefined;
};
const compareParts = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const supportedRange = (range: string): boolean => {
  if (range === "*" || range === "") return true;
  return /^(?:=|\^|~)?\d+\.\d+\.\d+$/.test(range);
};
const satisfies = (version: string, range: string): boolean => {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (range === "*" || range === "") return true;
  const exact = range.match(/^=(\d+\.\d+\.\d+)$/)?.[1] ?? (SEMVER.test(range) ? range : undefined);
  if (exact) return version === exact;
  const caret = range.match(/^\^(\d+\.\d+\.\d+)$/)?.[1];
  if (caret) { const base = parseVersion(caret)!; const upper = incrementUpperBound(base, range)!; return compare(version, caret) >= 0 && compareParts(parsed, upper) < 0; }
  const tilde = range.match(/^~(\d+\.\d+\.\d+)$/)?.[1];
  if (tilde) { const base = parseVersion(tilde)!; const upper = incrementUpperBound(base, range)!; return compare(version, tilde) >= 0 && compareParts(parsed, upper) < 0; }
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
  const providedIds = new Set<string>();
  for (const ref of manifest.provides) {
    if (!ref || typeof ref.id !== "string" || !ID.test(ref.id) || typeof ref.apiVersion !== "string" || !SEMVER.test(ref.apiVersion) || (ref.optional !== undefined && typeof ref.optional !== "boolean") || providedIds.has(ref.id)) throw new Error("invalid_manifest_reference");
    providedIds.add(ref.id);
  }
  for (const ref of manifest.requires) if (!ref || typeof ref.id !== "string" || !ID.test(ref.id) || (ref.compatibleWith !== undefined && (!Array.isArray(ref.compatibleWith) || ref.compatibleWith.some((id) => typeof id !== "string" || !ID.test(id))))) throw new Error("invalid_manifest_reference");
  for (const dep of manifest.requires) if (typeof dep.apiRange !== "string" || !supportedRange(dep.apiRange) || typeof dep.optional !== "boolean") throw new Error("invalid_dependency_range");
  for (const conflict of manifest.conflicts ?? []) if (!conflict || typeof conflict.id !== "string" || !ID.test(conflict.id) || typeof conflict.reason !== "string" || (conflict.apiRange !== undefined && !supportedRange(conflict.apiRange))) throw new Error("invalid_conflict");
  return structuredClone(manifest as CapabilityManifest);
}

export class CapabilityRegistry {
  private readonly manifests = new Map<CapabilityId, CapabilityManifest[]>();
  register(value: unknown, verifyDigest: (manifest: CapabilityManifest) => boolean): void {
    const manifest = validateCapabilityManifest(value);
    if (!verifyDigest(manifest)) throw new Error("digest_mismatch");
    const existing = this.manifests.get(manifest.id) ?? [];
    if (existing.some((item) => item.implementationVersion === manifest.implementationVersion)) throw new Error("duplicate_capability_identity");
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
        if (selected.has(dependency.id) && !satisfies(selected.get(dependency.id)!.apiVersion, dependency.apiRange)) { diagnostics.push(`incompatible:${dependency.id}:${dependency.apiRange}`); continue; }
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
    const status: ResolutionStatus = diagnostics.some((item) => item.startsWith("cycle:")) ? "cycle" : diagnostics.some((item) => item.startsWith("incompatible:")) ? "incompatible" : conflicts.length ? "conflict" : missing.length ? "missing" : "resolved";
    const entries = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
    const lock = status === "resolved" ? { lockVersion: 1 as const, campaignId, entries, rootModule: { id: root.id, version: root.implementationVersion, digest: root.digest } } : undefined;
    return { status, missing, conflicts: [...new Map(conflicts.map((conflict) => [`${conflict.id}:${conflict.reason}`, conflict])).values()], selected: entries, diagnostics, lock: lock ? freeze(lock) : undefined };
  }
}

export function validateCapabilityLock(lock: unknown, manifests: Iterable<CapabilityManifest>, verifyDigest: (manifest: CapabilityManifest) => boolean): CapabilityLock {
  const value = lock as CapabilityLock;
  if (!value || value.lockVersion !== 1 || typeof value.campaignId !== "string" || !Array.isArray(value.entries) || !value.rootModule) throw new Error("invalid_lock");
  const available = new Map([...manifests].map((manifest) => [`${manifest.id}@${manifest.implementationVersion}`, manifest]));
  const entries = value.entries.map((entry) => {
    if (!entry || !ID.test(entry.id) || !SEMVER.test(entry.apiVersion) || !SEMVER.test(entry.implementationVersion) || !DIGEST.test(entry.digest) || !["bundled", "installed", "archive"].includes(entry.source) || typeof entry.optional !== "boolean") throw new Error("invalid_lock_entry");
    const manifest = available.get(`${entry.id}@${entry.implementationVersion}`);
    if (!manifest || manifest.api.apiVersion !== entry.apiVersion || manifest.digest !== entry.digest || !verifyDigest(manifest)) throw new Error("lock_digest_mismatch");
    return entry;
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("lock_duplicate_entry");
  if (!DIGEST.test(value.rootModule.digest) || !entries.some((entry) => entry.id === value.rootModule.id && entry.implementationVersion === value.rootModule.version && entry.digest === value.rootModule.digest)) throw new Error("lock_root_missing");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) throw new Error("lock_cycle");
    if (visited.has(id)) return;
    const entry = byId.get(id); const manifest = entry && available.get(`${entry.id}@${entry.implementationVersion}`);
    if (!entry || !manifest) throw new Error("lock_missing_closure");
    visiting.add(id);
    for (const dependency of manifest.requires) {
      const selected = byId.get(dependency.id);
      if (!selected) { if (!dependency.optional) throw new Error("lock_missing_closure"); continue; }
      if (!satisfies(selected.apiVersion, dependency.apiRange)) throw new Error("lock_incompatible_closure");
      walk(dependency.id);
    }
    visiting.delete(id); visited.add(id);
  };
  walk(value.rootModule.id);
  if (visited.size !== entries.length) throw new Error("lock_extra_entry");
  return freeze(structuredClone({ ...value, entries }));
}
