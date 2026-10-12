# Foundation localhost host

Dependency-free Node host for the foundation demo. Requires Node 22.5+ (`node:sqlite`). Start from the repository root with `node server/host/index.mjs`. It binds only to `127.0.0.1`; set `PORT`, `POTOMAC_DB`, `POTOMAC_GM_TOKEN`, and `POTOMAC_PLAYER_TOKEN` to configure it. Development token defaults are `local-gm` and `local-player`.

At startup the host loads bundled manifests, JSON Schemas, declarative views, and structured rules from `modules/`. Actor records are checked against their module schema. The host evaluates bounded expression trees and typed resource effects; it never evaluates downloaded JavaScript. Roll results are generated on the host and stored with the action event.

## HTTP contract

All `/api/*` calls use `Authorization: Bearer <token>`. Use `local-gm` for GM and `local-player` for the player in a local-only demo. A GM registers a module with `POST /api/modules` and `{ "id", "version", "manifest" }`, then creates actors with `POST /api/actors` and `{ "id", "moduleId", "moduleVersion", "data", "visibility" }`. To hide fields from player projections, set `visibility.gmOnly` to dot-separated paths inside `data`.

- `GET /api/state?since=<cursor>` returns role-filtered actors, module manifests, campaign context, current cursor, and visible persisted events.
- `POST /api/actions` accepts `{ "operationId", "entityId", "baseRevision", "actionId", "parameters" }`. Accepted actions are atomic, revision checked, deduplicated by operation ID, and appended to the event log.
- `POST /api/context` accepts `{ "context": { "activeEncounter": "..." } }` (GM only) and emits a public context event.
- `GET /api/stream?since=<cursor>` is an SSE subscription; reconnect with the last cursor to replay missed authorized events. Clients should fetch `/api/state` after notifications to reconcile snapshots.
- `GET /health` is unauthenticated and returns `{ "ok": true }`.

The server is intentionally localhost-only and uses fixed development bearer tokens, not user authentication. Private fields and events are filtered before transmission; player derived values are computed only from visible inputs, and public actor events are withheld if their actor is unavailable or unreadable. This slice has one campaign, no invitation flow, offline operation queue, approval proposals, WebSocket transport, or internet-facing deployment. The browser client uses the HTTP contract above and refreshes authorized snapshots after event notifications.

## Local campaign backup and restore

Use the CLI with the host stopped or while it is running; export uses SQLite's `VACUUM INTO` snapshot mechanism to capture a consistent view, including WAL-backed commits. Node 22.5+ is required.

```powershell
node server/host/backup-cli.mjs export .\data\potomac.sqlite .\backups\campaign.json
node server/host/backup-cli.mjs restore .\backups\campaign.json .\data\restored.sqlite
```

Export refuses to overwrite an existing backup file. Restore accepts a new destination or an existing SQLite database with no application tables; it refuses a non-empty destination and never merges into a live host. Use a distinct database path, verify the reported campaign ID, then point `POTOMAC_DB` at the restored file when ready to run it.

The `potomac.campaign-backup` artifact has schema version 2, Potomac data version 2, campaign ID, pinned module IDs/versions, creation time, included collection names, exclusions, and a SHA-256 integrity digest over the canonicalized archive content. Restore checks the digest and archive shape, requires every actor's exact module version to be present in the local bundled modules, checks campaign/member/actor/proposal references, and commits all imported rows in one SQLite transaction. Unsupported formats, versions, malformed data, unavailable module versions, and corrupt artifacts fail before the destination is populated.

The archive retains member records and credential hashes so membership and grants continue working; plaintext bearer credentials are never stored in host persistence or exported. Members must use their existing credentials, or the GM can rotate a credential after restore and securely deliver the newly displayed credential. Backups contain private campaign content and credential hashes: store them as sensitive files. Browser layouts, caches, queued operations, and private browser drafts are intentionally excluded; they are not host-authoritative campaign state. Encounter definitions and participant rows are persistent host-owned records and are included in the version 2 backup alongside campaign name, exact pinned system module/version, revision and active context. Version 1 backup artifacts cannot be restored by the version 2-only importer; retain a compatible older host when upgrading existing archives.

## Workspace 0.4 host endpoints

The localhost 0.4 experiment adds GM-authorized `GET/PUT /api/campaign`, `GET/POST /api/encounters`, `GET/PUT /api/encounters/:id`, and `PUT /api/encounters/:id/participants`. Mutations use explicit revisions; the campaign's selected system module/version is immutable after initial pinning. GM-only `PUT /api/actors/:id` accepts `{ "operationId", "baseRevision", "changes" }`: a declarative, schema-checked field update, not an unrestricted replacement of host identity or role fields. The same operation ID may be retried safely and conflicting payloads or stale revisions are rejected. Only edit fields declared by the actor's module schema.

This host is still a localhost development example with fixed bearer-token GM fixtures. Remote deployment, fine-grained secret encounter visibility, dedicated user backup interfaces, and full module/schema migration tooling remain outside this slice.
