# Potomac Rules Modules — Working Plan

**Status:** Draft / living tracker; documentation-only audit and RFC
**Updated:** 2026-10-17
**Target:** Proposed v1.0 modular rules foundation; not an approved milestone

## Scope and guardrails

Preserve host authority, exact campaign module/version pins, privacy filtering, offline intent reconciliation, stable IDs, idempotency, backup/restore and historical archive QA. This PR changes no runtime behavior, rules engine, milestone or implementation issue.

## Phase status

| Phase | Status | Exit evidence |
| --- | --- | --- |
| 1A lifecycle audit | **Complete for current source surface** | `rules-module-audit.md` cites contracts, registry, evaluator, host, web, offline, backups and tests; findings distinguish confirmed gaps from hypotheses. |
| 1B V2 RFC | **Draft complete for review** | `rules-module-rfc.md` defines proposed interfaces, lifecycle, security, examples, compatibility and migration. |
| 2 V2 implementation | Not started | Runtime contracts, validators, registry and rejection tests; no system-specific Core branches. |
| 3A Revised 5e-shaped example | Not started | Architecture examples first; implementation requires separate approved work and content review. |
| 3B dice-pool Testbed | Not started | Same public contracts with d6 successes, stress and zones. |
| 4 declarative UI/content | Not started | Schema-driven sheet/action UI with accessibility and permission tests. |
| 5 isolation/persistence/offline/migration/QA | Not started | Replay, dependency, restore, device/network/accessibility and historical archive evidence. |

## Confirmed baseline

V1 supports JSON fixture manifests, actor schemas/views, action input, bounded expressions, host-generated dice, self numeric resource changes, GM review, exact pins, visibility filtering, offline receipts/proposals and module-aware backups. It does not support general effects, target sets, conditions, reactions, deterministic replay, dependency closure or module-owned initiative/map semantics.

## Proposed implementation order after review

1. Freeze V2 terminology and compatibility rules; add ADRs only after review decisions are accepted.
2. Add contracts and validators with success/rejection tests, retaining V1 unchanged.
3. Add exact-version dependency resolution and provenance.
4. Add a pure bounded evaluator with explicit random transcripts and typed proposed effects.
5. Add host transaction/event/reaction persistence and redacted projections.
6. Add offline pending decisions and replay/resume semantics.
7. Author fixture-only Revised 5e-shaped, dice-pool and third-module probes.
8. Add UI adapters/accessibility states and shared app/brick command tests.
9. Add migrations, backup/restore closure and historical archive QA.

## Proposed decisions and open questions

Working direction: V2 is a separate contract family; modules are declarative by default; host owns authorization, visibility, randomness, ordering, budgets and commits; campaigns remain pinned; GM override is explicit/audited; V1 fixtures remain readable. These are proposed constraints, not accepted ADRs.

Open: dependency signatures/provenance, validator dialect, random transcript confidentiality, reaction timeout/order, handler review, UI minimum, content licensing, migration policy and whether maps expose geometry or only generic references.

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
