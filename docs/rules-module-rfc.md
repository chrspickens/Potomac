# Rules Module V2 RFC (proposed)

**Status:** Draft for architectural review; not implemented
**Compatibility:** Coexists with V1; this PR proposes no V1 runtime change.

## Contract sketch

The following are proposed TypeScript interfaces, not existing exports. `unknown` is legal only behind a named module validator; it is not a permission or validation shortcut.

```ts
type ModuleRef = { id: string; version: string; digest?: string };
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Visibility = 'public' | 'gm' | { principals: string[] };
type TargetRef = { kind: 'actor' | 'scene' | 'zone' | 'entity'; id: string };

interface RulesModuleManifestV2 {
  api: 'potomac.rules.v2'; module: ModuleRef; name: string;
  capabilities: Array<'actions'|'reactions'|'ui'|'migrations'|'randomness'>;
  actorSchemas: Array<{ id: string; version: number; schema: Json }>;
  contentSchemas?: Array<{ id: string; version: number; schema: Json }>;
  dependencies?: Array<{ id: string; versionRange: string; required: boolean; digest?: string }>;
  entrypoints: { validateIntent: string; resolve: string; project?: string };
  ui?: UiDefinitionV2[]; migrations?: MigrationDeclaration[];
  limits: { maxSteps: number; maxEffects: number; maxEvents: number; maxPendingWindows: number };
}
interface ActionIntentV2 {
  operationId: string; campaignId: string; actorId: string; actionId: string;
  module: ModuleRef; actorRevision: number; input: Json;
  targets?: TargetRef[]; expectedContextRevision?: number; offline?: boolean;
}
interface RandomRequest { requestId: string; kind: 'die'|'pool'|'draw'; count: number; sides?: number; labels?: string[]; }
interface RandomResult { requestId: string; values: number[]; source: 'host-csprng'|'recorded'; transcriptHash: string; }
interface ResolutionContext { state: Json; intent: ActionIntentV2; random: RandomResult[]; now: string; }
interface ResolutionResult {
  status: 'resolved'|'pending'|'rejected'; effects: EffectV2[]; events: EventV2[];
  randomRequests?: RandomRequest[]; window?: ReactionWindow; reasonCode?: string;
}
interface EffectV2 {
  effectId: string; kind: 'set'|'add'|'remove'|'create'|'delete'|'emit';
  target: TargetRef; path?: string; value?: Json; amount?: number; visibility?: Visibility;
}
interface EventV2 { type: string; payload: Json; visibility: Visibility; actorId?: string; }
interface ReactionWindow {
  windowId: string; parentOperationId: string;
  eligible: Array<{ principalId: string; actions: string[] }>;
  deadline: string; order: 'priority-then-submission'|'module-defined'; state: Json;
}
interface UiDefinitionV2 {
  id: string; kind: 'sheet'|'action-panel'|'brick'; fields: UiField[]; actions: UiAction[];
}
interface UiField { path: string; label: string; control: 'text'|'number'|'select'|'resource'|'badge'; readOnly?: boolean; visibleWhen?: Json; }
interface UiAction { actionId: string; label: string; inputSchema?: Json; offline: 'queue'|'host-only'|'forbidden'; }
interface MigrationDeclaration { fromSchema: number; toSchema: number; kind: 'declarative'; steps: Json[]; reversible: boolean; }
```

## Lifecycle and authority

The host validates the campaign pin, dependency closure, principal permission, actor revision, input, target visibility and execution budget; asks the module for random requests; generates and records a canonical transcript; runs the resolver with committed state plus that transcript; validates proposed effects; opens a durable reaction window if needed; then atomically commits state, events, receipts and redacted projections. A pending result is resumable by window ID and never commits client-local state.

The host decides authorization, hidden data, random values, ordering, budgets, transaction boundaries and GM overrides. Modules propose legal actions/effects; they cannot grant access or bypass projections. `module-defined` ordering is valid only with a bounded deterministic priority function; ties use stable IDs and submission sequence. Time is supplied as input. A GM override appends principal, reason, operation/window, prior proposal and module reference; it never rewrites history.

Offline intents retain operation IDs and base revisions. Reconciliation reruns current validation and returns applied, pending review, conflict or rejection. Cached sheets are read-only offline unless an action declares `queue` and can be revalidated.

## Determinism and extension boundary

The transcript includes request IDs, die/pool shape, values, source, module reference and hash. Replaying the same committed snapshot, intent, transcript and module digest must produce the same result; mismatches reject. The host enforces AST steps, effects, events, pending windows, payload size and wall-clock limits. No `Math.random()` or mutable global state is allowed.

Start with a documented JSON Schema 2020-12 subset, bounded expression/effect DSL and declarative UI. Exceptional mechanics require a reviewed host capability with a narrow versioned schema and budget. Never execute downloaded JavaScript as a module.

## Worked architectural examples

These are architecture examples, not licensed content claims.

- **Attack (Revised 5e-shaped):** intent names attacker, action and target; resolver requests d20 then damage only after hit; proposes public hit/miss and target HP effects; a defensive reaction may suspend before commit.
- **Fireball (Revised 5e-shaped):** intent names a declared zone/shape; resolver requests damage and per-target saves; proposes visibility-filtered effects. Geometry and save semantics belong to the module.
- **Shield (Revised 5e-shaped):** a pending window exposes only the triggering summary and eligible defender; acceptance consumes a declared resource and creates a temporary defense effect; host orders and commits reaction/continuation atomically.
- **Fighter feature (Revised 5e-shaped):** a feature declares trigger, resource cost and effect graph; resolver proposes a modifier/extra action keyed by feature ID/version, without a Core class branch.
- **Dice-pool success (Testbed):** resolver requests d6s, counts threshold successes, computes degree, and proposes stress/hope or consequence effects. Zones use module-defined adjacency, not square-grid assumptions.

Both systems implement the same intent/random/effect/event/UI contracts while differing in actor schema, resource names, pool interpretation, timing and geometry. V1 cannot implement these examples.

## Compatibility and migration

V1 manifests remain loadable by the existing V1 loader/registry and executor. A future campaign record stores an explicit contract family plus exact module ID/version/digest; absent family means V1 for existing rows. V1 fixture modules remain immutable. No live ruleset switch is allowed.

Actors retain stable IDs and V1 versions. Migration is an explicit campaign operation: verify source pin and dependency closure, create a backup, run a bounded declarative transform, validate all actor/content records, append migration/audit events, then change the pin atomically. Missing or incompatible modules leave the campaign readable in its old version and block migration. No automatic V1-to-Revised-5e conversion is implied.

Backups must add contract family, dependency closure, digests, migration history and transcript policy while continuing to restore historical layouts. Restore fails closed when an exact dependency is unavailable and keeps current staging/rollback behavior. Browser layouts, caches and private drafts remain excluded unless a future archive format says otherwise. Historical archive QA and real-device evidence are not satisfied by this RFC.

## Acceptance tests for a future implementation

Test valid/invalid manifests and dependencies; permission and hidden-target rejection; stale revision/idempotency; transcript replay and mismatch; budget exhaustion; reaction ordering/resume/expiry; cross-actor atomic effects; offline retry/conflict; V1 fixture loading; migration backup/failure/restore; and distinct Revised 5e-shaped, Testbed and third-module fixtures. None of these V2 tests exist today.
