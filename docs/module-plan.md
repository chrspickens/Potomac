# Potomac Extension Platform V2 — Working Plan

**Status:** Draft / living tracker; implementation-oriented architectural review
**Updated:** 2026-10-17
**Target:** Proposed V2 extension foundation; not final and not an approved milestone

## Scope and guardrails

This PR is documentation-only. Preserve V1 manifests/actions, exact campaign pins, host authorization and redaction, offline receipts/proposals, backup compatibility and historical archive QA. Do not add runtime behavior, GitHub issues, milestones or a new PR. V2 proposals must not execute untrusted module code; a Node worker is not a security sandbox.

## Review result

The V1 audit confirms three boundaries that require explicit V2 contracts:

- Registry: `packages/module-registry/src/index.ts` is an in-memory ID-only V1 registry and rejects duplicate IDs; it cannot provide campaign lockfiles, digests, optional capabilities or parallel versions.
- Execution: `packages/rules-engine/src/index.ts` bounds expressions and host rolls but only applies self numeric resource changes; `server/host/index.mjs` owns authorization, persistence, event filtering and V1 dice generation.
- Extensions: `packages/contracts/src/index.ts` has generic-ish actors/offline/map DTOs, while `clients/web/src/modules.ts` and `workspace/contributions.tsx` still assume fixture-shaped character fields and controls. UI bindings are not permissions.

Recommended direction is documented in [Rules Module V2 RFC](rules-module-rfc.md): exact immutable capability locks; host-owned resolver/effect execution with declarative or reviewed handlers; and host-registered typed extension entities/commands/workflows/UI contributions.

## Phase status

| Phase | Status | Exit evidence |
| --- | --- | --- |
| V1 lifecycle audit | Complete | `rules-module-audit.md` with paths, functions, confirmed findings and hypotheses. |
| V2 contract review | **Draft complete; critical risks unresolved** | RFC covers registry, execution and extensibility alternatives, interfaces, invariants, failure, migration, examples and acceptance tests. |
| ADR drafts | **Added in this review** | ADR-0019 through ADR-0021 record proposed exact locks, host execution boundary and authorized extension contributions. |
| Registry implementation | Not started | Small PR 1 criteria in RFC: resolver/lock/conflict/digest/V1 tests. |
| Resolver/host kernel | **Isolated evidence complete; production implementation not started** | PR #130 commit `f06307b` passes 9 focused tests for SQLite atomicity, rollback, hashes, action eligibility and continuation recovery. Production adapters and policies remain required. |
| Extension data/UI plane | Not started | Small PRs 5–6: entities, commands, workflows, migrations, apps/sheets/bricks. |
| System probes and QA | Not started | Revised 5e-shaped, dice-pool Testbed, starship and third-module fixtures; historical archive/device QA remains separate. |

## Recommended implementation order

1. Registry lock and V1 adapter.
2. Pure resolver protocol with two resolvers in one module.
3. Host typed-effect transaction kernel.
4. Serializable continuations/reaction windows.
5. Extension entities/commands/workflows/migrations and backup closure.
6. Generic authorized UI contributions and accessibility/offline states.
7. System probes, campaign isolation and full migration/archive QA.

Each step remains a small reviewable PR with the specific acceptance criteria in the RFC. Do not mark a phase complete from documentation alone.

## PR #130 evidence boundary

PR #130 is a separate draft spike, not a merge or production integration. The exact commit `f06307b` validates a useful transaction shape: reaction submission, multi-entity effects, receipt, terminal window state and event are one SQLite transaction, with injected failures at five boundaries. It also validates canonical operation-payload hashes, exact retry receipts, per-responder action permissions, deterministic prototype submission order, decline/expiry/duplicate behavior, and restart recovery from a persisted JSON continuation.

Proven only in the isolated kernel: SQLite transaction rollback, statement-level revision checks, injected authorization/schema hooks, JSON/path/numeric validation, operation idempotency, and continuation recovery under the tested reopen scenario. Not proven: production host authorization integration, shared schema contracts, power-loss/filesystem recovery, distributed or multi-process coordination, backup/offline integration, hidden-state encryption/projection, random transcript persistence, priority/simultaneous reaction policy, or final timeout semantics.

## Minimum production-ready V2 scope

Before calling V2 production-ready, implement and test the smallest host-owned set below while leaving V1 unchanged:

