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

## Proposed reframing: Potomac Extension Platform V2

**Design principle:** Potomac optimizes for what sophisticated extensions can *do*, not for how easy they are to *author*. A module developer may need to write typed code and tests; GMs and players should not experience that complexity. The platform must not force exceptional mechanics into a declarative DSL merely to make them 'no-code.'

### Architectural separation

- **Nonreplaceable host guarantees:** identity, authentication, permission enforcement, transactions, persistent event ordering, synchronization, backup integrity and auditing. Extension code may request capabilities but cannot bypass these controls.
- **Versioned capability registry:** discover and resolve extension-provided services by identifier, interface version, implementation version, digest and dependency closure; bind resolved versions to a campaign. Require explicit approval/migration for changes. Reusing registry infrastructure does not imply all capabilities share one implementation or runtime.
- **Game/workflow contributions:** pluggable action resolvers, semantic effect handlers, targeting/spatial logic, initiative/turn models, resource/progression/feature systems, typed entities, commands, application views and bricks, and optional automation providers.
- **Developer authoring modes:** validated content records, composable effect/trigger definitions, and reviewed executable implementations. All must produce host-checkable proposals, not unrestricted authoritative writes.

### Capability contracts (illustrative, not implemented)

```ts
type CapabilityRef = {
  id: string; interfaceVersion: string;
  implementationVersion: string; digest: string;
};
type CapabilityDeclaration = {
  provides?: CapabilityRef[];
  requires?: Array<{ id: string; interfaceVersionRange: string }>;
};
type ExtensionContribution =
  | { kind: 'resolver'; capability: CapabilityRef; definitionSchemaId: string }
  | { kind: 'effectHandler'; capability: CapabilityRef; effectSchemaId: string }
  | { kind: 'spatialPolicy' | 'turnPolicy' | 'progression'; capability: CapabilityRef }
  | { kind: 'entity'; capability: CapabilityRef; entitySchemaId: string }
  | { kind: 'command'; capability: CapabilityRef; inputSchemaId: string }
  | { kind: 'view'; capability: CapabilityRef; viewSchemaId: string };
```

Interface and implementation versions have different purposes: the former governs API compatibility; the latter and digest identify exact replayable behavior. Resolve version ranges at installation/pin time; store exact selected dependencies for restore and replay. Missing or untrusted capabilities fail closed rather than silently choosing an alternative.

### Rules, effects and code

A game action chooses a resolver **per action**, allowing multiple resolver implementations inside one system (for example, d20 and opposed dice pool). A resolver requests host-owned randomness/decisions and proposes semantic outcomes. An effect processor validates and translates typed outcomes into bounded state mutations. The host authorizes actors/targets and commits all changes atomically. Extension implementations must not directly edit tables or read unauthorized state.

Custom code is a first-class *design goal*, not an immediate promise to execute downloaded TypeScript. Before allowing external code, compare isolating runtimes (e.g. separate restricted process or WASM) against malicious input, file/network access, resource exhaustion, determinism and upgrade/replay requirements. Node workers alone are not a sandbox. Initially trusted, bundled implementations may be appropriate, explicitly labeled as such.

Multi-stage resolution should use a deterministic serializable state machine: explicit steps (random request, decision/reaction window, result) and persisted continuation records. An async-looking developer API is permissible only if compiled/translated into replayable steps; do not persist closures or rely on wall-clock callbacks for authority.

### Extend workflows as well as mechanics

A module may contribute novel entities (e.g. a starship or faction), commands, forms, screens and dashboard bricks, plus versioned migrations. Such workflows share host authorization, record ownership, projection filtering, offline reconciliation and backup contracts. The host must check each contributed command's scopes and affected records. This is **not** permission for arbitrary SQL, uncontrolled rendering, or arbitrary network requests.

### Architectural proof cases

1. Run Revised 5e and the dice-pool Testbed in separate campaigns; demonstrate distinct character data, mechanics, resources, maps/turn policies and UI.
2. Register and invoke **two distinct resolvers in a single module** without editing resolver implementations or system-neutral Core paths.
3. Add a novel custom entity with a persistent authorized command and a distinct UI/workflow, plus an audit record.
4. Author a third tiny module solely against documented extension contracts, with no game-specific Core changes.
5. Confirm exact capability/dependency pins, transcript provenance, authorization and V1 archive compatibility after extension registration.

### Scope and unresolved tradeoffs

**First implementation:** V2 manifest, generic registry/dependency pin, versioned resolver/effect interfaces, a minimal feature definition system, safe host-bound execution and one UI/entity contribution seam proven by dual-module slices. **Later:** untrusted code distribution, full designer SDK/no-code editor, AI providers and marketplace or plugin packaging.

Outstanding design decisions: capability ABI stability; isolate/process/WASM choice and trust tiers; effect typing and handler authority; deterministic continuation persistence; resource/turn/spatial API boundaries; UI renderer execution/security; dependency digest/source trust; entity schema versioning and migrations. These require ADRs and tests, not assumptions.
