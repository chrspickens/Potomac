# RFC: Rules Module Architecture and Dual-System Validation

**Status:** Draft — review and experimental validation required  
**Date:** 2026-10-17  
**Tracker:** [Module Plan](module-plan.md)  
**Scope:** Interfaces and migration design; **no implementation approval or runtime change**.

## Problem

Potomac has useful fictional System A and B fixtures, but those alone do not demonstrate that full, distinct rulesets can coexist without making the host and UI D&D-shaped. We need a narrow, versioned module contract supporting both Revised 5e and an original, deliberately different dice-pool/stress/zone system.

## Audited baseline (source-grounded)

| Source | Confirmed behavior | Gap / risk |
| --- | --- | --- |
| `packages/contracts/src/index.ts` | `SystemModule` requires `formatVersion`, `id`, `version`, schema, `view.fields` and actions; expression AST supports arithmetic, comparisons and booleans; action effects type only `changeResource`. | No content packs, interruption protocol, extended outcome algebra, or module-defined sheet sections. |
| `packages/module-registry/src/index.ts` | Register checks format v1, required capabilities and view action references; in-memory map keys by **ID**, rejecting duplicate IDs. | Cannot register multiple versions of a module into this registry simultaneously, though host SQL uses ID+version. |
| `packages/rules-engine/src/index.ts` | Pure bounded expression evaluator (256 nodes/32 depth), host-supplied validated dice, numeric self-resource updates, preconditions. | No typed damage, targeted effects, reactions, transaction interruption, or success-counting dice pool. |
| `server/host/index.mjs` | Host generates random rolls, applies the action, and interprets group totals/thresholds. Actors and pinned campaigns store module IDs and versions; host SQL queries modules by both. Actions check actor version/schema and emit applied events. | Host embeds a particular interpretation of dice, action resolution and resource effect execution. Need design separating neutral execution from module rules. |
| `packages/contracts/src/index.ts` vs `clients/web/src/modules.ts` | Shared `SystemModule.view` uses `fields/actions`; browser's `GameModule.view` has `layout/brick` controls; browser controls include text/stat/resource/actionButton. | Existing public type and browser-loaded representation are not the same shape. Contract evolution must map existing manifests and projections instead of breaking them. |
| `clients/web/src/fixture-bootstrap.ts`, `clients/web/src/App.tsx` | Fixture seeding filters exactly by campaign ID+version; available module list likewise filters campaign-pinned system; client builds character form from schema and submits versioned offline operations. | Inspect all sheet renderer and map interactions for hidden fixed assumptions. |
| `server/host/backup.mjs` | Backup schema records `modules(id,version,manifest)`, actor module ID+version and campaign pin. Restore validates referenced modules exist and campaign pin resolves. | New content/library versions and migration provenance must be verified in backups; historical formats cannot be assumed to embed future content packs. |

These observations come from reading the current repository files. An exhaustive call graph and tests audit is outstanding.

## Preliminary boundary (proposed)

**Core owns:** module loading and integrity checks; scoped identity/storage; permission-filtered views; host command authorization; transaction, idempotency, deterministic ordered events; host-generated randomness; map geometry primitives; network/offline reconciliation; audit and backup transport.

**Module owns:** actor and content schemas; rules meaning; roll interpretation; validation and outcomes; resource semantics; conditions; advancement; initiative and turn policy; movement meaning and measurement policy; UI declarations; system-specific state migrations.

**Optional libraries:** versioned, explicit dependencies for damage/conditions, d20, dice-pool, spell-like effects, features, zones and progression. Sharing a library must not force it on other systems.

**Security invariant:** module code never bypasses Core's authentication, visibility, quotas, storage transactions or replay checks.

## Working contract sketch — not existing TypeScript

