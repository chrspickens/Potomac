# Potomac Rules Modules — Working Plan

**Status:** Draft; V2 execution-kernel spike completed, architecture still provisional
**Updated:** 2026-10-17

## Spike status

The isolated package `packages/v2-execution-kernel` demonstrates atomic multi-entity effects and durable reaction continuations without importing or modifying the V1 host/rules engine. See [the spike report](v2-execution-kernel-spike.md).

| Requirement | Result | Evidence |
| --- | --- | --- |
| Atomic cross-entity effects | Demonstrated in SQLite | Successful two-entity commit; invalid, unauthorized, stale, conflicting and later-handler failures roll back all entities. |
| Crash-atomic reaction completion | Demonstrated at five injected boundaries | Submission, effects, receipt, terminal window state and event share one transaction; every injected failure leaves pending window/no submission/no receipt/no event/no effect. |
| Serializable reaction continuation | Demonstrated in SQLite file | Pending window survives database close/reopen, uses injected time, resolves once, validates per-responder action IDs, and records terminal status. |
| Operation identity | Demonstrated | Canonical payload hashes make exact retries return the original receipt and reject operation-ID reuse with a different payload. |
| V1 compatibility | Preserved by isolation | No V1 runtime imports or production files changed. |
| Production readiness | Not demonstrated | Authorization/schema adapters, effect catalog, backup/offline integration, reaction policy and third-party trust remain open. |

## Next implementation gates

1. Replace injected authorization/schema callbacks with shared host-owned contracts and declared handler registries.
2. Define effect-handler isolation/conflict semantics and add production backup/offline receipts.
3. Define reaction priority, simultaneous windows, deadlines, disconnects, declined-response semantics and hidden state projections; the spike's submission ordering is prototype-only.
4. Add deterministic random transcript persistence/replay.
5. Only then evaluate a production integration PR; retain V1 exact pins and historical archive behavior.

Do not mark V2 final or accept ADR-0020 from this spike alone. Do not create implementation issues or milestones as part of the spike.
