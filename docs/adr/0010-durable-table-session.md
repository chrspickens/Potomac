# ADR-0010: Persist the Table session as a durable resource

- Status: Accepted for the 0.5 requirements baseline
- Date: 2026-10-12

## Context

Workspace 0.4 defines a nullable `session.activeEncounter` context reference, but 0.5 needs session status (`idle`, `active`, `paused`, `ended`), start/end history, host revision, participants' live participation state, a durable timeline and a reconnect cursor. These have lifecycles and audit requirements beyond selecting an encounter. The host remains limited to one campaign, and encounters remain separate persistent campaign resources.

## Options considered

- Add status and timeline fields to the campaign: fewer records, but conflates campaign configuration with an individual play session and makes session history, cursor and lifecycle awkward to version or audit.
- Persist one durable session resource: gives session state its own stable identity, revision and event stream while retaining the single-campaign boundary.
- Keep only `context.activeEncounter`: insufficient to represent pause/resume/end, participation status, verified results or recovery history.

## Decision

Model the current Table session as a host-owned durable resource with a stable `sessionId`, campaign reference, status, current encounter reference, revision, lifecycle timestamps and schema version. There is at most one current live session record per campaign in 0.5; `idle` represents the campaign's session before start or after a session has ended, while an ended session's history remains durable. The exact storage representation may retain prior session records, but a new live session must not overwrite prior history.

The 0.5 public semantic status is `idle | active | paused | ended`, and the public terminal command is `endSession`. An implementation slice that internally uses `finished` or a `finish` command must map those values at its versioned adapter boundary; incompatible spellings must not leak as competing meanings in the Table snapshot or client contract.

The encounter remains a distinct resource with its own preparation and lifecycle. The session's encounter reference is not an authorization grant. Workspace context key `session.activeEncounter` is a derived, read-only reference to the current session's encounter and remains compatible with existing follow bindings. Personal or pinned bindings never write this shared reference.

## Migration of `context.activeEncounter`

Migration runs through a versioned, backed-up, transactional schema migration and is idempotent. It preserves the campaign ID, encounter IDs, event IDs/order, operation IDs/responses and timestamps. If the legacy context is null, create the initial idle session without an encounter. If it references one valid persistent encounter, carry that exact ID into the new session as the current encounter reference; preserve the encounter's own lifecycle and do not infer that a live session is active from the reference alone. The migrated session starts `idle`, since the old field carries no reliable session status or start timestamp. Record a migration audit event with source schema version and the preserved reference.

If the legacy reference is malformed, dangling, ambiguous, or conflicts with a discovered active encounter, fail closed before commit, preserve the source database and provide a recovery path. Never silently clear the reference, recreate an encounter, mark a session active, or synthesize historical roll/session events. Existing clients continue to resolve `session.activeEncounter` through a compatibility projection from the durable session; implementation may remove legacy storage only in a later explicitly versioned migration after consumers are upgraded.

## Consequences

Session commands and events carry their own revision and idempotency identity. Campaign backup/restore includes session records, timeline events, verified-roll receipts and cursors; restore still targets an empty host. A migration can preserve only what legacy data actually records: it cannot reconstruct participation state or prior session boundaries. Implementations must distinguish this migrated idle session from an active play session in UI and authorization checks.

## Follow-up / validation

Exercise fresh and legacy databases with null, valid, dangling and inconsistent `context.activeEncounter`; interrupt and retry migration; verify IDs and event history; then verify start/pause/resume/end and restart/reconnect behavior. See [Workspace 0.5 requirements](../workspace-0.5-requirements.md) and [issue #35](https://github.com/chrspickens/Potomac/issues/35).
