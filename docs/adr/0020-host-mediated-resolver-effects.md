# ADR-0020: Keep resolver proposals pure and commit effects through host capabilities

- Status: Proposed
- Date: 2026-10-17

## Context

V1 `executeAction` is bounded and pure over state/rolls, while the host owns authorization, database writes, event insertion, redaction and idempotency. V2 needs cross-entity effects, semantic outcomes, reactions and continuations without allowing module code to mutate storage or bypass privacy. A Node worker does not constitute a security sandbox.

## Options considered

1. Direct resolver database mutation: expressive but violates atomicity and trust boundaries.
2. Declarative DSL only: safest but insufficient for exceptional mechanics.
3. Pure resolver protocol plus typed host effect handlers; declarative/untrusted modules use only registered handlers, and trusted/reviewed handlers are separately versioned and bounded: selected.

## Decision

Propose option 3. The host supplies authorized immutable state, intent, recorded randomness and bounded context. A resolver returns semantic outcomes, proposed typed effects, events or a serializable continuation. The host revalidates permissions, visibility, revisions, handler schemas and budgets, then atomically commits all cross-entity effects/events. GM adjudication appends audit/compensating history.

## Consequences

The host must define handler contracts, conflict/isolation semantics, continuation storage and reaction ordering. Third-party executable extensions remain out of scope until a separate security decision; workers may help resource accounting but cannot be called a sandbox. Random transcript confidentiality and reaction deadlines remain critical open decisions.

## Follow-up / validation

Prototype two resolvers in one module, deterministic transcript replay, handler rejection, cross-entity rollback, permission-filtered reaction windows, reconnect/expiry and GM adjudication audit tests before accepting.

## Spike evidence and required corrections (2026-10-17)

Experimental [PR #130](https://github.com/chrspickens/Potomac/pull/130) at commit `1c6ecbaa` adds a separate SQLite V2 execution kernel. Its reported six focused tests passed. Source review confirms an explicit `BEGIN IMMEDIATE` transaction, conditional revision updates, effect ordering and persisted operation receipts. An on-disk continuation test closes and reopens SQLite before resolving a reaction. This supports feasibility, **not** acceptance of this ADR or production readiness.

**Critical gap found during code review:** `submitReaction` inserts a reaction submission, calls `applyEffects` (which commits its own transaction), and then separately marks the continuation resolved. Those steps are not one atomic transition. A crash after committing effects but before updating the continuation can leave applied effects with a pending window. Production implementation must atomically persist effects, receipt, reaction acceptance/window transition and relevant events, with recovery tests at each failure boundary. The current six tests do not exercise this crash point.

**Additional correctness gates:**

- Idempotency must bind an operation ID to a canonical intent/effect payload hash; reusing an ID with different content cannot silently return the original receipt.
- Validate and bind submitted reaction `actionId` to eligible actions and the authenticated principal. The prototype only checks responder inclusion, with authorization delegated to an injected effect callback.
- Define how multiple pending responders, duplicate submissions and disconnects interact, including canonical ordering and no-op/decline outcomes. A submitted but unresolved reaction must not remain stranded indefinitely.
- The effect protocol needs full shared runtime schema validation, explicit semantic handler authority, structured paths, finite numeric results and conflict/isolation semantics across multiple effects and target entities.
- Persist a redacted, access-controlled random/decision transcript and use exact capability digests for replay. Neither is implemented by the spike.
- Use shared host authorization and backup/offline adapters before integrating the kernel with V1; continue treating third-party executable modules as explicitly trusted only.

**Status stays Proposed.** The spike proves useful isolated invariants but does not establish a crash-atomic reaction lifecycle. This is a blocking test requirement for any production V2 kernel.