1. **Exact capability lock:** stable namespaced ID, API version, implementation version, digest, transitive dependency closure, source/trust tier, and campaign/archive pin. Resolve ranges only during explicit install/pin; never during replay or restore.
2. **Registry validation:** staged registration, duplicate provider rejection, API incompatibility rejection, explicit conflict rejection, optional-capability fallback declaration, missing-dependency diagnostics, parallel implementation support, and V1 adapter isolation.
3. **Resolver/effect protocol:** typed resolver references, host-supplied random transcript, bounded semantic outcomes, declared effect handlers, expected revisions for every target, authorization before commit, deterministic ordering, canonical operation hashes and idempotent receipts.
4. **Atomic host transaction:** validated cross-entity effects, state revisions, operation receipt, audit events and reaction terminal state commit together; crash/restart tests must cover failure boundaries and durable recovery.
5. **Serializable reactions:** explicit window/action eligibility, deterministic ordering, decline/expiry/disconnect semantics, hidden projections, bounded continuation state and offline/reconnect behavior.
6. **Compatibility/restore:** V1 fixtures and exact campaign pins remain readable; backups include required V2 lock/provenance and continuation/event data; missing capabilities fail closed without silent conversion.

This is a minimum execution/registry scope, not a complete UI/content platform. Entity/UI contributions, migration tooling and third-party executable extensions remain subsequent work.

## Ordered implementation PR plan

| Order | Focus | Acceptance criteria |
| --- | --- | --- |
| 1 | Capability manifest and exact lock | Validates IDs/API/implementation versions/digests; rejects malformed/duplicate/conflicting providers; resolves transitive dependencies; supports parallel versions and V1 adapter; serializes/restores exact locks. |
| 2 | Pure resolver and effect contracts | Two resolvers in one module; explicit random transcript; typed handlers; bounded proposals; rejection tests for invalid payloads, handlers, targets and budgets. |
| 3 | Host transaction integration | Shared authorization/schema adapters; multi-entity atomic state/effect/event/receipt commit; stale/conflict/idempotency tests; no V1 path changes. |
| 4 | Durable continuation/reaction policy | Production persistence, action eligibility, ordering, decline/expiry/disconnect, hidden projections, restart/failure injection and offline receipts. |
| 5 | Backup/migration compatibility | V1 archive regression, V2 lock/continuation provenance, backup-first migration, unavailable-module read-only/fail-closed behavior. |
| 6 | Extension entities and UI | Starship-style entity/command/workflow/view/brick with host authorization, safe projections, accessible pending/offline states and migration tests. |

The registry and transaction spike reduce uncertainty but do not satisfy these production acceptance gates. Do not create issues or milestones from this plan yet.

## Decision status and critical open questions

Proposed, not final: exact lockfiles and digest pinning; separate V2 contract family; host-mediated typed effects; declarative/reviewed handlers only; extension UI as authorized projections; no ruleset switching; explicit migration and backup-first policy.

Critical unresolved choices: third-party executable trust/sandbox model; production handler isolation/conflict semantics; dependency provenance/signing roots; hidden random transcript storage; reaction priority/timeout/order/disconnect semantics. The spike supplies isolated evidence for transaction shape but does not resolve these production choices. Architecture must not be called final until shared host adapters and the first two production guarantees have executable evidence, followed by explicit operational decisions for the remaining risks.

## Historical QA preservation

This audit does not close existing v0.9/v0.8 usability, human-device/network/accessibility or historical archive requirements. Existing evidence and outstanding backup/archive QA remain separate; this RFC is not acceptance evidence.

## Updated design principle — expressive extensions first

**Accepted working direction (2026-10-17):** Optimize for sophisticated, safe, maintainable module capabilities and excellent GM/player usability, **not** for minimum module-authoring complexity. Developer-facing modules may require code, tests, and deep knowledge of the platform. No-code tooling is optional and must not define the expressive ceiling.

**V2 architectural framing:** a general-purpose, versioned **extension platform**, with rules modules as the first major use case. Distinguish game-specific capabilities from Core invariants; do not turn all platform internals into replaceable plugins.

### Revised priorities and staged implementation

- [ ] Specify extension identity, capabilities, dependencies, registration, lifecycle, compatibility, isolation, budgets, and host-owned authority in the RFC; keep legacy V1 behavior intact.
- [ ] Design typed interfaces for pluggable resolvers, semantic effect processors, spatial/targeting policies, turn systems, progression/features, resources, UI contributions, and entity/workflow extensions. These may share registry infrastructure without each requiring a distinct plugin runtime.
- [ ] Provide three equally supported authoring modes: structured definitions, composable DSL/effect graphs, and reviewed executable handlers. Prefer structured authoring when suitable, but never force novel mechanics into inadequate schemas.
- [ ] Validate both **two incompatible rules modules** and **two resolvers in one module**, plus a non-character custom entity/workflow proof and an independently authored third module.
- [ ] Build only the minimum necessary capabilities in the first V2 runtime slice; defer general community distribution, AI, import/export ecosystems, and no-code editors.
- [ ] Evaluate an actual isolation boundary for executable modules rather than assuming a worker alone makes untrusted code safe.

