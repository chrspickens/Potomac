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
| Resolver/host kernel | Not started | Small PRs 2–4: transcript, handlers, atomicity, continuations and reactions. |
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

## Decision status and critical open questions

Proposed, not final: exact lockfiles and digest pinning; separate V2 contract family; host-mediated typed effects; declarative/reviewed handlers only; extension UI as authorized projections; no ruleset switching; explicit migration and backup-first policy.

Critical unresolved choices: third-party executable trust/sandbox model; atomic handler isolation/conflict semantics; dependency provenance/signing roots; hidden random transcript storage; reaction timeout/order/disconnect semantics. High/medium risks and resolution gates are ranked in the RFC. Architecture must not be called final until the first two have executable evidence and the next three have explicit operational decisions.

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
