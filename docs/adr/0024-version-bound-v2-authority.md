# ADR 0024: Version-bound V2 authority transactions

- Status: Accepted for the default-off, loopback, single-process V2 host scope
- Date: 2026-10-18
- Issue: #145 (parent tracker #131)

## Context

The V2 extension, effect, reaction, and receipt kernels already share the host's SQLite connection with the V2 campaign lock, membership, and grant records. They did not previously bind a durable pending continuation to the authority state that existed when it was suspended. Re-reading current rows alone does not identify a change-and-change-back sequence, nor does it ensure all permission inputs share a commit boundary.

## Decision

Keep the existing co-located SQLite design and add a campaign-scoped authority epoch. SQLite triggers advance the epoch in the same transaction as changes to the lock, memberships/credentials, actor grants, entity owner/descriptors/capabilities, and entity visibility/type. Mutation kernels capture and recheck this epoch under `BEGIN IMMEDIATE`. Pending commands persist the epoch; continuations require it to remain unchanged and reauthorize the actor and all recorded responders. Mismatch fails closed; the parent operation receives no effects. The epoch is deliberately campaign-wide so an authority mutation in one area conservatively invalidates any suspended operation in that campaign.

The rejection of an in-flight command rolls back all command effects, events, receipts, randomness transcript commitments, and authority edits made in that same transaction. Existing durable protocol terminal-conflict records remain the only explicitly allowed outcome for an invalidated pending continuation.

## Consequences

The supported ordering is bounded to one configured campaign and one local host process/database. Competing SQLite writers serialize around `BEGIN IMMEDIATE`; the command sees a prior committed authority change, or the change follows a committed command and gates subsequent requests. This is not a multi-process deployment guarantee and does not establish production identity, backup, power-loss, or shared-filesystem behavior. Full details are in [V2 authority and transaction consistency](../v2-authority-consistency.md).

V1 semantics and immutable pinned locks are unchanged. #145 remains open for review and any broader production-authority acceptance; this ADR does not declare tracker #131 or production modularity complete.
