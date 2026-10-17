# Potomac Extension Platform V2 RFC

**Status:** Proposed architecture; critical invariants remain unresolved; documentation-only review for PR #129
**Compatibility:** V1 remains unchanged and loadable. No interface below is implemented.

This RFC prioritizes expressive developer APIs and powerful extension points, but makes the host the authority for authorization, persistence, visibility, randomness, transactionality and resource limits. The design is deliberately conservative about executable third-party code: a Node worker is an isolation/concurrency tool, not a security sandbox.

## Evidence and design posture

V1 evidence is in [the audit](rules-module-audit.md): `ModuleRegistry` is keyed by module ID and accepts only `formatVersion: 1`; `executeAction` supports bounded expressions and self numeric resource changes; `server/host/index.mjs` loads bundled JSON, validates a partial schema, pins campaigns/actors and records filtered events; web fixture/UI code has a separate `GameModule` shape; offline receipts and backup restore already preserve exact module/version identity. V2 must not silently broaden those behaviors.

The recommended design has three separable contracts:

1. Capability registry and exact dependency resolution.
2. Resolver/effect lifecycle and host execution boundary.
3. Extension-defined entities, commands, workflows and UI contributions.

## Contract 1 — capability registry and dependency resolution

### Alternatives

| Alternative | Benefit | Cost / decision |
| --- | --- | --- |
| Keep V1 ID-only registry | Small migration; simple lookup | Cannot parallel-install versions, lock digests, express optional capabilities or reject conflicts. **Reject.** |
| Semver ranges resolved at runtime | Convenient upgrades and authoring | Replays/backups can change meaning; network/package availability becomes gameplay state. **Reject for campaigns.** |
| Exact lockfile resolved at campaign install | Reproducible, offline-safe, backupable, supports parallel versions | More metadata and explicit upgrade/migration workflow. **Recommend.** |
| Global singleton capability versions | Easy sharing | Cross-campaign leakage and incompatible modules in one host. **Reject.** |

### Proposed interfaces

```ts
type CapabilityId = string; // stable reverse-domain ID, e.g. "potomac.rules.v2"
type Version = string;      // validated SemVer; never display-name identity
type Digest = string;       // sha256:<lowercase hex>
type ContractRef = { id: CapabilityId; apiVersion: Version };

interface CapabilityManifest {
  id: CapabilityId;
  api: ContractRef;                 // public contract compatibility
  implementationVersion: Version;   // implementation metadata, never a compatibility promise
  digest: Digest;                   // immutable bytes/provenance identity
  kind: 'module' | 'library' | 'resolver' | 'entity' | 'ui';
  provides: Array<{ id: CapabilityId; apiVersion: Version; optional?: boolean }>;
  requires: DependencyDeclaration[];
  conflicts?: ConflictDeclaration[];
  trust: 'bundled-trusted' | 'declarative-untrusted' | 'reviewed-handler';
}
interface DependencyDeclaration {
  id: CapabilityId; apiRange: string; optional: boolean;
  reason?: string; compatibleWith?: CapabilityId[];
}
interface ConflictDeclaration { id: CapabilityId; apiRange?: string; reason: string; }
interface CapabilityLock {
  lockVersion: 1; campaignId: string; entries: LockedCapability[];
  rootModule: { id: CapabilityId; version: Version; digest: Digest };
}
interface LockedCapability {
  id: CapabilityId; apiVersion: Version; implementationVersion: Version;
  digest: Digest; source: 'bundled' | 'installed' | 'archive'; optional: boolean;
}
interface ResolutionReport {
  status: 'resolved' | 'missing' | 'incompatible' | 'conflict' | 'digestMismatch';
  missing: DependencyDeclaration[]; conflicts: ConflictDeclaration[];
  selected: LockedCapability[]; diagnostics: string[];
}
```

Invariants:

- IDs are stable, lowercase namespaced identifiers. Display names never identify capabilities.
- API compatibility is evaluated separately from implementation version. A campaign lock records exact implementation version and digest for every selected capability, including transitive dependencies.
- Two implementations of the same capability may be installed and selected by different campaigns or lock entries. A single lock cannot select two incompatible providers for the same required capability unless the contract explicitly permits namespaced instances.
- Optional dependencies must be absent-safe: a module must declare the behavior it loses when unavailable. Optionality cannot expand permissions.
- Conflicts are checked before registration completes and again when resolving a campaign lock. Missing, incompatible, digest-mismatched and conflicting dependencies fail closed with stable diagnostic codes.
- Registration is staged: parse/size limits, manifest validation, digest/provenance verification, API compatibility, dependency declaration checks, conflict checks, then atomic publication. Failed registration has no partial visibility.
- V1 registration remains a compatibility adapter: `formatVersion: 1` modules are exposed as `potomac.rules.v1`, selected by the existing exact `(id, version)` campaign pin, and never coerced into a V2 lock.

