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
```

Direct commands work without installation:

```sh
node scripts/diagnostics/potomac-debug.mjs --help
node scripts/diagnostics/potomac-debug.mjs smoke
node scripts/diagnostics/potomac-debug.mjs doctor --role player
node scripts/diagnostics/potomac-debug.mjs watch --role player --since 0 --limit 5
```

## Campaign browser acceptance (current 0.4 slice)

`pnpm acceptance:campaign` runs the isolated browser scenario with one GM and two separately enrolled player identities. It creates a temporary SQLite database, starts a loopback host and isolated Vite/browser sessions, and removes temporary state when the run ends. The second player's snapshot and event replay are checked for member-scope isolation while the existing workspace scenario verifies grants, host-filtered fields, actions, context-following bricks, and browser layout persistence.

This is an incremental 0.4 harness, not the complete Ashen Road campaign journey: the host still supplies fixed fixture content and does not yet support the full create/edit/archive, encounter lifecycle, offline review, restart, System B browser scenario, or backup restore acceptance sequence. Run `pnpm acceptance:workspace` for the same current browser scenario under its 0.2 name. Both commands require Node dependencies and Chrome or Edge; set `POTOMAC_CHROME` to the browser executable when automatic discovery does not find it.

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
