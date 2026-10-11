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

The server is intentionally localhost-only and uses fixed development bearer tokens, not user authentication. Private fields and events are filtered before transmission. This slice has one campaign, no invitation flow, offline operation queue, approval proposals, WebSocket transport, or internet-facing deployment. The browser client uses the HTTP contract above and refreshes authorized snapshots after event notifications.