**Expanded exit criterion:** a module can contribute a genuinely novel persistent entity, custom authorized commands and a UI workflow without modifying game-specific Core paths. Existing platform permissions, host transactions, event audit and offline policies still apply.

**New open decisions:** trusted/bundled versus untrusted/third-party extension runtime, capability manifest shape, dependency locking, deterministic executable continuation model, host-approved state mutation vocabulary, UI contribution isolation, and lifecycle/migration hooks.
Existing v0.9/v0.8 usability, human-device/network/accessibility and archive/backup evidence remains separate. This review does not claim those checks passed. V1 archive layouts, exact module availability checks, staged restore behavior and browser cache/privacy exclusions remain compatibility requirements.

## Review of experimental PR #130 (2026-10-17)

[Isolated execution-kernel spike](https://github.com/chrspickens/Potomac/pull/130) at commit `f06307b` reports nine focused tests passing. The updated prototype demonstrates a single SQLite transaction for reaction submission, validated multi-entity effects, receipt, terminal window state and event, plus injected failures at five transaction boundaries. It remains isolated from V1 and must remain a separate draft.

The earlier separate-commit defect identified in review is corrected in the spike. Exact retries are bound to canonical operation/payload hashes; action IDs and authenticated responders are checked against the window's permitted actions; ordering, decline, expiry, duplicate/terminal retry, disconnected retry, stale continuation and restart recovery are covered by the focused suite. These are isolated properties, not production durability claims.

**Production follow-ups:** connect shared host authorization/schema adapters; prove behavior across power loss, filesystem recovery, multi-process coordination, backups and offline receipts; define durable/filtered random transcripts and hidden projections; settle reaction priority, simultaneous responses, timeout and disconnect policy; and establish the trusted-module boundary without treating Node workers as a security sandbox. Trusting a local implementation never authorizes arbitrary state changes.

**Suggested approvals:** PR #129 can be reviewed as a proposed architecture with this evidence carried forward. Keep ADR-0020 Proposed and do not mark V2 production-ready until the shared production adapters and operational guarantees have executable evidence. Do not merge PR #130 into the V1 host; keep both PRs as drafts.

## PR #140 registry implementation evidence

PR #140 implements the registry slice of the plan while preserving the V1 `ModuleRegistry` and production host path. The V2 package adds typed manifests, explicit artifact verification, parallel implementation versions, deterministic transitive resolution, optional dependencies, conflict/cycle/incompatible-range rejection, duplicate identity protection, and immutable exact lock validation.

The implementation does not persist V2 locks in campaigns, integrate lock closures into backup/archive export or restore, or implement publisher signing/trust roots. Those remain future work. It also does not add action resolution, effects, reactions, UI, executable module loading, or PR #130 integration.

Focused evidence on the merged branch: `node --experimental-strip-types --test packages/module-registry/src/v2.test.mjs` passes 5/5; direct TypeScript compilation of `packages/contracts` and `packages/module-registry` passes; `git diff --check` passes. The repository workflow is configured for Node 22 and `pnpm check`, but full CI/build evidence must come from GitHub Actions after this merge update.

## Issue #133 resolver protocol slice

The resolver contract slice adds `ResolverRef`, host-bound `ResolutionInput`, typed outcomes/effect proposals, decisions, continuation requests, bounded execution errors, canonical serializable transcripts, deterministic replay, and role-filtered transcript projections. Every execution requires operation identity, campaign/principal identity, logical time, host-supplied randomness, and an exact resolver entry in the immutable capability lock. The resolver receives a cloned input and has no API for ambient time/randomness, persistence, network access, or effect commits.

Tests demonstrate two independently registered resolver identities in one module lock, a contrasting dice-pool resolver, replay equivalence and mismatch rejection, malformed random input, output bounds, exact lock mismatch, and omission of private state/randomness/decisions from public projections. `createTranscriptStore` is an interface boundary only; durable private transcript storage and production host authorization remain future work. Trusted locally installed implementations are the only supported trust tier; this slice makes no untrusted-code isolation claim.
