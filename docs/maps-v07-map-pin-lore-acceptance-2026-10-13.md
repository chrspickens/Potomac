# Issue #84 acceptance: authorized Map pin → Lore navigation

Date: 2026-10-13 (America/New_York)

Branch: `codex/maps-pin-lore-84`

Base: latest `main` at `f60ae4a`

Acceptance environment: disposable SQLite databases, disposable managed asset stores, isolated Chromium profiles, random loopback ports. No production campaign data was used.

## Results

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| GM creates Sunken Archive in Lore and links it to an Ashen Coast pin in Maps UI | PASS | `gm-sunken-archive-lore.png`; `gm-chromium-trace.json`; stage 3b/4 in browser output |
| Destination is a typed, stable Lore ID; GM can change and remove it | PASS | Host map projection assertions, GM Maps UI commands, restart/v5 checks; `server/host/maps.test.mjs` |
| Player A and Player B can navigate Map → Lore → originating Map | PASS | Separate Chromium contexts and independent enrollments; active encounter asserted unchanged before/after navigation for both |
| Private, unpublished, archived, missing, or revoked Lore target is not exposed | PASS | Host projection and direct-read tests; browser private/revoked cases; inaccessible destination fields omitted while the published pin remains |
| Target IDs, titles, labels, backlinks, counts, and GM metadata are protected in player responses/events | PASS | Raw `/api/maps`, `/api/lore`, `/api/state?since=0`, live SSE and replay assertions in `server/host/maps.test.mjs` and browser run; events use opaque `permissions.refresh` |
| Player DOM does not render private or revoked Lore destination details | PASS | Player A/B Chromium DOM assertions; `player-a-ashen-coast-published.png`, `player-b-ashen-coast-published.png`, `player-a-revoked-lore-cache-refreshed.png` |
| Offline authorized Lore/map/image navigation follows cache policy; reconnect refreshes revocation | PASS | Browser reload while host requests are blocked; previously authorized content works as stale offline read-only data; after revocation and authorized refresh, the offline Lore cache excludes the revoked article |
| Restart preserves maps, destination, links, pieces, encounters, permissions and images | PASS | Stage 7; direct host reads after graceful restart and exact original image-byte comparisons |
| Portable v5 backup/restore preserves destination and exact image bytes | PASS | Stage 8; separate empty restored database, `map_lore_links` round trip and byte-for-byte image comparison; legacy v5 without the new collection remains compatible |
| Both fictional systems retain Maps workflows | PASS | System A full journey; System B World/Battle Map creation, upload, grid, token and publication through its own Chromium browser |
| Keyboard, focus, numeric positioning, pointer drag and narrow layout | PASS (automated) | Stage 9; `gm-keyboard-and-pointer-token-edit.png`, `player-b-narrow-viewport.png` |

## Automated commands

- `pnpm acceptance:maps-browser` — PASS, stages 1–10 plus restored-Lore revocation stage 8b.
- `node --test server/host/maps.test.mjs server/host/backup.test.mjs` — PASS (18 tests).
- `pnpm --filter @potomac/web build` — PASS.
- `pnpm check` — PASS. Production build, 123 unit/integration tests, debug smoke, campaign, System B, offline, offline-storage, Table, Lore, Maps, and Maps browser acceptance all passed.

The browser test drives visible application controls in real Chromium contexts. It also makes raw HTTP/SSE assertions for security boundaries; those supplement, rather than replace, the browser journey. Per-run sanitized diagnostics are written to the system temporary directory and the script prints their path. Persistent Chromium traces and screenshots are in [`docs/evidence/maps-v07-browser/`](evidence/maps-v07-browser/).

## Defects corrected

- A visible map pin was dropped from player projections whenever its Lore target was not currently readable. The host now preserves the independently published pin and omits only the unauthorized destination. Regression coverage checks unpublished/private and revoked targets.
- An offline Lore deep link could be cleared while the authorized cached article list was still loading. The Lore view now retains the pending target until loading completes; the browser journey verifies stale offline navigation and post-revocation cache refresh.
- Lore state-updater callbacks invoked a parent update while React was processing another component. Parent projection updates now happen outside the state updater; the browser run captures console warnings and asserts none are emitted for this flow.

## Human-only follow-up

The automated narrow viewport is not a substitute for visual review on actual phone/tablet hardware. Review the saved screenshots for layout/contrast and perform a physical touch-device pass for pinch/drag hit targets, keyboard/screen-reader announcements, and browser-specific offline storage behavior. These are not claimed as human acceptance.
