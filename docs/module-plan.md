# Potomac Extension Platform V2 — Working Plan

The V2 foundation in issue #132 keeps V1 manifests/actions, exact campaign pins, host authorization and redaction, offline receipts/proposals, backup compatibility and historical archive QA intact. It adds typed capability contracts, runtime manifest validation, parallel registration, and pure exact lock resolution.

This PR does not execute module code, add action/reaction/effect execution, change backup archives, add UI, or provide a third-party executable sandbox. A Node worker is not a security boundary.

## Implemented foundation

- `packages/contracts`: typed V2 capability manifest, dependency, digest, and immutable lock contracts.
- `packages/module-registry`: staged validation, digest verification hook, parallel implementation registration, deterministic transitive resolution, optional dependency handling, conflict/cycle/missing rejection, and exact lock validation.
- `ModuleRegistry` V1 remains unchanged and exported alongside the V2 registry.

Campaign locks contain exact API version, implementation version, digest, source and optionality for every selected capability. A lock never silently re-resolves; archive restore can use `validateCapabilityLock` to fail closed on unavailable or mismatched digests.

## Remaining phases

Resolver/effect execution, host transaction handlers, reactions, extension entities/workflows, UI contributions, third-party isolation, migrations and backup closure remain future PRs. The V1 production execution path is intentionally unchanged.
