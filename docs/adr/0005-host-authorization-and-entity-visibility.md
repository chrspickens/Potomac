# ADR-0005: Keep entity authorization and visibility at the host

- Status: Accepted for the 0.4 requirements baseline
- Date: 2026-10-12

## Context

Workspace bricks can follow shared context or pin entity IDs, while 0.3 adds individual members, actor grants, visibility paths and filtered projections. Persistent Characters and Encounters broaden the read surface to searches, relations, event replay, subscriptions, and offline snapshots. A client binding or hidden UI element cannot safely enforce these permissions.

## Options considered

- Host-authoritative member grants combined with field-level filtered projections: central and consistent across apps, bricks, streams and offline sync.
- Client-side filtering based on saved dashboard or role labels: simpler UI implementation but forgeable and prone to leaking fields/events.
- Broad campaign membership visibility: simpler policy but does not meet explicit actor ownership and revocation requirements.

## Decision

The host authenticates the principal and authorizes every query, search, command, relation, snapshot, event, stream and replay. GM-only fields and derived values that depend on them are removed before serialization. Actor grants explicitly separate read and act. Encounter summaries, participants and events use equivalent visibility checks. Workspace bindings are references only and never grant access. Revocation blocks future host access; previously downloaded copies cannot be recalled.

## Consequences

Every new endpoint and event projection needs positive and negative member tests. Inaccessible and nonexistent resources use non-disclosing outcomes. Offline queues remain pending intent and are revalidated against current grants at reconciliation. Data cached before revocation remains a local-copy risk and must be disclosed.

## Follow-up / validation

Exercise two individually enrolled players, crafted bindings, hidden nested fields, derived values, search, SSE replay, offline submission and grant revocation. See [Workspace 0.4 requirements](../workspace-0.4-requirements.md), [ADR-0003](0003-local-enrollment-and-offline-authority.md), and [issues #28–#30](https://github.com/chrspickens/Potomac/issues/28).