Registration lifecycle: `discover -> validateManifest -> verifyDigest -> stage -> resolveDependencies -> publish -> lock`. Uninstalling or replacing a capability is blocked while any campaign, archived lock or pending operation refers to its exact digest; garbage collection requires an explicit retention policy.

Failure behavior: unavailable optional capability yields a registration-time degraded declaration only if the module supplies a safe fallback; unavailable required capability blocks campaign activation and restore. A lock never silently re-resolves to a newer implementation. Backup manifests must include the lock closure; restore must verify exact digests or preserve the campaign as unavailable/read-only.

### Acceptance tests

Test stable-ID validation, API-versus-implementation compatibility, duplicate providers, parallel versions, optional missing providers, explicit conflicts, digest mismatch, failed staged registration, exact lock serialization, backup/restore closure, V1 fixture loading, and campaign isolation when two locks select different implementations.

## Contract 2 — resolver/effect lifecycle and host boundary

### Alternatives

| Alternative | Benefit | Cost / decision |
| --- | --- | --- |
| Resolver directly mutates DB | Maximum power | Breaks atomicity, replay, authorization and trust boundaries. **Reject.** |
| Pure declarative resolver only | Strong safety and replay | Cannot express all workflows or unusual effects. **Use as default, not sole option.** |
| Arbitrary JS in a worker | Developer power | Worker is not a security boundary; code can exploit runtime/kernel bugs or exfiltrate through granted capabilities. **Reject for untrusted code.** |
| Host-mediated capability handlers | Expressive exceptional behavior with explicit schemas/budgets | More host surface and review burden. **Recommend for trusted bundled/reviewed handlers only.** |

### Proposed interfaces

```ts
interface ResolverRef { id: CapabilityId; apiVersion: Version; digest: Digest; }
interface ActionIntent {
  operationId: string; campaignId: string; principalId: string; actorId: string;
  resolver: ResolverRef; commandId: string; baseRevisions: Record<string, number>;
  input: JsonValue; targets?: TargetRef[]; offline: boolean;
}
interface RandomRequest {
  requestId: string; kind: 'die' | 'pool' | 'draw'; count: number;
  sides?: number; labels?: string[]; visibility?: Visibility;
}
interface RandomTranscript {
  transcriptId: string; requests: RandomRequest[]; results: RandomResult[];
  resolver: ResolverRef; stateHash: Digest; intentHash: Digest;
}
interface SemanticOutcome { kind: string; degree?: number; tags?: string[]; data: JsonValue; visibility: Visibility; }
interface ProposedEffect {
  effectId: string; handler: CapabilityId; target: TargetRef; payload: JsonValue;
  preconditionHash?: Digest; visibility: Visibility;
}
interface ResolverProposal {
  status: 'resolved' | 'pending' | 'rejected'; outcomes: SemanticOutcome[];
  effects: ProposedEffect[]; events: ProposedEvent[]; randomRequests?: RandomRequest[];
  continuation?: Continuation; reactionWindow?: ReactionWindow; rejection?: Rejection;
}
interface ProposedEvent { type: string; payload: JsonValue; visibility: Visibility; entityIds: string[]; }
interface Continuation {
  continuationId: string; resolver: ResolverRef; state: JsonValue;
  resumeOn: 'reaction' | 'command' | 'timeout'; expiresAt: string; step: number;
}
interface ReactionWindow {
  windowId: string; continuationId: string; eligible: EligibleReaction[];
  ordering: 'priorityThenSubmission' | 'explicitSequence'; deadline: string;
  visibleContext: JsonValue;
}
interface EffectHandlerDescriptor { id: CapabilityId; apiVersion: Version; atomic: boolean; maxPayloadBytes: number; }
interface ExecutionLimits { maxSteps: number; maxEffects: number; maxEvents: number; maxBytes: number; maxContinuationDepth: number; }
interface Rejection { code: 'unauthorized'|'stale'|'invalid'|'unsupported'|'budget'|'conflict'|'unavailable'; message: string; safeDetails?: JsonValue; }
```

The public resolver API is a pure protocol: committed authorized state plus intent, recorded randomness, supplied time and bounded context in; semantic outcomes, proposed effects, events or a serializable continuation out. Multiple resolver implementations may be selected inside one module by command or content ID; the host validates every `ResolverRef` against the capability lock. A module may use a d20 resolver for one command and a dice-pool resolver for another without a Core branch.

Host execution sequence:

