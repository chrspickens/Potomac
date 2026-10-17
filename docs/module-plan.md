# Potomac Extension Platform V2 — Working Plan

The V2 foundation in issue #132 keeps V1 manifests/actions, exact campaign pins, host authorization and redaction, offline receipts/proposals, backup compatibility and historical archive QA intact. It adds typed capability contracts, runtime manifest validation, parallel registration, and pure exact lock resolution.

This PR does not execute module code, add action/reaction/effect execution, change backup archives, add UI, or provide a third-party executable sandbox. A Node worker is not a security boundary.

## Implemented foundation

- `packages/contracts`: typed V2 capability manifest, dependency, digest, and immutable lock contracts.
- `packages/module-registry`: staged validation, digest verification hook, parallel implementation registration, deterministic transitive resolution, optional dependency handling, conflict/cycle/missing rejection, and exact lock validation.
- `ModuleRegistry` V1 remains unchanged and exported alongside the V2 registry.

Campaign locks contain exact API version, implementation version, digest, source and optionality for every selected capability. A lock never silently re-resolves. Registration requires an explicit artifact-verification callback; `bundled-trusted` is metadata about deployment trust, not proof that bytes match a digest. Archive restore can use `validateCapabilityLock` with the registered manifest set and verifier to fail closed on unavailable, altered, duplicate, extra or mismatched dependencies.

Supported dependency ranges are deliberately bounded to `*`, exact, `=x.y.z`, `^x.y.z`, and `~x.y.z`. Caret ranges follow SemVer 0.x rules (`^0.2.3` stays below `0.3.0`; `^0.0.3` stays below `0.0.4`); unsupported syntax is rejected. A capability identity is `(id, implementationVersion)` and duplicate registrations are rejected even when their digests differ.

Validation evidence for this revision: under the repository workflow's Node 22 configuration, the focused suite uses the same Node test-runner/import style and passes 5/5 locally under Node 24. Direct TypeScript compilation of the contracts and registry sources passes; syntax and `git diff --check` pass. The repository `pnpm.cmd` hangs even on `pnpm --version` (bounded at 5 seconds), and the bundled repository-wide TypeScript invocation reports existing JSX/import configuration errors outside this package. No project-wide build pass is claimed.

## Merge acceptance and deferred implementation

PR #140 currently reports no GitHub Actions runs and no required checks (`statusCheckRollup: []`; `gh run list` returned no runs). That is a merge blocker, not a passing result. The required workflow is configured for Node 22 and `pnpm check`, but its execution could not be observed for this PR.

This PR does not persist V2 locks in campaigns, integrate lock closures into backup/archive export or restore, or implement publisher signing/trust roots. Those are future implementation work. The verifier callback proves only the caller-supplied artifact/provenance policy; `bundled-trusted` does not itself prove bytes or publisher identity. No action execution, effects, reactions, UI, or PR #130 code is included.

## Remaining phases

Resolver/effect execution, host transaction handlers, reactions, extension entities/workflows, UI contributions, third-party isolation, migrations and backup closure remain future PRs. The V1 production execution path is intentionally unchanged.
