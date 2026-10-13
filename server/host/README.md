# Foundation localhost host

Dependency-free Node host for the foundation demo. Requires Node 22.5+ (`node:sqlite`). Start from the repository root with `node server/host/index.mjs`. It binds only to `127.0.0.1`; set `PORT`, `POTOMAC_DB`, `POTOMAC_GM_TOKEN`, and `POTOMAC_PLAYER_TOKEN` to configure it. Development token defaults are `local-gm` and `local-player`.

At startup the host loads bundled manifests, JSON Schemas, declarative views, and structured rules from `modules/`. Actor records are checked against their module schema. The host evaluates bounded expression trees and typed resource effects; it never evaluates downloaded JavaScript. Roll results are generated on the host and stored with the action event.

## HTTP contract

All `/api/*` calls use `Authorization: Bearer <token>`. Use `local-gm` for GM and `local-player` for the player in a local-only demo. A GM registers a module with `POST /api/modules` and `{ "id", "version", "manifest" }`, then creates actors with `POST /api/actors` and `{ "id", "moduleId", "moduleVersion", "data", "visibility" }`. To hide fields from player projections, set `visibility.gmOnly` to dot-separated paths inside `data`.

- `GET /api/state?since=<cursor>` returns role-filtered actors, module manifests, campaign context, current cursor, and visible persisted events. Invalid cursors return `400 invalid_cursor`; a cursor ahead of the host or before retained history returns a full authorized snapshot, no partial replay, and `recovery.reason` (`cursor_ahead` or `cursor_expired`).
- `POST /api/actions` accepts `{ "operationId", "entityId", "baseRevision", "actionId", "parameters" }`. Accepted actions are atomic, revision checked, deduplicated by operation ID, and appended to the event log.
- `POST /api/context` accepts `{ "context": { "activeEncounter": "..." } }` (GM only) and emits a public context event.
- `GET /api/stream?since=<cursor>` is an SSE subscription; reconnect with the last cursor to replay missed authorized events. Clients should fetch `/api/state` after notifications to reconcile snapshots.

The browser's member-scoped offline cache stores the last authorized actor projection, event cursor, and session revision/status. Reconnect always fetches a fresh host snapshot before subscribing; cursor-gap notifications trigger the same snapshot reconciliation. Previously downloaded projections may remain as local copies after a grant changes, so disconnected UI labels them as cached and never treats them as current authorization. Queued operations retain their original operation ID and payload on transport retry; only a host receipt changes them from pending to a committed outcome.
- `GET /health` is unauthenticated and returns `{ "ok": true }`.

The server is intentionally localhost-only and uses fixed development bearer tokens, not user authentication. Private fields and events are filtered before transmission; player derived values are computed only from visible inputs, and public actor events are withheld if their actor is unavailable or unreadable. This slice has one campaign, no invitation flow, offline operation queue, approval proposals, WebSocket transport, or internet-facing deployment. The browser client uses the HTTP contract above and refreshes authorized snapshots after event notifications.

## Local campaign backup and restore

Use the CLI with the host stopped or while it is running; export uses SQLite's `VACUUM INTO` snapshot mechanism to capture a consistent view, including WAL-backed commits. Node 22.5+ is required.

```powershell
node server/host/backup-cli.mjs export .\data\potomac.sqlite .\backups\campaign.json
node server/host/backup-cli.mjs restore .\backups\campaign.json .\data\restored.sqlite
```

Export refuses to overwrite an existing backup file. Restore accepts a new destination or an existing SQLite database with no application tables; it refuses a non-empty destination and never merges into a live host. Use a distinct database path, verify the reported campaign ID, then point `POTOMAC_DB` at the restored file when ready to run it.

Exports use `potomac.campaign-backup` schema/data version 4. The archive contains campaign and Lore records, links, asset metadata and binary bytes, sessions, memberships, grants, audit/operation history, and canonical SHA-256 integrity data. Restore accepts the exact supported v2 collection layout, two recognized v3 layouts (the earlier Table/session release and the short-lived Lore/asset layout), and v4; it validates checksums, references, asset hashes and exact module availability before importing into an empty destination. No merge/overwrite is supported. Version 2 has no Table session history. A v3 session archive and a v3 Lore/asset archive represent different historical layouts; other unrecognized v3 shapes are rejected. See [the backup fixtures](backup.test.mjs) for the verified shapes.