1. Authenticate principal and reauthorize campaign/module/resolver, command, actor, targets and hidden fields.
2. Load committed revisions and verify `operationId`/payload identity; reject stale or conflicting base revisions unless the command explicitly declares a safe commutative policy.
3. Validate input, limits and target visibility. Ask the resolver for random requests; host generates values and records the transcript before resolution.
4. Invoke the resolver using only an immutable projection. Validate semantic outcomes and every effect against the registered typed handler, targets, permissions, visibility and limits.
5. If pending, persist only a bounded continuation and reaction window; do not partially commit gameplay effects. On resume, reauthorize eligibility and verify continuation/resolver/digest/hash.
6. Apply all accepted cross-entity effects, state revisions, events, operation receipt and visibility projections in one transaction. Commit failure leaves no partial effect.
7. Publish filtered events; replay uses the stored transcript and exact resolver digest. A GM adjudication appends a compensating/audit event and may supply an explicit replacement proposal, never mutate history.

Typed effect handlers are host capabilities such as `entity.patch`, `resource.delta`, `condition.add`, `workflow.transition` or `event.emit`. The handler owns schema validation, authorization hooks, conflict rules and atomic application. Modules may propose effects but never choose an arbitrary handler implementation or write path. Cross-entity effects must list all target IDs before commit so authorization and revision checks are complete.

Trust model: bundled trusted code may use a reviewed host handler under process-level deployment trust; declarative/untrusted modules may only use the DSL and registered handlers. A Node worker can enforce time/memory accounting and prevent accidental blocking, but it MUST NOT be described as a security sandbox. Third-party executable extensions require an external isolation/capability product decision and are out of scope here.

### Acceptance tests

Test two resolvers in one module, deterministic transcript replay and hash mismatch, permission/visibility rejection before resolver execution, stale multi-entity conflict, atomic cross-entity rollback, handler schema rejection, bounded continuation serialization/depth/expiry, reaction ordering/tie-breaks/disconnect resume, GM adjudication audit, offline pending/rejection and V1 action behavior unchanged.

## Contract 3 — extension-defined entities, commands, workflows and UI

### Alternatives

| Alternative | Benefit | Cost / decision |
| --- | --- | --- |
| Add every entity/command to Core | Uniform product code | System-specific branches, schema collisions and migration coupling. **Reject.** |
| Store arbitrary JSON and let clients render it | Fast experimentation | No authorized query/command boundary, unsafe UI and weak migration. **Reject.** |
| Host-registered typed extension descriptors | New entities/commands/workflows with one authorization/persistence path | Requires descriptor validation, generic projections and migrations. **Recommend.** |

### Proposed interfaces

```ts
interface EntityTypeDescriptor {
  typeId: CapabilityId; schemaVersion: number; schema: JsonValue;
  visibilityPolicy: CapabilityId; commands: CommandDescriptor[]; workflowTypes?: WorkflowDescriptor[];
  migrations?: MigrationDeclaration[];
}
interface CommandDescriptor {
  commandId: CapabilityId; inputSchema: JsonValue; authorization: AuthorizationScope;
  resolver: ResolverRef; offline: 'queue' | 'hostOnly' | 'forbidden'; idempotent: boolean;
}
interface AuthorizationScope {
  roles?: Array<'gm'|'player'>; ownerField?: string; relation?: CapabilityId; requires?: JsonValue;
}
interface WorkflowDescriptor {
  workflowType: CapabilityId; states: string[]; transitions: TransitionDescriptor[]; continuationSchema: JsonValue;
}
interface TransitionDescriptor { id: string; from: string[]; to: string; commandId: CapabilityId; }
interface UiContribution {
  contributionId: CapabilityId; owner: CapabilityId; kind: 'application'|'sheet'|'brick'|'actionPanel';
  version: Version; query: QueryDescriptor; fields: UiField[]; actions: UiAction[]; accessibility: AccessibilityContract;
}
interface QueryDescriptor { entityType: CapabilityId; projection: string[]; relation?: CapabilityId; maxRows: number; }
interface UiAction { commandId: CapabilityId; label: string; inputSchema?: JsonValue; disabledWhen?: JsonValue; }
interface UiField { path: string; label: string; control: 'text'|'number'|'select'|'resource'|'badge'|'list'; readOnly: boolean; visibleWhen?: JsonValue; }
interface AccessibilityContract { keyboard: true; label: string; pendingState: true; unavailableState: true; offlineState: true; }
```

Invariants: entity type, command, workflow and contribution IDs are stable and namespaced; all records carry campaign scope, type/version, stable ID and revision; host persistence is generic but host validation/authorization is authoritative. A UI query is a projection request, never a grant. A brick’s binding, hidden control or context key cannot confer read/write permission. Contributions must reference declared entity fields and commands; registration rejects missing fields/actions, unsafe control types, unbounded lists, inaccessible projections or unsupported schema features.

