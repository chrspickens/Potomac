# Potomac Rules Modules — Working Plan

**Status:** Draft / living tracker  
**Updated:** 2026-10-17  
**Target:** Proposed v1.0 Rules Module Foundation & Dual-System Validation (not yet an approved milestone)  
**Scope:** Design and architecture validation before full Revised 5e content implementation.

> Keep this file current as decisions, experiments, PRs, and blockers evolve. Checkboxes only indicate verified work. Separate *proposed* interfaces from code that already exists.

## Objective and guardrails

Make Potomac genuinely multi-system, not a D&D engine with replaceable labels.

- Preserve the existing localhost host-authoritative, campaign-pinned module/version model, privacy boundaries, offline workflows and backwards compatibility.
- Keep Potomac Core system-neutral; no hardcoded `revised5e` branches or mandatory D&D stats, HP, actions, conditions, grid rules, or sheets.
- Rules modules define their own mechanics, actor shapes, resources, action semantics and presentation; reusable optional libraries may supply shared mechanics.
- Prefer validated declarative content for ordinary features and spells, composable triggers for complicated interactions, and sandboxed/reviewed extension handlers only where necessary.
- Build **Revised 5e** (primary) alongside a deliberately contrasting **original dice-pool/stress/zone Testbed** (architecture probe), then a minimal independently authored third module.
- No new runtime behavior in the initial architecture/audit PR. Do not equate fixtures with production-ready modules.
- Keep existing v0.9 usability/QA and outstanding historical backup/human-device evidence separate and visible.

## Current baseline — initial source review (2026-10-17)

| Area | Evidence | Initial finding / next check |
| --- | --- | --- |
| Module definitions | `modules/system-a/manifest.json`, `modules/system-b/manifest.json` | Two fictional fixtures (Emberbound and Hollow Stars), each using `formatVersion: 1`, actor schema/view and rules action paths. **Existing**, not new dual-module validation. |
| Registry | `packages/module-registry/src/index.ts` | Registers `SystemModule`, checks required fields and action/view references; keyed by module ID, duplicate IDs rejected. **Audit version lookup and multiple versions.** |
| Evaluator | `packages/rules-engine/src/index.ts` | Bounded expression evaluation (node/depth budget); current action executor accepts host-supplied rolls, requires expressions and numeric self-resource changes. **Not yet general combat, spellcasting, interrupt/reaction resolution, or dice-pool outcomes.** |
| Shared types | `packages/contracts/src/index.ts` | Present; detailed actor/action/view contract and extension constraints still require examination. |
| Host and web | `server/host/`, browser client | README documents exact campaign module/version pin, host-authored state and multiplayer/offline pathways. **Verify implementation call sites and UI assumptions.** |
| Docs | `docs/architecture.md`, `docs/adr/`, `docs/engineering-standards.md` | Architecture proposal and ADR practice exist; RFC should extend, not silently replace, these. |

### Initial audit questions (not yet answered)

- [ ] Inventory `SystemModule`, actor schema/view, action and expression types; identify contract compatibility constraints.
- [ ] Trace loader, module ID + version pinning, registry lookup and persistence across host, browser, backup/restore and offline replay.
- [ ] Find any system-specific conditionals and fixed character-sheet, resource, dice, initiative or map assumptions.
- [ ] Establish how the host sequences rolls, commands, events and approval decisions, and what is replayable.
- [ ] Inventory current security boundaries, validation, deterministic execution budgets, and import trust.
- [ ] Record paths/tests and concrete gaps in an audit table before calling the RFC ready.

## Proposed architecture (hypotheses to validate)

1. **Potomac core:** generic identity, scoped records, authoritative state/operations/events, authorization, sync/offline, attachments/maps primitives, and UI extension hosting.
2. **Module contracts:** explicit manifest API version and module version, independently versioned actor/content schemas, action/roll/outcome contract, state transitions, migration hooks and UI registration.
3. **Optional mechanic libraries:** d20, dice pool, resources, modifiers, triggers, spatial measurements and progression. Do not require any of them globally.
4. **Content definitions:** spells, features, classes, subclasses, species, backgrounds, feats, equipment and creatures referencing validated effects. Definitions are versioned and immutable for historic replay.
5. **Rules execution:** host-authoritative, deterministic from explicit state and host-provided random inputs; clear preconditions, interrupt windows, ordering, budget, permissions, transactionality and auditable results.
6. **UI extension:** declarative schema-driven sheets and action panels first; vetted specialized renderers only behind a controlled host contract, with keyboard accessibility and permissions.
7. **Exceptions and GM overrides:** first-class manual adjudication/audit fallback, with controlled specialized handlers; never arbitrary untrusted scripts in host/server.
8. **Compatibility:** campaigns stay pinned to exact module versions; old fixtures, backups and sessions remain readable; no implicit cross-system conversion or live ruleset switching.

