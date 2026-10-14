# Potomac v0.7 Maps validation — 2026-10-13

Validation continued on PR #82 from commit `8fa1938`, against the Maps v0.7 acceptance criteria and completion-review notes for GitHub issues #69, #71, #72, and #74–#79. All browser hosts, SQLite databases, assets, and Chromium profiles were disposable. No production campaign data was read or modified; no issues were closed and no PR was merged.

## Results

- `pnpm acceptance:maps-browser`: PASS. Ten acceptance stages completed in actual Chromium UI sessions. System A used three isolated Chromium contexts (GM, Player A, Player B), with two independent player enrollments. System B used a separate disposable host, client, and GM browser context.
- `pnpm check`: PASS (exit code 0) on the integrated command after adding `acceptance:maps-browser`. It built the packages/client, passed all 119 Node tests, debug smoke (9 checks), campaign, System B/Table, offline, offline-storage, Table, Lore, Maps HTTP/v5, and Maps browser acceptance suites. The Maps browser command passed all ten stages at the end of the check. Final sanitized runner diagnostics: `%TEMP%/potomac-maps-browser-diagnostics-63056.json` (local temporary file; not a repository artifact).
- The first integrated `pnpm check` attempt exposed a race in `acceptance:offline-storage`: its legacy IndexedDB v2 fixture raced React startup opening the current v4 database. The runner now blocks only `/src/main.tsx` while seeding the old database, before React mounts; the standalone test and subsequent complete integrated check passed. This was a test-harness timing defect, not a product storage defect.
- `pnpm acceptance:maps`: PASS. Retains its HTTP/projection/idempotency/revision-conflict/v5 tamper checks.

## Flooded Observatory browser evidence

The final integrated browser run `potomac-maps-browser-diagnostics-63056.json` records all ten passing stages with timestamps, sanitized request/status data, host restarts, and browser events. The run launched the real host and Vite React client on dynamically allocated ports, and Chrome/Edge is selected from `POTOMAC_CHROME` or common Windows/Linux/macOS locations. Chromium traces and sanitized screenshots are under [`docs/evidence/maps-v07-browser`](evidence/maps-v07-browser/).

| Stage | Result | Evidence |
|---|---|---|
| 1. Connected GM creates Ashen Coast in React UI | PASS | `stage-1-ashen-coast.png`; GM trace includes the host-accepted map create and readback; 15-second Table connection sample and Maps connection checks. |
| 2. Independent Player A and Player B enrollment | PASS | Both enrolled separately in GM UI and authenticated via credential-entry UI in isolated browser contexts; `player-a-initial.png`, `player-b-initial.png`. Credentials are not stored in trace files. |
| 3. World/Battle Maps, images, grids | PASS | UI created Ashen Coast (grid off) and Flooded Observatory (square grid); both PNGs uploaded through file controls. Host image bytes matched the uploaded fixture bytes exactly (304 and 459 bytes). `gm-flooded-observatory-created.png`. |
| 4. Tokens, private pin, encounters, link, publication/privacy | PASS | Two actor tokens and GM-only pin added through Maps UI; World pin and World→Battle link saved through UI; map/encounter relationships and active encounter set; maps published. Player UI and HTTP map/image authorization checked before and after publication. Private note/pin fields and IDs absent from player snapshots and a real `/api/stream?since=0` replay chunk. Both player contexts navigated World→Battle→Back without changing the active encounter. Screenshots: GM and both players' published-map views. |
| 5. Workspace | PASS | Two `Map Scene` bricks created through Dashboard UI. One pinned to Ashen Coast; one followed the active encounter from Flooded Observatory to Ashen Coast and back. `gm-workspace-pinned-following-maps.png`. |
| 6. Offline cache, reconnection, revocation | PASS | Player A's disposable API-host requests were failed with CDP Fetch while the UI app shell remained available; the app was reloaded and previously authorized map and image blobs rendered/navigated offline. Player B live list plus HTTP map/image requests denied revoked Battle Map. Player A retained the already-downloaded offline image until reconnect; the app refreshed authorization and removed the map, then direct map/image requests returned 404. This validates app host disconnection/cache behavior, not a physical router/Wi-Fi outage. |
| 7. Host restart | PASS | Graceful SIGTERM, process exit wait, and restart on the same dynamic port. World publication, Battle revocation, grids, pieces, private pin, links, encounter associations, grants, and exact image bytes persisted. |
| 8. v5 backup/restore | PASS | Exported v5 after host shutdown and restored to a separate empty database/asset directory. Counts: 2 scenes, 4 pieces, 1 link, 2 encounter associations, 2 map assets. Both restored image byte arrays exactly matched the uploaded images (304 and 459 bytes). Restored host served the restored maps and kept revoked player authorization denied. |
| 9. Keyboard, focus, numeric positioning, pointer, narrow screen | PASS | CDP keyboard input and Tab saved token X=5.5 and retained visible focus on the next labeled Y control. Pointer drag committed a new position (X≈10.981). At 390×844, Maps occupied a 366px content column with 390px document width and no horizontal overflow. See `gm-keyboard-and-pointer-token-edit.png` and `player-b-narrow-viewport.png`. |
| 10. System B Maps | PASS | Separate browser UI pinned `example.system-b@0.1.0`, confirmed only the System B fixture was bootstrapped, created Sable Reach and Starboard Deck, uploaded exact-byte images, verified no-grid World/square Battle, placed the System B actor token, and published the Battle Map. `system-b-starboard-deck-ui.png`. |

