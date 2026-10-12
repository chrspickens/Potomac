# ADR-0006: Model encounters as persistent resources with explicit activation

- Status: Accepted for the 0.4 requirements baseline
- Date: 2026-10-12

## Context

The 0.3 experiment has fixture encounter summaries and a GM-controlled active encounter context. The Encounters app requires durable preparation, participant references, lifecycle state and restart-safe activation. Context changes already drive follow-bound bricks, so lifecycle transitions must not be confused with presentation bindings.

## Options considered

- Persistent encounter resources with explicit planned/active/completed/archive states and one active session reference: preserves preparation/history and makes transitions auditable.
- Treat encounters as transient session context: simpler but loses reusable preparation and restart history.
- Automatically complete the prior encounter whenever another is activated: convenient but hides a meaningful GM decision and can corrupt lifecycle history.

## Decision

Encounters are stable host-owned resources. The campaign has at most one active encounter. A GM explicitly activates, ends/completes, reopens, or archives encounters through revisioned commands. Activation and active-context update commit atomically; activation of another encounter does not silently complete the prior one. Participants reference existing compatible non-archived characters. Following bricks resolve authorized context; pinned bindings and layouts remain unchanged.

## Consequences

Encounter commands validate lifecycle, revision, participant integrity and authorization. Active references must be cleared or participants removed before archiving related records. 0.3 fixture IDs and active context must migrate intact. Completed encounters require an explicit reopen transition before reactivation.

## Follow-up / validation

Test creation, edits, participant changes, activation, context switching, completion/reopen, archive constraints, restart, duplicate commands and visibility filtering. See [Workspace 0.4 requirements](../workspace-0.4-requirements.md) and [issue #29](https://github.com/chrspickens/Potomac/issues/29).