```ts
type RulesModuleManifestV2 = {
  formatVersion: 2;
  id: string;
  version: string;
  requires: { potomacApi: string; libraries?: Record<string, string> };
  provides: {
    actorSchemas: Record<string, string>;
    contentSchemas?: Record<string, string>;
    rulesDefinition: string;
    views: Record<string, string>;
    migrations?: string[];
  };
};

type RulesIntent = {
  operationId: string;
  campaignId: string;
  actorId: string;
  module: { id: string; version: string };
  expectedRevision: number;
  actionId: string;
  input: unknown;
};

type RuleEvaluation =
  | { kind: "rejected"; code: string }
  | { kind: "resolved"; changes: unknown[]; outcomes: unknown[]; events: unknown[] }
  | { kind: "awaitingChoice"; pendingId: string; eligiblePrincipals: string[];
      choices: unknown[]; continuation: unknown };
```

These structures deliberately leave changes/outcomes/choices abstract until we test their safety, serialization, validation and access boundaries. A continuation must be serializable, uniquely identified, bounded, persisted and revalidated before resumption. Never persist an executable closure.

### Tentative lifecycle

1. Authorize and validate module-pinned intent and target scopes; reject stale revision.
2. Ask module to validate mechanics and identify needed rolls and possible response windows.
3. Host obtains dice/randomness and commits a stable decision record; never let clients choose authoritative random values.
4. Resolve module-specified outcomes, with explicit pause/response windows for reactions; preserve stable ordering.
5. Revalidate and atomically persist all changes, events, visibility metadata and receipts; deliver role-filtered projections.
6. On offline reconnect, reconcile/review commands against current authoritative state; no offline client may finalize combat results.

**Needs proof:** durability of paused actions, no leaking hidden mechanical state to unauthorized clients, deterministic replay with recorded randomness, scheduling timeouts or GM override.

## Test cases driving the shape

| Test | Rule-specific requirement | Host-general requirement |
| --- | --- | --- |
| Revised 5e basic attack | d20 roll, modifiers, AC, hit/miss, damage | target authorization, audit, atomic result |
| Fireball | sphere target set, save per target, fire damage, half on save, slot-level scaling | rolls, target visibility, geometry, event sequencing |
| Shield | reaction eligibility/timing, temporary AC change | durable interruption/choice and resume |
| Fighter feature | feature grant, resource recharge, attacks per action | versioned feature and resource definitions |
| Testbed check | pool of d6, count successes, degrees | generic structured roll results |
| Testbed stress | consequences with non-HP stress and recovery | generic validated state changes |
| Testbed zones | abstract adjacency/movement | map primitive vs system distance-policy separation |
| Third tiny module | novel schema and simple action | public contract completeness, no core edits |

Sample spells/classes are *validation fixtures* for design, not a claim that copyrighted proprietary rulebook content can be redistributed. Select licensed SRD/open content before shipping actual definitions.

## Backward compatibility strategy (proposed)

- Keep existing v1 manifests, module identifiers and exact version pins interpretable, through a versioned adapter if needed; don't silently reinterpret old action outcomes.
- Introduce new contract alongside current one; prefer explicit migration rather than in-place mutation.
- Treat saved module definition and dependent rules-library version as part of historic execution provenance.
- Preserve archive v2/v3/v4/v5 support and do not claim compatibility without real historical archive evidence; track preexisting manual follow-ups separately.
- Do not enable arbitrary live module swaps or automatic campaign conversion.

## Questions requiring ADR decisions

1. Should generic intent/effect schemas use typed operation unions rather than unvalidated `unknown`?
2. Can a pending reaction be stored as a host-owned continuation with deterministic timeout/GM fallback?
3. Which module-defined sheet components are declarative vs safe vetted renderers?
4. How are schema/content dependencies pinned and verified at restore time?
5. How does system-aware event visibility work when an effect depends on hidden information?
6. What are minimum execution budgets, trust tiers and safe handler deployment rules?

## Next audit/implementation tasks

- [ ] Finish reading host module loader/bootstrap and action/policy/approval flows with line-level call graph.
- [ ] Inspect `clients/web/src/workspace/` sheets, scene interaction and offline queue for system assumptions.
- [ ] Inspect module fixture schemas/actions/views and compare behavioral differences.
- [ ] Enumerate existing test coverage and identify missing deterministic/reaction/migration cases.
- [ ] Turn resolved interface decisions into ADRs, then implement a small **parallel V2** contract behind tested version adapters.