Commands are the same host-bound operations used by full apps and bricks. Offline commands carry campaign/member/entity/module lock, base revisions and stable operation IDs; `hostOnly` is disabled offline and `queue` returns pending until revalidated. Workflows persist state and bounded continuation data, not executable closures. Transitions are host-authorized, revisioned, idempotent and audit-evented.

Migration is type-scoped and explicit: backup first, validate source/destination versions and dependency lock, transform through bounded declarative steps, validate all records, then commit type/version changes and migration events atomically. A missing extension leaves records unavailable/read-only rather than being silently dropped. Backup/restore includes extension descriptors, exact lock closure, entity records, workflow state and migration history; browser layout/cache/private drafts remain excluded as in V1.

### Acceptance tests

Test a custom entity with GM/player projections, owner/relation permissions, command rejection, workflow transition/timeout/resume, offline queue/conflict, backup/restore/migration, generic app and brick rendering, safe field/action reference rejection, keyboard/pending/offline/unavailable UI states, and no `moduleId` conditionals in Core.

## Three validation examples

### Revised 5e-shaped action with reaction

The module declares `attack.resolve` and `defense.reaction` commands, uses a d20 resolver for the attack and a `resource.delta`/`condition.add` handler for effects. On a hit it proposes a damage outcome and target effect, then creates a reaction window exposing only the triggering attack summary to eligible defenders. `Shield` is a module command whose acceptance resolves the continuation before damage commits. The generic host capabilities required are random transcript, reaction persistence/order, visibility-filtered projections and atomic cross-entity commit. Attack math, defense rules and resource names remain module-specific.

### Dice-pool Testbed action

The module selects a `dice-pool.resolve` implementation for `instinct.check`, requests a d6 pool, counts successes and proposes `stress.delta` plus a consequence event. The generic host supplies deterministic randomness, effect transactionality, continuation/offline handling and projection filtering. Success counting, stress thresholds and zone adjacency are module capabilities/data, not Core branches.

### Custom starship subsystem

An extension registers entity type `example.starship.reactor`, schema version 1, command `example.starship.reactor.route-power`, workflow `overheat-recovery`, an owner/GM authorization policy, and a sheet plus `starship.reactor` brick. The command selects a resolver that proposes a `resource.delta` heat effect and `workflow.transition` when thresholds are crossed. Generic host capabilities are entity persistence, authorization, typed command dispatch, workflow durability, offline receipts, query projections and UI contribution validation. Reactor thresholds, subsystem fields, power routing and layout are extension-specific.

## Ranked risks and unresolved choices

1. **Critical — executable trust model:** exact security boundary for third-party code remains unresolved; Node workers are explicitly insufficient. V2 should ship declarative/reviewed handlers only until an external sandbox/capability decision is accepted.
2. **Critical — atomic effect semantics:** handler protocol, isolation level and cross-entity conflict model need an executable prototype before acceptance.
3. **High — dependency provenance:** digest/signing/trust-root policy and archive distribution are not defined.
4. **High — hidden random transcripts:** decide whether sensitive rolls are encrypted, split into GM/player projections or stored as commitments with later reveal.
5. **High — reaction deadlines:** define clock source, timeout adjudication, disconnect behavior and simultaneous-window semantics.
6. **Medium — query/UI schema:** define a supported JSON Schema subset and accessible generic renderer without reintroducing the current fixture-only assumptions.
7. **Medium — migration expressiveness:** decide whether declarative migrations are sufficient for real content or whether reviewed handlers are needed.

Architecture is not final until risks 1–2 have a tested host-boundary design and risks 3–5 have explicit operational decisions.

## Sequenced implementation PRs after approval

1. **Registry contract:** runtime manifest validator, exact lock model, parallel-version/conflict tests, V1 adapter; acceptance: no partial registration and exact restore rejection.
2. **Pure resolver protocol:** transcript, semantic outcomes, effect descriptors, budgets and two resolvers in one fixture module; acceptance: deterministic replay and rejection matrix.
3. **Host transaction kernel:** typed handlers, multi-entity atomicity, filtered events and idempotency; acceptance: rollback/auth/visibility tests.
4. **Continuations/reactions:** durable windows, ordering, expiry and reconnect; acceptance: disconnect/resume/timeout/replay tests.
5. **Extension data plane:** entity descriptors, commands, workflows, migrations and backup closure; acceptance: starship entity end-to-end plus V1 restore regression.
6. **UI contribution plane:** generic app/sheet/brick descriptors, safe renderer, accessibility and offline states; acceptance: app/brick shared-command tests and unsafe-reference rejection.
7. **System probes:** Revised 5e-shaped, dice-pool Testbed and third module; acceptance: no Core system branches, campaign isolation and exact lock pinning.

No GitHub issues or milestones are created by this RFC.
