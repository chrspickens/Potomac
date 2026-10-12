# Potomac module and rules contract — draft v0.1

For the 0.4 campaign's exact module pin, schema-driven character create/edit, and incompatible-version behavior, see [Workspace 0.4 requirements](workspace-0.4-requirements.md) and [issue #26](https://github.com/chrspickens/Potomac/issues/26). The examples in this draft remain provisional until implemented and validated.

**Provisional**: examples below are design targets for the foundation spike, not an implemented wire format.

## Module categories

- **Application:** full views, registered bricks, commands and adapters (e.g., Characters).
- **Game system:** schemas, UI definitions, derived values, actions, validation, mechanics.
- **Content:** versioned records/assets targeting specified systems without privileged executable code.

Do not equate application installation with downloading a trusted executable. Initially bundle and register known first-party modules. Third-party executable packages require sandboxing and explicit grants before support.

## Candidate directory shape

```text
system-a/
  manifest.json
  schemas/character.schema.json
  ui/character-sheet.json
  rules/actions.json
  tests/rules-cases.json
```

Candidate manifest:

```json
{
  "formatVersion": 1,
  "id": "example.system-a",
  "type": "game-system",
  "version": "0.1.0",
  "requires": { "potomacApi": "0.1.x" },
  "provides": {
    "actorSchema": "./schemas/character.schema.json",
    "actorView": "./ui/character-sheet.json",
    "rules": "./rules/actions.json"
  }
}
```

Module identifiers should be stable, namespaced, and unique. Use **exact dependency/rules versions when saving a campaign**, while allowing declared compatible ranges for installation.

## Data schemas

Use JSON Schema with a single pinned dialect (candidate: 2020-12). Every module-owned record carries `moduleId`, `moduleVersion`, `schemaVersion`, `entityId` and revision. No universal requirements for classes, levels, HP or initiative. Shared core entity identity and permissions are platform fields.

## UI definitions

JSON view definitions reference validated schema fields and standard controls such as `stat`, `resource`, `actionButton`, `collection`, `text`. A renderer displays generic forms and compact bricks. More specialized first-party views may use code through a trusted SDK; third-party code must not be unrestricted.

## Structured rules IR (not a textual PRL parser yet)

Candidate action definition:

```json
{
  "id": "spend-mana",
  "requires": {
    "op": "gt",
    "left": { "ref": "resources.mana" },
    "right": { "literal": 0 }
  },
  "effects": [{
    "op": "changeResource",
    "target": "self",
    "resource": "mana",
    "amount": { "literal": -1 }
  }]
}
```

The shared `@potomac/rules-engine` API evaluates expressions and applies declared `changeResource` effects to a cloned state, returning a proposed state. It has no I/O or ambient randomness. The host remains responsible for validating action parameters, authorizing the actor and action, supplying cryptographically generated roll results, and atomically committing accepted state and audit events. The host and shared evaluator use the same bounded expression implementation.

### Initial safe operators

- Pure arithmetic, comparisons, Boolean operators, references to declared fields and built-in fixed functions such as floor.
- Action preconditions and typed effects (`changeResource`, `setField` where policy permits).
- Host-provided random results for rolls; log inputs, outcomes and rule provenance.
- Runtime scalar/type checks, a 256-node expression and dice budget, maximum expression depth 32, bounded resource changes, deterministic error behavior, no I/O, arbitrary JavaScript or unbounded loops.

Events/reactions and custom PRL text syntax are **deferred**. Avoid allowing a module to modify visibility/access policy as an ordinary effect.

## App-facing contracts (candidate)

```ts
type ResolvedContext = {
  campaignId: string;
  entityId?: string;
  encounterInstanceId?: string;
};
type ActionRequest = {
  operationId: string;
  entityId: string;
  baseRevision: number;
  actionId: string;
  parameters: unknown;
};
// Typed schema validation and authorization take place at the host boundary.
```

Characters queries a registry for an actor's schema/view/actions. The full Characters editor and compact brick submit the same typed commands. The module does not reach into React state or the database.

## Compatibility test

One Characters renderer loads System A (attributes, HP, mana, d20) and System B (traits, Stress, Hope, two-dice resolution). Each computes one derived value, renders a different UI, and executes an action through one engine API. Adding System B requires **zero system-specific conditionals** in Characters.

## Unresolved design choices

- Use own expression AST vs CEL-compatible expressions.
- UI schema component catalog and extension surface.
- Whether exact module pinning is per campaign only or per content item as well.
- Module format signing, migration execution and third-party trust model.
