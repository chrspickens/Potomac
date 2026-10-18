# ADR-0023: Suspend and resume V2 commands through durable reactions

- Status: Proposed; integration deferred pending a transaction-aware continuation seam
- Date: 2026-10-18

## Context and current transaction map

The extension kernel owns command execution. `executeCommand` opens `BEGIN IMMEDIATE`, authenticates the principal, reads the exact campaign lock and entity revisions, authorizes command intent, resolves host-supplied randomness, validates semantic effects, applies them with `effects.applyInTransaction`, and commits extension events and the idempotent command receipt. It rejects nested transactions.

The reaction kernel persists windows, choices, terminal events and effects in SQLite. `submit`, `expire` and `adjudicate` each open their own `BEGIN IMMEDIATE`; completion and `applyEffects` run inside that transaction. `open` currently inserts the window without owning a multi-record transaction. The reaction kernel has no command receipt or authority to run a module resolver.

Therefore, calling `submit` from command execution (or calling `executeCommand` from reaction completion) would nest transactions. Committing a window before the parent command, or resolving the parent after the reaction transaction, would permit orphan pending operations or a terminal reaction with missing/duplicate effects. The semantic effect kernel already has the necessary `applyInTransaction` seam, but the command and reaction kernels do not yet share a transaction coordinator or a pending-command lifecycle.

## Proposed continuation lifecycle

1. The authenticated command starts in the extension kernel's `BEGIN IMMEDIATE` and is validated against current membership/grants, entity revisions, command descriptor and exact lock as today.
2. A trusted resolver may return a bounded, serializable suspension proposal: a continuation identifier/state, one or more proposed eligible principal/action pairs, ordering, visibility and deadline. The host resolves responder identities against current enrolled members and grants; clients cannot supply eligibility, roles, principals, continuation state, effects or rolls.
3. Before commit, the host stores a pending parent operation containing the original command and resolver identities, authenticated actor principal, exact lock snapshot/digest, expected revisions, canonical request hash, host-owned continuation and visibility. It inserts the durable reaction window and public/filtered audit event in this same transaction. It stores a pending receipt so exact retries report pending without re-resolving or drawing again. No proposed gameplay effect is applied.
4. An authorized responder decision enters one host-owned `BEGIN IMMEDIATE`. Current member/grant/ownership state, exact lock, pending status, reaction eligibility, original actor authority and expected entity revisions are revalidated. The existing reaction kernel records the choice and preserves its ordering and one-decision-per-responder rule.
5. When the existing reaction policy is complete (or expires/is adjudicated), the host invokes a trusted, exact-lock-pinned module resume resolver using the stored continuation and ordered decisions plus any newly host-drawn randomness. It validates and applies the resulting semantic effects through the existing effect kernel. Parent and reaction receipts, events, terminal window state and continuation status commit together.
6. Exact retries return stored projections after reauthorization. Reusing an operation ID with changed payload, stale revisions/continuation, revoked authority or changed lock fails closed. Visibility filtering applies independently to pending windows, choice payloads, random draws, events and receipts.

## Failure and concurrency policy

The only commit boundaries are suspension and terminal completion. An exception at any point before either commit rolls back all writes made in that transaction, including choices, effects, parent/reaction receipts, window transitions and audit events. SQLite's `BEGIN IMMEDIATE` serializes competing submissions on the single host; the losing decision observes the committed choice/window status and cannot apply effects again. Expiry uses host time and enters the same completion path as decline. Simultaneous policy waits for all eligible responders; priority policy follows the existing deterministic priority/submission order. Disconnect/restart leaves a pending row that can be projected and resumed after current authority is checked.

Continuation data is host-owned opaque bounded JSON, not executable code or a database mutation. It is GM/private by default; only a module-declared, host-validated visible context may be projected to responders. The host never trusts caller-supplied identity or permission claims.

## Consequences and limits

This design composes the existing resolver, reaction and effect kernels; it does not add another rules/execution kernel. The host coordinates lifecycle and transaction ownership while rules, eligibility, interpretation, and proposed effects stay module-owned. The first implementation remains gated, loopback-only and limited to trusted bundled modules. This does not close #145's production identity, multi-process, power-loss, archive/restore or publisher-provenance gates, and it does not add offline V2 support.

The implementation must add explicit typed resolver suspension/resume contracts and a transaction-aware reaction-kernel entry point. If those contracts cannot be enforced without exposing SQLite or bypassing effect validation, this ADR remains proposed and the integration must not be advertised as operational.

## Evidence from the current integration attempt

The current API has no method for the extension kernel to atomically persist a pending command and open its reaction window, nor a method for the reaction kernel to resume a command inside its existing transaction. The resolver's `ContinuationRequest` is transcript metadata only; it does not suspend execution. `v2-extensions` now rejects `resumeOn: "reaction"` before applying any proposed effects, and its regression test asserts that no command receipt or effect is committed. `v2-reactions` now rejects nested submission/expiry/adjudication before issuing `BEGIN IMMEDIATE`; the regression test verifies rejection leaves the enclosing transaction owned by its caller.

These are safety guards and seam tests, not the requested HTTP/browser integration. They deliberately leave windows independently usable through their existing standalone kernel contract. A follow-up implementation must introduce the shared command/reaction transaction coordinator and typed resume protocol described above before exposing reaction HTTP routes.
