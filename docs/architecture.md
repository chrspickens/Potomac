# Architecture proposal (v0.1)

The next milestone's campaign boundaries, command semantics, migration and backup requirements are specified in [Workspace 0.4 requirements](workspace-0.4-requirements.md) and tracked by [issue #26](https://github.com/chrspickens/Potomac/issues/26). This proposal remains a description of direction, not a claim that those capabilities are implemented.

## Current experiment versus target

This document describes a proposed destination, not the deployed transport or storage stack. The 0.3 experiment uses a React/Vite browser client, a loopback-only Node HTTP host, SQLite on the host, server-sent events (SSE) with snapshot reconciliation, browser `localStorage` for personal layouts and an explicitly remembered player credential, and member-scoped IndexedDB for filtered snapshots, queued operations, and private drafts. It does not yet have an Electron wrapper, WebSocket transport, production identity, encrypted browser storage, or remote-host security. Consult the executable host and client plus the checks for current behavior.

## Topology

```text
GM desktop (React client + embedded Node host + SQLite)
           | HTTPS (remote) / HTTP (trusted local dev only)
           | WebSocket
Player browser/desktop (same React client + local cache + queue)
```

A dedicated host may later run the **same** Node server headlessly. Potomac does not require an operated cloud. Remote access (NAT, routing, TLS, invitations) is deliberately outside the initial localhost/LAN experiment.

## Proposed stack, subject to spike

| Layer | Candidate |
| --- | --- |
| Source and shared contracts | TypeScript, pnpm monorepo |
| UI | React + Vite |
| Packaging | Electron later, not required for experiment |
| Host API | Node.js + Fastify |
| Live events | Socket.IO |
| Host persistence | SQLite + Drizzle |
| Browser client persistence | IndexedDB + Dexie |
| Schemas and runtime validation | JSON Schema + Ajv; Zod for internal API DTOs where useful |
| Tests | Vitest; integration tests with two client sessions |
| Collaborative text | Yjs/Automerge evaluation later; not used for authoritative resources initially |

## Conceptual modules

```text
Workspace shell / Dashboard engine
     |              |
 Full apps       Embedded bricks
     \              /
       Typed query/command and context APIs
                  |
 Client cache + pending operations / sync adapter
                  |
 Host API + realtime gateway
                  |
 Authz / approval policies / rules engine
                  |
 Transactions, current projections, event history, assets
```

The frontend never writes host SQLite directly. Modules register capabilities. The host enforces permissions on **reads, actions, subscriptions and event payloads**.

## Shared data model (candidate)

- `Workspace`, `Setting`, `Campaign`, `Session`, `Member` / `Role`
- `Entity`: stable ID, kind, system module ID/version, schema version, reference links, visibility policy
- `EntityRevision`: versioned authoritative data
- `EncounterDefinition` vs `EncounterInstance`: reusable preparation vs mutable live state
- `DashboardTemplate`, `DashboardInstance`, `BrickBinding`, `DashboardGroup`
- `Context`: scoped references (host session, player, group, dashboard), not independent access rights
- `Operation`: globally unique ID, actor, base revision, command, typed payload, outcome
- `Proposal`: reviewed change set, author, basis, status, review metadata
- `ActivityEvent`: ordered authoritative record with visibility metadata and versioned rules source

Keep stable identity separate from reusable definitions, encounter instances and personal drafts.

## Authoritative command lifecycle

1. Client calls a typed command with unique operation ID and base revision.
2. Host authenticates actor and authorizes action against current policy.
3. Host validates current entity references and module/schema compatibility.
4. Rules engine evaluates pure rule logic and returns **proposed effects**; randomness is provided by host and recorded.
5. Approval policy decides auto-accept vs GM proposal.
6. Atomic host transaction commits accepted state and event(s), with operation-ID deduplication.
7. Host broadcasts visibility-filtered notifications. Clients fetch/reconcile authorized updated snapshots.
8. Clients acknowledge server revision/cursor. Disconnects trigger replay/snapshot catch-up.

Never trust the client for HP totals, grant permissions via binding IDs, or use UI hiding for secrecy.

## Offline lifecycle

- Client caches explicitly permitted records and keeps a **separate durable queue** of proposed operations or private drafts.
- Offline changes are locally labeled pending, not authoritative.
- On reconnect, client identifies host campaign, module/schema versions and last acknowledged revision/cursor.
- Host revalidates permissions, state, dependencies and rules at submission time; stale or illegal actions conflict, not last-write-wins.
- Compatible permitted edits commit; proposed advancement enters review queue; rejected edits remain available as local drafts.
- Revoked access prevents new reads/sync but cannot retract copies already possessed.

