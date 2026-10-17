# ADR-0019: Resolve extension capabilities into exact campaign lockfiles

- Status: Proposed
- Date: 2026-10-17

## Context

The V1 `ModuleRegistry` is keyed by module ID, rejects duplicate IDs and has no digest/dependency lock. Host campaigns and actors already preserve exact module ID/version, and backup restore rejects unavailable exact versions. V2 needs optional capabilities, conflicts, transitive dependencies and parallel installations without making replay or restore depend on current package availability.

## Options considered

1. Runtime semver resolution: convenient but nondeterministic for replay and unsafe for archives.
2. One global implementation per capability: simple but leaks compatibility across campaigns.
3. Exact per-campaign lockfile containing API version, implementation version, digest and transitive closure: more metadata, but reproducible and compatible with parallel versions.

## Decision

Propose option 3. Registration is staged and publishes only after manifest, digest, API, dependency and conflict validation. A lock never silently re-resolves. V1 modules remain behind a V1 adapter and exact existing campaign pins; they are not coerced into V2.

## Consequences

Backups must carry the lock closure and restore must fail closed on missing/mismatched digests. Garbage collection must retain capabilities referenced by campaigns, archives or pending operations. A signing/trust-root policy remains unresolved and blocks final architecture.

## Relationship to execution and extension decisions

The lock selects the exact resolver/effect-handler implementations used by ADR-0020 and the exact entity/UI descriptors used by ADR-0021. It does not grant those implementations permission to write state; the host execution boundary and contribution authorization remain mandatory. The separate PR #130 spike provides no evidence for lock resolution, dependency selection or digest provenance.

## Follow-up / validation

Implement manifest/lock validators and tests for parallel versions, optional missing dependencies, conflicts, digest mismatch, staged failure, V1 loading and exact backup restore before accepting this ADR.
