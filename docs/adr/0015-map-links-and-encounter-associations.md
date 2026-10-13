# ADR-0015: Model map navigation and encounter association as typed authorized links

- Status: Accepted for the 0.7 requirements baseline
- Date: 2026-10-13

## Context

Map pins may navigate between World and Battle scenes and may refer to actors, Lore or encounters. Scenes may also be associated with encounters for default presentation. References must remain stable across renames and must not confer permission. Navigation cycles are useful, but unbounded recursive loading and hidden-target metadata leaks are not.

## Options considered

- Embed target names and content in map pieces: rejected because names become stale and copying content bypasses target authorization.
- Treat a link or encounter association as access: rejected because layout/reference possession is not a grant.
- Persist stable typed target IDs and resolve each target under its own current policy: selected; preserves link identity and allows safe availability responses.

## Decision

Map pieces may carry versioned typed references to a map scene, actor, Lore entry or encounter. Cross-kind map navigation is allowed in all directions. Cycles are allowed, but resolution follows only the explicitly selected edge; the client never recursively fetches a graph. Source visibility does not disclose target ID, title, kind, thumbnail, link count or existence when the target is unavailable.

`MapEncounterLink` is host-owned and campaign-scoped. An encounter may have at most one GM-selected default scene and may have additional explicitly linked scenes. GM-only revisioned commands manage associations. Links do not grant access. Missing/archived endpoints produce a generic unavailable projection and do not cause cascaded deletion. Archiving a scene removes it from default resolution while retaining the association for explicit restore/recovery.

Following an encounter resolves its current default scene under current viewer permissions. A pinned scene ID is personal presentation state and is reauthorized on each load. Neither flow writes `session.activeEncounter` or changes campaign context. App handoff preserves navigation only.

## Consequences

Stable IDs survive target renames. Every resolver must apply authorization at request time and avoid revealing private target metadata. Retaining dangling relations supports recovery and audit, while requiring explicit unavailable states in clients. The single-default constraint keeps encounter-follow behavior predictable without preventing other linked scenes.

## Follow-up / validation

Test all four map-kind link combinations, cycles, hidden/missing/archived and cross-campaign IDs, target rename stability, multiple encounter links with one default, archive/restore and default resolution after revocation. See [Workspace 0.7 requirements](../workspace-0.7-requirements.md) and [issue #70](https://github.com/chrspickens/Potomac/issues/70).
