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
- `ReactionContinuation` persists window ID, operation ID, serializable state, eligible responders, explicit expiry, ordering policy and status.
- Reopening a SQLite file recovers the pending continuation; a host-supplied clock controls expiry.
- A valid reaction applies its effect and marks the window resolved. Duplicate operation/responder submissions return `duplicate` and do not reapply the effect.
- Invalid responders are rejected; a disconnected/retried pending submission remains pending; expiry changes the window to `expired`; stale continuation effects fail without consuming the submission.
- The same host effect protocol handles a contrasting d6 dice-pool success result; dice interpretation remains outside the kernel.

## Trust model

The spike assumes locally installed, explicitly trusted module implementations. Trust does not bypass host validation, authorization, revision checks, effect handler checks, transactionality or idempotency. The spike executes no downloaded third-party code and adds no worker or sandbox. Executable third-party extension isolation, publisher signatures and trust roots remain deferred; Node workers must not be treated as a security boundary.

## What failed during development

The initial implementation incorrectly read a database-level `changes` value rather than the statement result, causing every successful transaction to roll back. The initial restart test also constructed a host with the ambient wall clock, so a continuation immediately expired. Focused tests caught both defects; the final suite passes after using the statement's change count and injecting the same host-supplied clock across restart.

## Limitations and remaining risks

- The kernel uses a deliberately small SQLite schema and two illustrative handlers; it is not a production effect catalog.
- Authorization is an injected callback, not the V1 host's full grants/projection policy.
- Schema validation is an injected callback; a real V2 implementation needs one shared runtime validator and declared entity schemas.
- Reaction ordering is submission order only. Priority, simultaneous windows, timeout adjudication and disconnect policy need a reviewed contract.
- Continuation state is JSON-serializable but not encrypted or visibility-projected in this spike.
- The resolver and random transcript protocol is not implemented here; the dice-pool test supplies explicit host values in the test.
- No production backup/archive format, offline receipt integration or migration path is changed.

## Recommendation for ADR-0020

Keep ADR-0020's proposed direction. Strengthen it with the spike's evidence: require statement-level/transaction-level commit verification, idempotent operation receipts, explicit expected revisions for every target, deterministic effect ordering, retry-safe reaction submissions, injected time, and restart tests using the persisted continuation. Do not mark ADR-0020 accepted yet. Its remaining acceptance gates are shared schema/authorization adapters, production conflict/isolation semantics, reaction priority/timeout rules, transcript persistence and backup/offline integration.
