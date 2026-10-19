# ADR-0018: Compose campaign workflow from host session context and authorized navigation intents

- Status: Proposed for v0.8 issue #90
- Date: 2026-10-13

## Context

Potomac now has campaign, Characters, Encounters, Table, Lore, Maps and Workspace capabilities, but v0.8 needs one coherent GM preparation-to-play journey and independent player navigation. The existing `Session` resource and derived `session.activeEncounter` already own campaign-wide live context. Workspace bindings and app handoffs already carry local selections. Adding a route-specific session store, persisted navigation history, or permission-bearing link tokens would duplicate authority and create privacy risks.

## Options considered

1. Add a Campaign Workflow record and make it the new session authority. This would duplicate durable Table session state and require migration/conflict rules for two authorities.
2. Let routes, dashboard bindings or search results update the active encounter. This is convenient but lets local presentation state mutate campaign context and could turn navigation into a permission grant.
3. Compose the workflow from the existing host session/encounter projections and pass versioned, stable-ID navigation intents through existing authorized adapters. This preserves current contracts and keeps local selection independent.

## Decision

Choose option 3. v0.8 defines a versioned `potomac.navigation.v0.8` client intent containing campaign ID, target kind and stable target ID. The destination reauthorizes and fetches the target through its existing app adapter. A route, Workspace binding, search suggestion, map/Lore link or browser history entry can never change `session.activeEncounter`, grant access or carry a write command.

Campaign Home is a composed view over authorized campaign/session/activity queries, not a replacement dashboard or a persisted workflow record. GM activation, session start/pause/resume/end and encounter lifecycle remain existing typed host commands. The public session vocabulary remains `idle | active | paused | ended`; implementation spellings such as `finished`/`finish` are normalized at a versioned adapter boundary. Search and deep links use generic unavailable outcomes for inaccessible or nonexistent targets.

## Consequences

No new workflow table, navigation-token persistence, archive format, authorization path or game-system-specific behavior is required for v0.8. Implementations must add focused adapter and host tests so full apps and bricks cannot diverge. Search, links, SSE, replay, snapshots and offline caches all need the same pre-serialization authorization policy. Browser-local history/layout/selection remains useful but is not recoverable campaign state.

The approach limits deep links to one campaign and one explicit target hop. A future multi-campaign or shareable-link feature would require a separate contract and threat model. Revocation cannot erase previously downloaded local copies, so the UI must label stale/offline data honestly.

## Follow-up / validation

Validate with the two-system GM + Player A + Player B fixture: open every app from Campaign Home, a Workspace brick, a map/Lore relationship and search; confirm only the GM can transition session state, neither player changes shared context, inaccessible targets reveal no metadata, SSE reconnect converges by cursor/snapshot, and v5 backup/restore preserves session/encounter IDs without storing local navigation state.

## Usability note: experimental V2 campaign entry

Campaign Home now exposes the bundled trusted V2 catalog to a GM on a fresh loopback host, labels the choice experimental, and opens the generic Rules workspace after host-side exact pinning. Enrolled players authenticate with their issued credentials and reach the same Rules workspace from ordinary app navigation. Existing V1 setup/navigation remains unchanged. Because the host still has only one configured campaign, this is a one-campaign local onboarding path, not a campaign picker or multi-campaign deployment; see [ADR-0014](0014-normal-ui-trusted-v2-onboarding.md) for the boundary and required host work.
