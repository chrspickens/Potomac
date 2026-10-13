# Agent and developer diagnostics

The foundation host already exposes a public health endpoint, an authorized state snapshot, and a role-filtered server-sent events (SSE) stream. The agent CLI uses those endpoints; it adds no privileged debug endpoint.

## Quick start (Node 22.5+)

```sh
pnpm dev:host                      # terminal 1: existing local host
pnpm debug:doctor                  # terminal 2: inspect as player
pnpm debug:doctor -- --role gm     # inspect as GM
pnpm debug:watch -- --role gm --since now
pnpm check                         # build, tests, isolated host smoke and two-client browser acceptance
pnpm debug:smoke                   # isolated host, separate temporary database
pnpm acceptance:campaign           # isolated browser acceptance with a GM and two enrolled players
pnpm acceptance:system-b-table     # fresh pinned System B host: Table start, action, redaction and reconnect
pnpm acceptance:lore               # focused Lore CRUD, publication and player privacy over host HTTP
```

Direct commands work without installation:

```sh
node scripts/diagnostics/potomac-debug.mjs --help
node scripts/diagnostics/potomac-debug.mjs smoke
node scripts/diagnostics/potomac-debug.mjs doctor --role player
node scripts/diagnostics/potomac-debug.mjs watch --role player --since 0 --limit 5
```

## Campaign browser acceptance (current 0.4 slice)

`pnpm acceptance:campaign` runs an isolated browser scenario with one GM and two separately enrolled player identities in distinct browser contexts. It creates a temporary SQLite database and starts a clean host without demo seeding, asserts that campaign data starts empty, then installs scenario fixtures through the host API using only the campaign-pinned module. Browser profile storage is initialized before the app loads. The runner checks member-scoped network projections and exercises the Table encounter roster plus committed session start/pause/resume refresh across all three live clients. If a connection stalls, it reports the first failed API request alongside browser state. The broader workspace scenario also verifies grants, host-filtered fields, actions, context-following bricks, and browser layout persistence.

`pnpm acceptance:system-b-table` starts a second, genuinely fresh host with demo seeding disabled, pins it to System B, and provisions a System B character/encounter through host APIs. A GM and player use isolated browser profiles against the same generic Table and Character UI. It starts a session from the Table control, submits a System B action during that session, checks the GM-only field against player DOM and actual HTTP/SSE response bytes, then takes the player browser offline and verifies reconnect refreshes the committed active session. It is a focused second-system browser scenario, not a repeat of the broad campaign-management walkthrough.

`pnpm acceptance:table` complements those browser runs with focused isolated host HTTP/SSE checks for session lifecycle, replay, idempotent operations, offline retries, redaction, and revocation. `pnpm check` runs all three browser/host acceptance commands, so CI covers the broad System A walkthrough, the System B Table scenario, and lower-level host recovery cases.

`pnpm acceptance:lore` uses an isolated database to check Lore creation, publication/revocation, GM/player projections, role authorization, and player event-replay privacy. It also checks that the Lore UI surface exists and reports current client/host contract mismatches (visibility fields, kind, and archive route) as known gaps. It does not claim the Lore editor flow passes end to end; a dedicated browser scenario remains a follow-up.

The System B browser scenario is intentionally limited to the generic Table session/action/redaction/reconnect path; it does not repeat the complete campaign-management workflow or manual visual QA. Run `pnpm acceptance:workspace` for the same System A browser scenario under its 0.2 name. Browser commands require Node dependencies and Chrome or Edge; set `POTOMAC_CHROME` to the browser executable when automatic discovery does not find it.

## Commands

- **smoke:** starts a fresh localhost host with random tokens, an ephemeral port, and a temporary SQLite database. Checks two system modules, schema-backed character creation, GM-only field redaction, context permissions, rules/actions, revision conflicts, idempotent retries, verified rolls, event history and SSE replay. Its test database is deleted when finished. It never alters real campaign data.
- **doctor:** calls /health and authorized /api/state, prints a summary (role, campaign, cursor, modules, actor count) without exposing character content.
- **watch:** follows authorized /api/stream?since=CURSOR updates and emits one JSON object per line. It reconnects with the last processed cursor. --since now (default) follows new events; --since 0 replays history; --limit N exits after N visible events.

These produce machine-readable newline-delimited JSON (NDJSON), with a nonzero exit code on errors. An example output *shape*, not a verified run result:

```json
{"type":"check","name":"two-different-game-modules","ok":true,"durationMs":3}
{"type":"summary","command":"smoke","status":"pass","checks":9,"temporaryDatabaseDeleted":true}
```

## Safe local-only operation

The CLI defaults to http://127.0.0.1:4177. --url or POTOMAC_HOST_URL may select another **loopback-only** HTTP address. The CLI refuses remote URLs to avoid sending development bearer tokens to the internet.

Authentication uses POTOMAC_GM_TOKEN and POTOMAC_PLAYER_TOKEN. If unset, it uses the prototype's local-gm and local-player test tokens. It never echoes tokens. **Do not expose the foundation host to public networks**; the token-based roles are only test fixtures, not real player identities.

GM-mode watch output may contain confidential GM events. Treat logs with the same privacy as campaign data. Player-mode streams are filtered by the host.

## Agent workflow

1. Run smoke before and after a change; check exit status and individual check records.
2. Use doctor to ensure the application is running and attached to the intended host.
3. Run watch with --since now while exercising the browser UI; observe context changes and accepted actions.
4. Capture JSON lines as agent tool output or CI logs, and use event cursors for replay/catch-up.

This is a foundation diagnostic tool, not a replacement for comprehensive unit tests, offline merge tests or production observability. The current host uses SSE, not Socket.IO.
