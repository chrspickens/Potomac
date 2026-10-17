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
