# V2 Execution Kernel Spike Report

**Date:** 2026-10-17
**Branch:** `spike/v2-execution-kernel`
**Status:** Experimental evidence; not production behavior

## Purpose

This isolated package tests two V2 invariants without importing or changing the V1 host or rules engine:

1. Multiple typed effects commit atomically against expected entity revisions.
2. A reaction continuation can be persisted as JSON in SQLite, recovered after reopening the database, and resolved once.

Implementation: `packages/v2-execution-kernel/src/index.ts`; tests: `packages/v2-execution-kernel/src/index.test.mjs`.

## Demonstrated

- `EffectProposal` carries operation ID, principal, stable target ID, expected revision, typed handler, path/value or delta, and visibility.
- Effects are validated for JSON safety, path safety, target authorization, expected revisions, duplicate paths and handler payload shape.
- Effects are deterministically ordered by effect ID and target ID, then applied in one SQLite `BEGIN IMMEDIATE` transaction.
- Successful updates advance each target revision exactly once and persist an idempotent operation receipt.
- Invalid paths, unauthorized targets, stale revisions, conflicting effects and a later handler/schema failure leave every entity unchanged.
- `ReactionContinuation` persists window ID, operation ID, serializable state, eligible responders, each responder's permitted action IDs, explicit expiry, ordering policy and status.
- Reopening a SQLite file recovers the pending continuation; a host-supplied clock controls expiry.
- Reaction submission, effect updates, operation receipt, terminal window state and event are committed in one transaction. Injected failures after submission, effects, receipt, window transition and event leave no partial state.
- Operation IDs are bound to canonical SHA-256 payload hashes. Exact retries return the original receipt; reuse with a different payload fails clearly.
- A valid reaction applies its effect and marks the window resolved; a permitted `decline` action marks it declined without effects. Terminal-window retries return the terminal receipt.
- Invalid responders and action IDs are rejected; a disconnected/retried pending submission remains pending; expiry changes the window to `expired`; stale continuation effects fail without consuming the submission.
- SQLite autoincrement submission sequence provides deterministic local submission order for the prototype; all accepted submissions are inspectable in sequence order.
- The same host effect protocol handles a contrasting d6 dice-pool success result; dice interpretation remains outside the kernel.

## Trust model

The spike assumes locally installed, explicitly trusted module implementations. Trust does not bypass host validation, authorization, revision checks, effect handler checks, transactionality or idempotency. The spike executes no downloaded third-party code and adds no worker or sandbox. Executable third-party extension isolation, publisher signatures and trust roots remain deferred; Node workers must not be treated as a security boundary.

## What failed during development

The initial implementation incorrectly read a database-level `changes` value rather than the statement result, causing every successful transaction to roll back. The initial restart test also constructed a host with the ambient wall clock, so a continuation immediately expired. The first review also identified a real design defect: reaction submission, effects and window completion were separate commits. Focused tests caught these defects; the final suite uses statement change counts, injected time, one transaction-scoped effect helper, and failure injection at each commit boundary.

## Limitations and remaining risks

- The kernel uses a deliberately small SQLite schema and two illustrative handlers; it is not a production effect catalog.
- Authorization is an injected callback, not the V1 host's full grants/projection policy.
- Schema validation is an injected callback; a real V2 implementation needs one shared runtime validator and declared entity schemas.
- Reaction ordering is submission order only, appropriate as a local GM-controlled prototype policy. Priority, simultaneous windows, timeout adjudication, responder fairness and disconnect policy need a reviewed product contract.
- Continuation state is JSON-serializable but not encrypted or visibility-projected in this spike.
- The resolver and random transcript protocol is not implemented here; the dice-pool test supplies explicit host values in the test.
- No production backup/archive format, offline receipt integration or migration path is changed. The tested crash guarantee is limited to SQLite transaction rollback/reopen behavior; it is not a claim about power-loss durability, filesystem corruption or distributed recovery.

## Recommendation for ADR-0020

Keep ADR-0020's proposed direction. Strengthen it with the spike's evidence: require a single transaction covering reaction submission, validated effects, receipt, terminal window state and events; statement-level commit verification; canonical operation/effect hashes; explicit expected revisions for every target; deterministic effect/submission ordering; per-responder action authorization; retry-safe reaction submissions; injected time; and restart/failure-injection tests. Do not mark ADR-0020 accepted yet. Its remaining acceptance gates are shared schema/authorization adapters, production conflict/isolation semantics, reaction priority/timeout rules, transcript persistence and backup/offline integration.
