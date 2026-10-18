# Potomac Extension Platform V2 — Working Plan

**Status:** Draft / living tracker; implementation-oriented architectural review
**Updated:** 2026-10-17
**Target:** Proposed V2 extension foundation; not final and not an approved milestone

## Scope and guardrails

This plan tracks the V2 extension platform. Preserve V1 manifests/actions, exact campaign pins, host authorization and redaction, offline receipts/proposals, backup compatibility and historical archive QA. V2 proposals must not execute untrusted module code; a Node worker is not a security sandbox.

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
| Extension data plane (issue #136 slice) | Implemented; production integration deferred | Versioned generic entity/command/workflow contracts, host SQLite kernel, atomic V2 effects/receipts/events, serialized continuation, starship proof and focused tests. Routes, migrations and archive wiring remain deferred. |
| UI contribution plane (issue #137 slice) | Experimental declarative client renderer; host-route integration deferred | Exact-pinned typed contracts and host React renderer for sheets, panels, action/forms, displays, resources and composable bricks. Starship and d20/dice-pool probes use the same renderer. No V2 HTTP route or authenticated host projection is wired. |
| System probes and QA | Not started | Revised 5e-shaped, dice-pool Testbed, starship and third-module fixtures; historical archive/device QA remains separate. |

## Recommended implementation order

1. Registry lock and V1 adapter.
2. Pure resolver protocol with two resolvers in one module.
3. Host typed-effect transaction kernel.
4. Serializable continuations/reaction windows.
5. Extension entities/commands/workflows/migrations and backup closure.
6. Generic authorized UI contributions and accessibility/offline states; the renderer prototype now exists, but it is gated and not production-playable.
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

Hardening evidence also covers canonical SHA-256 transcript digests, stored-transcript integrity checks during replay, campaign/lock identity matching, strict randomness bounds and draw semantics, recursive JSON/depth/size validation, duplicate output identities, and rejection of mixed-visibility nested payloads. Execution bounds constrain data and transcript size only; they are not wall-clock timeouts or a sandbox. V2 lock persistence, archive integration, publisher signing/provenance verification, production effect commits, reaction persistence, and third-party executable isolation remain deferred production gates.

## Issue #134 host effect transaction slice

The V2 host slice adds typed semantic effect proposals and versioned trusted handler descriptors, but leaves V1 routes and action execution unchanged. `server/host/v2-effects.mjs` validates authenticated principal callbacks, campaign lock callbacks, handler identity/digest, declared payload schemas, stable effect IDs, target visibility and expected revisions before opening `BEGIN IMMEDIATE`. Effects are sorted by stable ID, overlapping targets are rejected, and handlers return the next entity revision. Entity updates, filtered event records, and an idempotent receipt commit together; injected failures roll back the transaction.

Focused SQLite tests cover multi-entity ordering, authorization, hidden/stale targets, schema rejection, duplicate operation identity, changed-payload retry rejection, overlapping-target conflicts, failure injection after effects and receipts, restart inspection, and public event/receipt redaction. The implementation is a host-kernel contract and testable integration seam, not yet wired into V1 HTTP routes, offline queues, backups or reaction windows. Publisher signing, arbitrary extension workflows, UI, third-party executable isolation, and reaction orchestration remain deferred.

Hardening constraints: effect handlers receive only an immutable entity snapshot and cloned effect input; they cannot access SQLite, transactions, files or network services. Target authorization is re-evaluated against the row read inside the transaction, and retries authenticate and re-check campaign/principal/receipt identity before returning a receipt. Handler target type, API/implementation/digest identity, conditional update count, event kind/visibility and event payload schema are host-checked. The bounded schema subset supports `object`, `array`, `string`, `integer`, `number`, `boolean`, `enum`, `const`, required/properties/additionalProperties, items, item/string counts, and numeric bounds; unsupported keywords, unsafe keys, non-finite values and unsupported objects fail closed.

## Issue #135 reaction window slice

The reaction contract adds versioned window identity, parent operation, campaign/resolver/lock identity, eligible responders and actions, priority or simultaneous ordering, logical expiry, serializable continuation state, visibility, explicit accept/decline submissions, authenticated retries, disconnect/restart recovery, and GM adjudication interfaces. `server/host/v2-reactions.mjs` persists pending/terminal windows, submissions, filtered reaction events and request hashes in SQLite. Submission, deterministic completion, host-owned resumed effect application, terminal state, event and receipt work inside one transaction boundary; failures after submission or transition roll back.

The generic ordering policy is `priorityThenSubmission` (priority descending, then transaction sequence, then principal ID) or `simultaneous` (all eligible responders, or an explicit decline, before completion). No Revised 5e rule is encoded in Core. Focused tests demonstrate a defensive d20-shaped reaction and a contrasting dice-pool/narrative interruption using the same contract, plus restart restoration, multiple responders, ties, decline, expiry, unauthorized responder/GM, idempotent changed-payload retry rejection, hidden views and injected rollback. Production HTTP/offline/backup wiring, durable effect-kernel adapter registration, reaction scheduling, publisher signing, UI, and third-party executable isolation remain deferred.

Hardening evidence: projection requests require an authenticated principal and host authorization; callers cannot select a role string. Simultaneous decline records only that responder and leaves other required responders pending. A responder may submit only one decision; a different operation ID for the same responder is rejected, while an exact retry returns the same projection. Expiry is an authorized, host-clock operation and is idempotent after restart. Completion receives decisions only; the host-only effect adapter is the sole persistence/transaction callback and is invoked inside the existing transaction boundary, with no nested transaction or module database handle. The remaining production gate is wiring this adapter to real resolver/effect dispatch and host routes without changing V1/offline/archive behavior.

## Issue #137 experimental UI contribution slice

`packages/contracts/src/ui.ts` defines contract-versioned, exact-identity UI contributions for sheets, panels, action controls, forms, displays, resource trackers and reusable bricks. A contribution pins its own UI capability and the exact entity capability/schema; every command and workflow capability is also separately pinned by the campaign lock. The web `UiContributionRegistry` validates supported descriptor shapes, scalar form inputs, declared entity-field paths, command/workflow references, slot composition and entity/schema compatibility. It accepts data descriptors only: modules do not supply React components or JSX.

`V2UiContributionView` renders semantic host React elements from a host-supplied, already-projected entity DTO. Missing fields are not synthesized; commands not in the host-provided allowed-command set are omitted. Visible controls call one host command callback with entity revision and stable operation identity; server authorization remains authoritative. Forms collect typed string/number/boolean/enum values, surface validation/submission feedback, and use native labels, buttons and inputs. Keying by campaign/entity/exact UI identity remounts on entity or module version changes. Native controls and focus-visible styling are provided, but this is not a completed assistive-technology audit.

Fixtures demonstrate the starship reactor sheet, propulsion resource meter, power-allocation form, engineering workflow panel and reusable brick, plus a d20-shaped actor sheet and dice-pool/stress tracker. The latter two are probes, not production modules. Registry tests cover exact/missing pins, malformed schema and field/action/workflow references, hidden projected fields, slot composition and both contrasting probes.

**Experimental-only boundary:** the renderer requires `experimentalEnabled`, is not mounted by production V1 workspace routes, and has no V2 HTTP query/command adapter. It cannot itself prove a projection is authorized; production must source projections and allowed commands from the authenticated host. Issue [#145](https://github.com/chrspickens/Potomac/issues/145) remains the production prerequisite for transaction-current principal/permission and exact campaign-lock authority. V2 persistence/routes, offline reconciliation, backup/archive integration, capability provenance/signing, third-party isolation, and complete screen-reader/keyboard/device verification remain open. No production V2 end-to-end playability is claimed.

## Issue #136 versioned extension data plane

This implementation slice adds generic, namespaced and versioned descriptors for extension entities, commands and workflows in `packages/contracts/src/extensions.ts`, plus a host-owned SQLite kernel in `server/host/v2-extensions.mjs`. Every stored entity records its schema version, migration identity, exact capability reference/digest, owner and visibility, and host-managed revision. A missing or changed capability fails closed. Schemas are validated on create, reads and effect updates.

Commands require an authenticated campaign principal, declared role/ownership permission and expected revisions. The host validates typed input, invokes the registered V2 resolver with cloned state/input and host-supplied context, validates deterministic outcomes and proposals, then uses the existing V2 semantic effect kernel. Effect target authorization and schema/revision validation are rechecked inside the same `BEGIN IMMEDIATE` transaction as state changes, audit events and idempotent receipts. The resolver and effect handler receive no database or transaction handle. Workflow states and transitions are declared and versioned; continuation IDs are host-validated; participant permissions, expiry and cancellation are explicit. Transition state, accompanying effects/events and receipt share one transaction. A serialized snapshot API demonstrates backup-relevant data shape but does not alter the V1 archive format.

`examples/example.starship/v2/extensions.mjs` demonstrates a reactor entity, power-allocation command and multi-step engineering workflow using those generic APIs; Core contains no game-specific behavior. The example is deliberately outside the V1 `modules/` loader. Focused evidence is in `server/host/v2-extensions.test.mjs`, alongside V2 resolver/effect/reaction/registry regression suites. This is a trusted, local implementation proof only, not an executable third-party sandbox.

PR #144 hardening moves workflow lookup, participant and ownership authorization, status/revision/continuation/expiry checks, transition selection, receipt lookup and resolver-input construction inside `BEGIN IMMEDIATE`. Exact retries first authenticate and re-check current entity visibility/ownership and current workflow participants, while changed payloads remain rejected. Resolver snapshots and effect-handler snapshots are deeply frozen; nested visibility markers are rejected in effect event payloads. Tests exercise participant revocation before execution and after an exact retry, principal revocation and changed ownership, stale competing transitions, effect-free transition commits, lock changes during resolver execution, terminal/cancellation rules, and rollback after transition, event and receipt writes.

The extension kernel calls `getCampaignLock` after the transaction begins and again before commit (and during effect validation), comparing the exact canonical lock snapshot. This closes the TOCTOU window when the provider reads campaign lock state from this SQLite database under the same transaction. **The provider remains an injected boundary:** if it reads a remote service, mutable process cache or another database, SQLite cannot make that source transactionally stable. Production integration must persist the lock with campaign state or provide a transaction/version token that can be checked atomically; this PR records and tests the boundary but does not implement campaign-lock persistence. Authentication has the same deployment constraint if its provider is external rather than transactionally backed.

Review-hardening verification on PR #144 at code commit `8c39cfbb2d386e2ca60c455bc939b7d22e9d8baf`: the focused extension/effect/reaction/resolver/registry suites pass 38 tests; the existing V1 regression list passes 132 tests; `git diff --check` passes. GitHub Actions [Checks run 39088195581](https://github.com/chrspickens/Potomac/actions/runs/39088195581) passed `pnpm check`, including workspace build, V1/V2 tests, smoke and browser acceptance suites. Local dependency installation/build was independently blocked by npm TLS certificate verification (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); no TLS bypass was used. Production campaign lock and identity-provider integration, migration execution, V1 route/offline integration, backup/archive restore, and durability across power loss or multiple processes remain deferred.

**Not completed by this issue slice:** production campaign-lock persistence and install lifecycle; migration execution/rollback; V1 HTTP or offline route integration; V1 backup/archive format changes or production V2 restore; UI contributions; publisher signing/trust roots; arbitrary module SQL; third-party code isolation; power-loss/filesystem and multi-process durability guarantees. Existing V1 routes, offline behavior and archive formats are intentionally unchanged. Keep the production-readiness gates above open until these are separately designed and tested.