In the current localhost experiment, the GM enrolls members and distributes one-time displayed bearer credentials. The host stores credential hashes and supports rotation/revocation. A player may choose to remember the credential in the browser profile to reopen cached data after restart; this is convenience, not encryption or protection from other users of that profile. The host validates every submitted operation and persists the resulting receipt; client queue status is never a substitute for that receipt. Significant fixture actions become GM proposals, and rejected or conflicted intent may be kept as a private draft. The browser acceptance runner exercises the GM and two enrolled members against a restartable host, but it is not a production deployment test.

## Versioning and migration

Pin a campaign to a compatible system module version. Persist schema/rule versions on entities/events/operations. Back up data before applying explicit module migrations; reject incompatible offline operations with remediation guidance. Event history is auditable, not proof against a machine administrator.

## Development and deployment boundaries

Use a modular monolith first. A web client and host run separately in development. Desktop wrapper starts an isolated host process; the host must never depend on Electron APIs. Avoid Redis, orchestration, account cloud, peer-to-peer authority, and a public plugin marketplace in the experiment.

## Current V2 campaign setup boundary

The normal Campaign Home setup flow can list the host's bundled trusted V2 catalog on loopback, show its reviewed module versions and digests, and create a fresh campaign by asking the host to pin the selected exact lock. The browser does not assemble module provenance or capability closure. Once pinned, a Rules navigation item opens the generic declarative V2 workspace; GM enrollment, player credentials, entity schemas, grants, commands, reactions, and authorized projections continue through the existing host contracts. Players use the same normal app navigation after authenticating with their enrolled credential. The V2 route is explicitly experimental and remains default-off.

This is an onboarding integration, not general V2 multi-campaign support. The current local host still supports one configured campaign. The UI therefore permits V2 creation only on a fresh host and refuses to replace V1 data or an existing V1/V2 ruleset. Supporting multiple normal campaigns requires a durable campaign registry and selection/routing, campaign-scoped membership and authority, isolation of every query/event/asset/backup path, and explicit lifecycle/restore semantics. Until that host work is implemented, separate host data directories remain the supported boundary. Offline V2 command queues, remote exposure, and module upgrades are unsupported.

## V2 task applications

For a pinned V2 campaign, Characters, Encounters, and Table are task views over the existing trusted module workspace, selected through ordinary application navigation. The app does not define game-specific schemas or preparation rules: trusted module descriptors and preparation profiles determine which module-created records belong in Characters or Encounters. Encounter preparation, player grants, and recovery remain in Encounters; authorized live actions, reactions, participant positions, and the host-owned session lifecycle appear in Table. Characters shows separately declared character entities when available. If the module embeds owned character records in encounter entities, Characters renders those records using the trusted schema and host-provided ownership paths; GMs can reach preparation in Encounters.

Each task view re-reads the current lock, authenticated session, trusted catalog, authorized entity list, and entity projection from the local host. Selection and handoff preserve stable entity IDs; views do not copy rules state or treat dashboard bindings as permission. Entity type, schema version, and capability references must match the exact trusted module descriptor and lock entry. The same bounded declarative contributions render module forms; only host-validated commands update state. Spatial rendering is structural: a declared grid plus participant-array position fields produce a grid view, while non-grid schemas get an authorized participant roster. All fields are permission-filtered by the host.

V2 current-session state remains a small host-owned lifecycle record scoped to the one configured campaign. It references the selected encounter or scene by stable ID; it does not copy or replace module state. GM-authorized Start and Finish commands verify exact lock and entity/session revisions, preserve operation receipts, and reject unresolved reaction continuations. V1 routes and their ruleset behavior remain separate. This route inherits the experimental default-off, loopback-only V2 host boundary and single-configured-campaign limitation. Browser automation verifies navigation and role boundaries; human playtesting remains outstanding under #110.

## Open engineering risks

- Browser offline reopening and secure origins for remote/localhost use.
- Local data encryption and safe export/backups.
- Resource conflict semantics versus CRDT suitability for collaborative prose.
- Rules execution budget, recursion/trigger protection and secure downloadable modules.
- Cross-version compatibility and replay of data migrations.
