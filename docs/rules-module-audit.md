# Rules Module Architecture Audit

**Status:** Draft for review; documentation-only; 2026-10-17

## Executive summary

The repository has a useful but deliberately small V1 module seam. The host loads JSON manifests, embeds actor schema/view/rules in `modules`, pins a campaign to one exact module ID/version, validates actor data and action inputs, generates dice, applies bounded resource effects, persists events, and filters projections. Browser offline work is queued as host-bound operations, not committed client state. Backups preserve module pins and reject unavailable module versions on restore.

This is not yet a general rules engine. V1 effects are numeric changes to the acting actor's `resources`; resolution records dice groups/totals but has no general outcome algebra, target set, condition, reaction window, interruption stack, initiative policy, or deterministic random transcript. Maps, encounters and initiative are host tables/workflows, not module-defined mechanics.

## Confirmed lifecycle findings

| Boundary | Evidence and functions | Confirmed behavior | Limitation / risk |
| --- | --- | --- | --- |
| Contracts | `packages/contracts/src/index.ts`: `SystemModule`, `ActionDefinition`, `Actor`, `OfflineOperation` | Shared types carry module/version/schema identity, actor data, action input, policy, expressions, roll metadata and offline scope. | V1 has one schema/view/action list; effects only `changeResource`; no target/effect/event/reaction/migration/dependency contracts. Types are not runtime validation. |
| Registry | `packages/module-registry/src/index.ts`: `ModuleRegistry.register/get/list` | Requires `formatVersion === 1`, required capabilities and view action references; clones values; rejects duplicate IDs. | In-memory and keyed only by ID; two versions of one ID cannot coexist here. It does not validate JSON Schema/UI fields and is not the host's persistent registry. |
| Loader/persistence | `server/host/index.mjs`: `createHost`, bundled module loading, `modules` table | Manifests are combined with schema/view/rules and inserted by `(id, version)`. Actors and campaigns store exact module pins. | No signed provenance, dependency graph, content-pack digest or general module migration registry. |
| Validation | `server/host/index.mjs`: `validateSchema`, `validateActionInput`, host action route | Host checks a bounded JSON-Schema subset, action ownership, module pin, grants, policy and revisions. | Not full JSON Schema 2020-12; V1 has no target/choice/effect graph validation. |
| Rules | `packages/rules-engine/src/index.ts`: `evaluate`, `getRequiredRollCount`, `executeAction`; `packages/rules-engine/src/index.test.mjs` | Node/depth budgets, forbidden prototype paths, finite arithmetic, dice bounds and numeric resource bounds are enforced. | Only self numeric resource changes; no damage, conditions, cross-actor effects, outcome interpreter or replay transcript. |
| Host/events | `server/host/index.mjs`: `insertEvent`, `projectActor`, `filterEventForClient`, action execution | Host authorizes, commits DB mutations/events, stores module/rule/schema provenance, filters GM data and supports operation-id idempotency. | Events are V1 host/action records, not a versioned replay protocol; no generic interruption ordering or atomic effect set. |
| Web/UI | `clients/web/src/modules.ts`; `fixture-bootstrap.ts`; `workspace/contributions.tsx`; `schema-form.ts` | Fixture layouts and safe text/stat/resource/action controls render; fixture selection respects exact campaign pins; host-only actions disable offline. | `modules.ts` is a separate client fixture contract. Character/brick code assumes name/data/secret-note/resources/encounters; arbitrary V1 views need adapters. |
| Offline | `packages/contracts/src/index.ts`: `OfflineOperation`; `clients/web/src/offline/storage.ts`: `openOfflineStorage`, `validateOperation`, `validateSnapshot`; `offline/reconcile.ts`: `flushOfflineQueue`; host offline routes | Storage is scoped by host/campaign/member, preserves operation IDs and module/schema identity, and returns applied/rejected/conflicted/awaiting-review receipts. | Queue contains intents, not committed outcomes. V2 pending reactions need durable eligibility/expiry/resume state; none exists. |
| Encounters/maps | Host tables/routes for `encounters`, `encounter_participants`, `sessions`, `map_scenes`; map DTOs in contracts | Host has generic encounter/session/map primitives, grid types and an integer initiative column. | Initiative is a storage field, not a module algorithm. `battle` maps and sessions are product primitives, not universal combat rules. |
| Backups | `server/host/backup.mjs`: `exportCampaignBackup`, `validateArchive`, `restoreCampaignBackup`; `backup.test.mjs` | Archives carry campaign ID, exact modules, schema version, tables, checksum and assets; restore validates availability/references and stages/rolls back. | No V2 dependency closure, migration provenance or random transcript format. Layouts/caches/private drafts are excluded. Historical archive QA remains separate. |
| Tests | `packages/rules-engine/src/index.test.mjs`; host security/index/backup/lore/maps tests; web offline/fixture/workspace tests | Existing tests cover V1 actions, auth/redaction, idempotency, stale revisions, offline conflict/receipts, fixture pins, backup/restore, maps and UI storage. | No V2 tests for reactions, replay, dependencies, cross-actor effects or dice-pool outcomes. |

## Fixture audit

System A (`modules/system-a`) is Emberbound: `strength/intelligence`, `hp/mana`, derived melee bonus, d20 strength check, self mana spending and GM-reviewed restoration. System B (`modules/system-b`) is Hollow Stars: `agility/instinct`, `stress/hope`, derived composure, two paired d6 groups (`hope`/`stress`), self hope spending and GM-reviewed stress clearing.

Genuinely supported differences are the actor fields and closed schemas, resource names, action IDs, input ranges, policies, dice group counts/sides/roles, derived expressions and UI labels. Shared assumptions are substantial: both use `name`, identity/version/revision fields, scalar numeric traits, current/maximum numeric resources, synchronous actor-local actions, one JSON input object, the same expression vocabulary, host rolls, and the same understood UI controls. Neither fixture has targets, zones, conditions, initiative rules, choices, reactions or cross-actor effects. These fixtures prove a small declarative seam, not arbitrary system extensibility.

## Fixed-system and D&D-shaped assumptions

- Host encounters/sessions and the integer participant `initiative` exist, but no module computes initiative.
- Host resolution can sum dice groups and compare a modifier/total to a target. This resembles a d20 check but is not a complete d20 system and has no damage, resistance, critical or degree policy.
- Actor JSON is flexible after partial validation, but web character rendering expects a name/data/secret-note model and resource/stat controls.
- Map grids and actor pieces are product DTOs; there is no confirmed cover, reach, line-of-sight, distance, zone, movement, targeting or geometry interpreter.
- Conditions, spell slots, class features, weapons, armor, levels, proficiency, saving throws and action economy are absent from V1. They must be V2 module content, not inferred capabilities.
- Dice are host-generated integers summarized as groups/totals; no confirmed natural-1/20, success counting, opposed-roll, reroll or random provenance semantics exist.

Confirmed findings are only the paths/functions and tests named above. Every V2 interface, reaction model, dependency model, replay transcript and content example is a hypothesis/proposal in `docs/rules-module-rfc.md`.

## Open decisions

Choose a separate V2 family versus in-place evolution; JSON Schema subset and DSL boundaries; random transcript confidentiality; reaction ordering/deadlines; minimum accessible UI schema; dependency provenance/signatures; content licensing; and declarative versus reviewed migration handlers.