The archive retains member records and credential hashes; plaintext bearer credentials are never stored or exported. Members can continue with existing credentials, or the GM can rotate one after restore. Backups contain private campaign content and credential hashes, so store them as sensitive files. Browser layouts, caches, queued operations, and private browser drafts are excluded. Managed attachment bytes are stored beside the database in the host-managed `<database path>.assets/` directory, under host-generated content keys; archive export embeds bytes and restore recreates them there. Copy the database and its asset directory together for filesystem-level backup. Version 2 receives safe defaults for absent later fields and cannot recreate session history that was never included. Version 1 remains unsupported.

## Workspace 0.4 host endpoints

The localhost 0.4 experiment adds GM-authorized `GET/PUT /api/campaign`, `GET/POST /api/encounters`, `GET/PUT /api/encounters/:id`, and `PUT /api/encounters/:id/participants`. Mutations use explicit revisions; the campaign's selected system module/version is immutable after initial pinning. GM-only `PUT /api/actors/:id` accepts `{ "operationId", "baseRevision", "changes" }`: a declarative, schema-checked field update, not an unrestricted replacement of host identity or role fields. The same operation ID may be retried safely and conflicting payloads or stale revisions are rejected. Only edit fields declared by the actor's module schema.

This host is still a localhost development example with fixed bearer-token GM fixtures. Remote deployment, dedicated user backup interfaces, and full module/schema migration tooling remain outside this slice. GM-private session details and events are filtered from player projections and replay.

## Generic session lifecycle contract

The host persists a campaign session projection and its full session history in SQLite. `GET /api/session` returns `{ revision, current, history }`; the same `session` projection is included in `/api/state` for reconnect snapshots. `POST /api/session/commands` accepts `{ operationId, command, sessionId, baseRevision }`, where command is `start`, `pause`, `resume`, or `finish`. These commands are GM-only, validate the current lifecycle and campaign revision, and atomically persist the transition, public audit event, and idempotent receipt. Reusing an operation ID with the same authenticated GM and payload returns the original response; a changed payload conflicts. Starting requires a caller-supplied stable, unused session ID. Finished sessions remain in history and a later session can be started.

This generic session contract does not select or activate an encounter. Encounter eligibility and the transaction that couples session start to encounter lifecycle need a single authoritative policy before they can safely be added.

## Table actions and session timeline

`POST /api/session/actions` accepts the `/api/actions` command fields plus `sessionId`. Enrolled players also send their authenticated member, campaign, module/schema versions, and dependency revisions; the host compares these with the credential and committed records. The host evaluates only the actor module's declared action against its current revision. A session action is accepted only while that session is active; paused, ended, stale-session, and stale-actor commands return a conflict and commit no state or event. Player actions that require GM review continue through the offline proposal flow and remain pending until the GM decides them.

Accepted session actions return a durable receipt with operation ID, actor/action and module/rules provenance, resulting revision, event cursor, and (when the action declares a resolution) the host-generated verified dice and resolution. An action without randomness is not marked as a verified roll. The actor update, timeline event, and receipt are committed in one SQLite transaction. Reusing the same operation ID and canonical command returns that receipt without rolling again; a different command under the same ID returns a conflict. A player's receipt and event projection retain the verified dice but omit submitted parameters and any resolution derived from GM-only actor fields.

`GET /api/session/:sessionId/timeline?after=<cursor>&limit=<count>` returns an authorized, ordered page of durable events. `after` defaults to `0`; `limit` defaults to `100` and is capped at `200`. The response includes `nextCursor`, `hasMore`, and the current `highWaterCursor`. Hidden or unreadable actor events and secret payload fields are filtered on the host before HTTP or SSE serialization; reconnecting clients should use the same cursor with this endpoint to continue paging.
