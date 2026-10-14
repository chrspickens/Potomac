# Potomac Workspace 0.8 — Campaign playability and GM workflow requirements

**Status:** Proposed contract baseline for issue [#90](https://github.com/chrspickens/Potomac/issues/90)
**Version:** 0.8.0-draft.1
**Parent tracker:** [#89](https://github.com/chrspickens/Potomac/issues/89)
**Depends on:** Workspace 0.4–0.7 requirements and ADR-0004–ADR-0017
**Related decision:** [ADR-0018](adr/0018-campaign-workflow-navigation-and-context.md)

This document defines the v0.8 campaign workflow contract. It describes intended behavior and sequencing; it does not claim that the current applications already implement every flow. v0.8 composes the existing single-campaign host, pinned game-system module registry, Workspace bricks, authorization projections, durable Table session, SSE/cursor reconciliation and v5 backup. It adds no combat automation, second session authority, multi-campaign model or production identity system.

## 1. Outcomes and boundaries

The GM can move from preparation to an active Table session and back without losing campaign or encounter context. Players can follow the current session and open authorized characters, maps, Lore and encounter views independently. Full apps and bricks resolve the same host-owned records and commands. Navigation is not authorization, and local selection is not campaign context.

The host remains one campaign pinned to one exact `(moduleId, moduleVersion)`. `Session` remains the sole durable session authority; `session.activeEncounter` remains its derived, nullable stable encounter reference. Existing `MapScene`, Lore, actor, encounter, member/grant, Workspace binding and backup contracts remain authoritative.

Out of scope: multi-campaign navigation, arbitrary cross-campaign links, cloud accounts, public hosting, fog of war, turn order, damage/initiative automation, game-specific assumptions, client-side permission grants, silent last-write-wins, and replacing the customizable Workspace with Campaign Home.

## 2. Versioned contract vocabulary

Every v0.8 query and navigation target uses an opaque stable ID plus a versioned app/target kind. Display names are labels only. A target is one of `campaign`, `table`, `encounter`, `character`, `lore`, `map`, or `workspace`; target IDs are campaign-scoped except the local Workspace target. A deep link is a client navigation intent, not a capability or a persisted authority.

The v0.8 workflow state is derived from existing host records:

| State | Host condition | GM affordances | Player view |
| --- | --- | --- | --- |
| `prepare` | no active Table session; encounter may be `planned` | edit authorized preparation, participants, Lore/map relationships; choose encounter | last authorized snapshot or campaign home |
| `ready` | planned encounter selected as `session.activeEncounter`; no active session | start Table session | current encounter is visible only if authorized |
| `play` | durable session `active` and current encounter reference | pause/end, use existing authorized commands | read current session and authorized projections |
| `paused` | durable session `paused` | resume/end; preparation reads remain available | read-only current session with paused state |
| `wrap-up` | GM ends session; session is `ended`/implementation-compatible `finished` | review history, return to preparation, reopen only through existing encounter command | read retained authorized history; no write implied |

The UI may show friendly labels, but wire adapters MUST normalize implementation spellings to the v0.5 public session vocabulary (`idle | active | paused | ended`). No view transition may create a session or mutate `activeEncounter` merely because a route was opened.

## 3. Required screen and context flows

### GM: preparation → Table → preparation

1. Campaign Home loads an authorized campaign projection, current session snapshot, active encounter summary, recent authorized activity and quick actions. Loading, offline, unavailable and unauthorized states are explicit.
2. The GM opens an existing planned encounter from Home, Encounters, Characters, Lore, Maps or a Workspace brick. The handoff preserves `{campaignId, targetKind, targetId, source}` locally for navigation only.
3. Preparation edits use existing revisioned encounter, participant, map, Lore and character commands. Relationship previews resolve through current authorization. A map/Lore/character view never changes `session.activeEncounter`.
4. The GM explicitly selects/activates an eligible encounter using the existing host command and current revisions. The host atomically validates the encounter, module compatibility, participants and session/context transition. The client reconciles the returned receipt/snapshot.
5. The GM explicitly starts the durable Table session. Table bricks with `follow` bindings resolve the derived `session.activeEncounter`; pinned bricks remain pinned. The current session is broadcast as filtered notification plus durable cursor, not as an authority-changing client event.
6. During play, the GM may pause or end through session commands. A player cannot invoke these commands. The GM may open related records without changing the active encounter.
7. Ending returns the GM to preparation with the encounter and session history available. The previous encounter remains a stable reference; no automatic archive, completion, participant deletion or next-encounter activation occurs.

### Player A and Player B: independent live-session navigation

Each enrolled player loads the authorized session projection and their own authorized character projection. Player A selecting a character, map, Lore article or encounter changes only that browser's local route/selection. Player B receives the same current host session reference but may have a different selected target, dashboard layout, pinned brick and cached data. Neither player's local selection writes shared context. Both clients must converge on committed session changes after SSE notification and snapshot/cursor reconciliation.

If an encounter or related target is not currently authorized, the client shows `Unavailable` without existence, title, count, link target, event or cache metadata. If the target was previously cached, it is marked stale/offline and never presented as current after authorization cannot be revalidated.

## 4. Navigation and context ownership

| Context | Owner | Scope | May change it | Must not do |
| --- | --- | --- | --- | --- |
| Durable session status/current encounter | host session command service | campaign | GM through typed commands | grant access or change from route selection |
| `session.activeEncounter` follow reference | host-derived session projection | campaign | only the authoritative session transition | be overwritten by pinned/local bindings |
| App target/route | browser client | one browser/profile | any authorized user navigation | be treated as permission or write intent |
| Workspace dashboard/layout/bindings | member-scoped local Workspace store | member/browser | that member | expand host reads or mutate session context |
| Pending operation/private draft | member-scoped offline store | member/browser | owning member until submission | appear in authoritative snapshots/events |
| Viewport, selected map piece, expanded panel | app-local UI state | component/browser | local user | write transformed presentation state to host |

Cross-app handoffs preserve campaign and target context as a navigation intent. They re-query the target through the destination app's authorized adapter. Missing, archived, revoked and inaccessible targets share a safe unavailable outcome. Search suggestions, route titles, breadcrumbs, recent activity and link previews follow the same filtering rule.

## 5. Roles, data and actions

| Role | Reads | Writes/commands | Explicitly denied |
| --- | --- | --- | --- |
| GM | full authorized campaign, module metadata, private preparation, session/history, pending proposals and backup status | campaign/encounter/participant/session/Lore/map/actor commands allowed by existing contracts; backup export/restore boundaries; proposal decisions | bypassing revision, module validation or audit; treating host-machine admin as a player role |
| Player A/B | approved campaign metadata; assigned actors; shared/current encounters, maps, Lore, links, session and filtered events | only existing self-service/authorized actor operations and offline proposals; local navigation/layout/drafts | GM preparation, private fields/records, session control, ungranted actors, player map edits, backup export |
| Unauthenticated/unknown | none beyond loopback setup behavior already defined by v0.4 | none | existence probing, search, stream, deep-link resolution |

Role is authenticated and host-derived. A dashboard binding, deep-link parameter, search result, event cursor or cached record never grants access. Authorization is applied before serialization for list/detail/search/count/link/activity/SSE/replay/snapshot/backup content and again at command commit.

## 6. Search and deep-link contract

v0.8 search is an authorized campaign query over existing kinds. It returns bounded result pages containing only `kind`, stable `id`, authorized display label, safe type/status and a destination token/route. It MUST NOT return private titles, snippets, tags, counts, relationship names, hidden IDs, archived/private records, or error differences that reveal their existence. Search is read-only and does not alter active context.

Canonical client intent shape (wire names may be adapted at the existing API boundary):

```ts
type NavigationIntent = {
  contract: 'potomac.navigation.v0.8';
  campaignId: string;
  target: { kind: 'table' | 'encounter' | 'character' | 'lore' | 'map'; id: string };
  source?: string;
};
```

The destination validates campaign identity, target kind and current authorization, then loads through its normal query adapter. A stale or unauthorized target resolves to a generic unavailable state. No route can carry a write command, member/role override, raw record or credential. Link activation is one hop at a time; clients do not recursively prefetch a graph. Existing map/Lore links and Workspace `onOpenApp(appId, entityId)` handoffs should be adapted to this intent without creating a second routing authority.

## 7. Offline, privacy, SSE and backup boundaries

- Offline stores may retain only the member-scoped authorized projections, cursor/session metadata, queued operations and private drafts already defined by v0.4–0.7. Pending means uncommitted.
- Reconnect submits stable operation IDs and original payloads; the host rechecks role, grants, revisions, module/schema versions, session state and relationships. Conflict, rejection and duplicate receipt remain distinct. No offline start/pause/end/session-context mutation is accepted as an unverified local fact.
- SSE carries filtered hints/events with durable cursor identity. A client treats disconnect, cursor gap, redaction or revocation as a reason to fetch an authorized snapshot. Current policy is applied during replay; hidden event counts and identifiers do not leak.
- Local cached copies cannot be remotely erased. Revocation blocks new reads, streams, links, image requests and replay; stale cached content is labeled accordingly and scoped to the member/campaign.
- Backup remains host-owned and versioned. v0.8 adds no new archive format or persisted workflow record. Existing v5 backup/restore includes durable session, encounter/context, event, operation, proposal, Lore, map and asset data. Local layouts, caches, pending queues, credentials and private drafts remain excluded. Export warns about private content; restore remains validated, atomic and empty-destination-only.

## 8. UX and recovery requirements

Every app and handoff exposes loading, empty, unavailable/unauthorized, offline/stale, conflict and host-error states with keyboard-focusable controls and a non-drag path for core actions. Narrow layouts keep primary navigation, current-session status and back/return actions reachable. Browser history/back returns to the prior local route without changing host context. Status text distinguishes “pending locally” from “accepted by host”.

## 9. Sequencing and acceptance

1. **#90 (this contract):** approve this requirements baseline, ADR-0018, target intent, matrix and flow diagrams; inventory existing adapters/routes and normalize public session labels.
2. **#92:** implement GM preparation/Table activation/return using existing session and encounter commands; add host/client contract tests for stale revision, idempotency and no navigation mutation.
3. **#94 and #91:** add authorized search/deep-link adapters and Campaign Home using the same projections; add privacy tests for list/search/link/SSE/replay.
4. **#93:** implement player live-session focus and read-only handoffs for two independently enrolled players.
5. **#95–#97:** streamline preparation, Maps interactions, accessibility and recovery states without changing authority.
6. **#98:** run the System A and System B disposable GM + Player A + Player B journey, restart/reconnect/offline/backup checks, keyboard/narrow viewport evidence and post-merge CI.

Minimum contract fixtures cover both registered fictional modules, GM plus two members, private/shared Lore and maps, planned/active/paused/ended sessions, independent browser selections, revocation, cursor gaps, stale offline commands, backup round-trip and an inaccessible deep link. Implementation issues MUST add the lowest-level host tests plus browser evidence required by the changed boundary.

## 10. Approval points

Before implementation, reviewers should approve: (a) Campaign Home as a composed view rather than a new dashboard authority; (b) no persisted navigation history or link-token table in v0.8; (c) search results as authorized projections with generic unavailable handling; and (d) normalization of `finished/finish` to the public `ended/endSession` vocabulary at the adapter boundary.
