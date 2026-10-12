# ADR-0009: Persist generic session lifecycle separately from encounter state

- Status: Accepted for the host session contract slice
- Date: 2026-10-12

## Context

Issue #37 calls for host-owned durable session state and GM lifecycle commands. The host has revisioned encounter records and campaign context, but those represent prepared/live encounter resources and presentation context. Treating either as the session itself would couple generic session history to encounter selection and permit UI context to act like lifecycle authority.

## Decision

Persist a campaign session projection with a monotonically increasing revision, durable session records with stable IDs and `active`, `paused`, or `finished` status, and operation receipts keyed by stable command IDs. `start`, `pause`, `resume`, and `finish` are host-validated GM-only commands. The state transition, audit event, and idempotency receipt commit in one SQLite transaction. Completed history is retained; a new session uses a new ID.

The initial generic contract does not bind session start to an encounter. Encounter eligibility and atomic coordination with the encounter lifecycle remain a follow-up because the current host's encounter APIs permit lifecycle edits independently and do not define one eligible-start policy.

## Consequences

Clients can restore the current session and history from a durable snapshot and can safely retry a command. The command API is independent of any game system or Table UI. A future encounter-bound start must validate its eligibility on the host and update both aggregates atomically; it must not be implemented as a client-side sequence of unrelated calls.

## Validation

Host tests cover player denial, malformed commands, invalid transitions, revision conflicts, operation ID replay and collision, persistence across host restart, event count, and preservation of prior session history.
