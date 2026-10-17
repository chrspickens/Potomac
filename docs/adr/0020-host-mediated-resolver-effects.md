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

## Isolated spike evidence

The separate draft PR [#130](https://github.com/chrspickens/Potomac/pull/130), commit `f06307b`, implements an experimental SQLite kernel without importing the V1 host or rules engine. Its nine-test suite demonstrates the following isolated properties:

- Multi-entity effects use expected revisions, deterministic effect ordering, authorization and injected schema/handler validation inside one `BEGIN IMMEDIATE` transaction.
- Invalid paths, unsupported handlers, non-finite numeric results, unauthorized targets, stale revisions, conflicting paths and later validation failures leave all entities unchanged.
- Reaction submission, submission record, validated effects, operation receipt with canonical payload hash, terminal window transition and event are committed together. Failure injection after submission, effects, receipt, window transition and event rolls the transaction back.
- Exact operation retries return the original receipt; the same operation ID with a different canonical payload hash is rejected.
- Responder action IDs are checked against per-responder permitted actions. The prototype covers submission ordering, decline, expiry, duplicate/terminal retries, disconnected pending retry and stale continuation effects.
- A pending continuation survives SQLite close/reopen and resumes using an injected host clock.

These are proven properties of the isolated prototype and its SQLite tests, not production guarantees. The spike does not prove power-loss durability, filesystem recovery, distributed transactions, V1 authorization integration, shared schema validation, production backup/offline integration, encrypted hidden state, random-transcript persistence, priority-based simultaneous reactions, or final timeout policy.

## Follow-up / validation

The isolated PR #130 spike now addresses the earlier P0 separation defect at commit `f06307b`: its nine focused tests cover one SQLite transaction for reaction submission, validated effects, receipt, terminal window state and event, with failure injection at five boundaries. It also covers canonical operation hashes, action eligibility, deterministic prototype ordering, decline, expiry, duplicate/terminal retry, stale revisions and SQLite reopen recovery.

Keep this ADR Proposed. Before architectural approval, a production-oriented implementation must preserve that transaction boundary and add shared host authorization/schema adapters, declared effect-handler conflict/isolation semantics, durable event/replay integration, backup/offline receipts, hidden-state projections, random-transcript persistence, and reviewed reaction priority/timeout/disconnect policy. The spike proves isolated SQLite properties, not power-loss durability, filesystem recovery, distributed coordination or production readiness.