## Issue matrix

| Issue | Result | Supporting evidence / remaining gap |
|---|---|---|
| #69 tracker | PASS (automated acceptance) | Full Flooded Observatory journey now runs against disposable data; three isolated System A contexts, separate System B browser run, privacy, offline, restart, backup, accessibility automation, and full local check all pass. Physical-device and human visual QA are not implied. |
| #71 persistence/commands | PASS | Host tests, `acceptance:maps`, browser piece/map mutations, stale-revision behavior, restart persistence, and v5 restored records. |
| #72 privacy | PASS (automated) | Player UI/DOM, HTTP map and image responses, direct IDs, private map metadata/pin identifiers, state snapshot, and real SSE replay asserted. Cached offline copies intentionally remain available until reconnection; live authorization refresh then removes the revoked map. |
| #74 Maps application | PASS (automated browser) | Real React create/edit/upload, map kind/grid controls, publication/revocation, host restart and System B UI. Human visual signoff remains outstanding. |
| #75 pieces | PASS (automated browser) | UI pins/tokens, private/shared visibility, UI coordinate edit with focus retention, pointer drag, and player projection. |
| #76 links/integration | PASS (automated browser) | UI World→Battle link, both-direction navigation, encounter invariant and associations; Workspace handoff behavior also checked. |
| #77 Workspace bricks | PASS (automated browser) | UI-created pinned/following Map Scene bricks switch as expected when the active encounter changes. |
| #78 offline maps/images | PASS (automated browser) | Cached offline reload, cached image rendering/navigation, retained offline copy after revocation, reconnect refresh and denial of future live access. Device-level network interruption is not simulated. |
| #79 release verification | PASS (automated acceptance) | All ten browser stages plus integrated `pnpm check` pass. CI status/link is not available from this local run; PR CI must be reviewed separately. Human visual/touch signoff remains NOT VERIFIED. |

## Product fixes and test-harness changes

- Campaign bootstrap now creates only fixtures matching the pinned game-system id and version; regression coverage includes System A, System B, incompatible version, and unpinned campaign cases.
- Workspace binding selection now resolves explicit `pinned` mode to an authorized map option instead of accidentally falling back to its default `follow` binding. A focused unit regression and browser acceptance cover it.
- Map piece rows now keep stable React identity across scene revisions so keyboard focus survives a committed numeric position edit.
- Host CORS permits the revision/operation headers required for real browser map image uploads, with preflight regression coverage.
- The harness captures CDP Network/Runtime/Page diagnostics before cleanup, omits authorization headers and credentials, writes three-context traces/screenshots, allocates ports dynamically, supports common Chrome/Edge paths, and waits for child signal exit before bounded SQLite WAL cleanup.

## Human-only acceptance still required

- A human should inspect the saved screenshots at normal scale for visual hierarchy, image legibility, and whether the GM/player distinction is clear. Automated screenshot capture and DOM assertions are not visual acceptance.
- Physical touch hardware/browser QA remains outstanding. CDP mouse pointer drag passed; it does not prove touchscreen behavior, device-specific gestures, or real network loss.
- At the time this validation run was first recorded, no CI result URL was claimed; local `pnpm check` is not a CI result. Subsequent PR #83/#86 PR and post-merge CI, plus the fresh closeout rerun, are recorded in [Maps manual QA](maps-manual-qa.md).

Evidence files are local artifacts committed with the PR; disposable databases and browser profiles were removed. No credentials are included in the browser traces.