## Phase tracker

| Phase | Work | Status | Exit evidence |
| --- | --- | --- | --- |
| 1A | Audit existing module/runtime/UI/host contracts | **In progress** | Paths, findings, hardcoded assumptions and migration risks documented |
| 1B | Draft architecture RFC + concrete TypeScript/JSON contract examples | Not started | Reviewed ADR/RFC, explicit open questions |
| 2 | Registration/versioning/schema/action lifecycle contracts | Not started | Tests using two incompatible module shapes; no module-specific core branches |
| 3A | Revised 5e vertical slice | Not started | Attack, hit/miss, damage/resistance, reaction, basic spell and class feature |
| 3B | Original dice-pool Testbed vertical slice | Not started | d6 success pool, opposed outcome, stress/consequence, narrative zones, advancement |
| 4 | Declarative content + module-driven UI extensions | Not started | Add an ability and distinct sheet without core edits |
| 5 | Isolation, persistence, offline, security, migration and independent third-module validation | Not started | Automated plus manual evidence linked below |

## Architecture acceptance gates

- [ ] Two campaigns using distinct systems work concurrently without cross-campaign/global rules state leakage.
- [ ] No direct imports across system modules; no D&D-specific fields or `if (moduleId === ...)` paths in Core.
- [ ] Each module controls actor structure, roll interpretation, resources and progression without changes to Core.
- [ ] Host validates and records reproducible action outcomes and ordered reactions/interrupts.
- [ ] Permission-filtered GM/player UI views, keyboard paths and offline conflict handling work in both.
- [ ] Campaign/module version stays pinned; migration and restore preserve old module content and audit provenance.
- [ ] Third tiny module is authored against documented public contracts without modifying core.
- [ ] Human/device/network/accessibility and historical archive evidence gaps remain explicitly tracked (not silently marked passed).

## Suggested issue / PR sequence (create after audit refinement)

- [ ] Audit module registry, contracts, host, UI, persistence, backups and tests (documentation-only).
- [ ] Rules Module RFC: core boundary, sample interfaces, lifecycle and version/migration policy.
- [ ] Declarative definitions/effect catalog and worked Fireball, Shield, Fighter feature, dice-pool check examples.
- [ ] Neutral rules execution/action lifecycle with deterministic/authorization tests.
- [ ] Revised 5e vertical slice.
- [ ] Contrasting Testbed vertical slice.
- [ ] Modular character-sheet and interaction UI.
- [ ] Third-module and regression/migration/QA signoff.

**Implementation order:** small reviewable PRs. Initial plan and audit before changing runtime. Do not automatically start full Revised 5e content entry.

## Decision log

| Date | Decision | Status | Rationale |
| --- | --- | --- | --- |
| 2026-10-17 | Revised 5e primary + contrasting dice-pool Testbed | Working agreement | Test architectural neutrality while delivering playable D&D |
| 2026-10-17 | Core + optional mechanic libraries + system modules | Proposed | Avoid forcing one universal resolution model |
| 2026-10-17 | Declarative content with controlled exceptional handlers | Proposed | Authorability without unsafe unrestricted execution |
| 2026-10-17 | Module-driven UI and third independent smoke module | Proposed | Mechanics and presentation both need real extensibility |
| 2026-10-17 | Keep current campaign version pins and historic restore guarantees | Required constraint | Avoid invalidating current projects and archives |

## Open design questions

- What is the minimum stable action/roll/outcome/event protocol that admits both systems?
- What may a module decide vs what must be host-enforced (visibility, authorization, reconciliation, GM adjudication)?
- How do reactions suspend/resume an action, resolve ordering, and recover from disconnects?
- Should definitions be JSON Schema + typed DSL, and which features demand a reviewed handler?
- What is the smallest accessible declarative UI schema that supports radically different sheets?
- How are content packs licensed and separated from open SRD-derived material and user-authored homebrew?
- How do we version reusable rule libraries without mutating old campaign behavior?

## Links / evidence

- Existing docs: [Architecture](architecture.md), [Engineering standards](engineering-standards.md), [ADR index](adr/README.md).
- Existing source: [Registry](../packages/module-registry/src/index.ts), [Rules evaluator](../packages/rules-engine/src/index.ts), [Contracts](../packages/contracts/src/index.ts), [System A](../modules/system-a/manifest.json), [System B](../modules/system-b/manifest.json).
- Current v0.9 tracker: [#109](https://github.com/chrspickens/Potomac/issues/109).
- Proposed v1.0 tracker: **not yet created**.
- PRs, experiments and verification: **add links as completed**.

## Update discipline

For each PR: update phase status, acceptance evidence, newly discovered constraints, outstanding risks and decisions here. Add an ADR for a durable cross-package contract choice. Never mark a checkbox complete solely because code was merged: link the test/evidence.
