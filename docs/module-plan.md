# Potomac Extension Platform V2 — Working Plan

The V2 foundation in issue #132 keeps V1 manifests/actions, exact campaign pins, host authorization and redaction, offline receipts/proposals, backup compatibility and historical archive QA intact. It adds typed capability contracts, runtime manifest validation, parallel registration, and pure exact lock resolution.

This PR does not execute module code, add action/reaction/effect execution, change backup archives, add UI, or provide a third-party executable sandbox. A Node worker is not a security boundary.

## Implemented foundation

- `packages/contracts`: typed V2 capability manifest, dependency, digest, and immutable lock contracts.
- `packages/module-registry`: staged validation, digest verification hook, parallel implementation registration, deterministic transitive resolution, optional dependency handling, conflict/cycle/missing rejection, and exact lock validation.
- `ModuleRegistry` V1 remains unchanged and exported alongside the V2 registry.

Campaign locks contain exact API version, implementation version, digest, source and optionality for every selected capability. A lock never silently re-resolves. Registration requires an explicit artifact-verification callback; `bundled-trusted` is metadata about deployment trust, not proof that bytes match a digest. Archive restore can use `validateCapabilityLock` with the registered manifest set and verifier to fail closed on unavailable, altered, duplicate, extra or mismatched dependencies.

Supported dependency ranges are deliberately bounded to `*`, exact, `=x.y.z`, `^x.y.z`, and `~x.y.z`. Caret ranges follow SemVer 0.x rules (`^0.2.3` stays below `0.3.0`; `^0.0.3` stays below `0.0.4`); unsupported syntax is rejected. A capability identity is `(id, implementationVersion)` and duplicate registrations are rejected even when their digests differ.

Validation evidence for this revision: the focused registry suite passes 5/5; direct TypeScript compilation of the contracts and registry sources passes; syntax and `git diff --check` pass. The repository `pnpm.cmd` hangs even on `pnpm --version` (bounded at 5 seconds), and the bundled repository-wide TypeScript invocation reports existing JSX/import configuration errors outside this package. No project-wide build pass is claimed.

## Remaining phases

Resolver/effect execution, host transaction handlers, reactions, extension entities/workflows, UI contributions, third-party isolation, migrations and backup closure remain future PRs. The V1 production execution path is intentionally unchanged.
