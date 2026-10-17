# Module Architecture Audit and RFC Starter

Draft 2026-10-17. Documentation-only, review required. Companion: [module plan](module-plan.md).

## Confirmed repository findings

| Source | Confirmed | Gap |
| --- | --- | --- |
| `packages/contracts/src/index.ts` | SystemModule declares actor schema, fields/actions view, typed action list; effect type is changeResource | No cross-actor effects, reaction windows, or declarative feature/content contract |
| `packages/module-registry/src/index.ts` | Validates manifest format and referenced action IDs; stores by module ID | Same ID with multiple versions rejected by this in-memory registry |
| `packages/rules-engine/src/index.ts` | Bounded expressions (256 nodes, depth 32), validated host-provided dice, self-resource updates | No damage, condition, deferred choice, zone, or d6-success-pool result interpreter |
| `server/host/index.mjs` | Host rolls dice, interprets summed totals and thresholds; actors and campaigns pin module ID+version; action events persisted | Resolution currently assumes host-specific dice and resource semantics |
| `clients/web/src/modules.ts` | Browser GameModule view uses layout and brick controls | Shared SystemModule view instead uses fields and actions, requiring an adapter strategy |
| `clients/web/src/fixture-bootstrap.ts` and `App.tsx` | Fixture selection and available module choices respect exact campaign pin | Remaining character sheet and UI assumptions need inspection |
| `server/host/backup.mjs` | Stores module ID/version and validates referenced versions during restore | Future libraries/content dependency provenance needs explicit contract |

These are verified code observations, not a complete line-by-line audit.

## Proposed boundary

Core owns authentication, visibility, identity, storage, transactions, ordering, events, host randomness, and offline synchronization. Each rules module owns actor schemas, mechanics, roll interpretation, advancement and rules-specific UI descriptions. Optional versioned libraries provide shared mechanics without being universal core requirements.

## Candidate lifecycle (not implemented)

1. Authorize version-pinned intent and validate input.
2. Module computes legal actions and requested random inputs.
3. Host generates and records random values.
4. Module evaluates results; may request an explicit reaction window with a serializable pending decision.
5. Host revalidates and atomically commits results, events and scoped projections.
6. Offline operations reconcile with current authoritative state; GM override must be explicit and audited.

## Minimal versioned interface sketch

```ts
type ModuleKey = { id: string; version: string };
type Intent = {
  operationId: string;
  campaignId: string;
  actorId: string;
  module: ModuleKey;
  actionId: string;
  expectedRevision: number;
  input: unknown;
};
type Result =
  | { status: "rejected"; reason: string }
  | { status: "resolved"; outcomes: unknown[]; changes: unknown[] }
  | { status: "pending"; pendingId: string; eligiblePrincipals: string[] };
```

Unknown fields above represent unresolved schema design, **not** a recommendation to trust arbitrary payloads. Versioned migration, bounded rule execution, confidentiality during reaction prompts and durable resumption must be specified first.

## Validation examples

- Revised 5e: attack, target defenses, damage/resistance and defensive reaction; spell slot and spell resolution; class-granted feature.
- Contrasting Testbed: multiple d6 count successes, degree of success, stress consequences, abstract zones and trait advancement.
- Independent third module: novel actor schema plus a roll and resource without changes to Core.

## Immediate remaining tasks

- [ ] Inspect module loader, action authorization/policies, replay and offline pathways end-to-end.
- [ ] Review both fixture action/view/schema files for concrete limitations.
- [ ] Inspect web character renderer and map mechanics for hidden RPG-system dependencies.
- [ ] Confirm migration/backup behaviors against existing tests and real historical evidence.
- [ ] Draft v2 manifest and typed outcome/effect schema; decide version compatibility in ADR.
- [ ] Link evidence and update the plan before starting implementation.
