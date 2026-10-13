# Flooded Observatory acceptance run — 2026-10-13

Run status: PASS for the automated ten-stage Maps browser acceptance and integrated local `pnpm check`, continuing PR #82 from commit `8fa1938`. All test data, databases, assets and Chromium profiles were disposable. No production campaign data was modified; no issue was closed and no PR was merged.

## Command results

- `pnpm acceptance:maps-browser`: PASS. Ten stages completed using the real React UI and Chromium CDP. Main System A journey used isolated GM, Player A and Player B contexts with separately enrolled players. A separate System B host/Vite client/GM browser context exercised Maps UI under `example.system-b@0.1.0`.
- `pnpm check`: PASS (exit code 0) after integrating `acceptance:maps-browser`. Build, 119 Node tests, debug smoke, all existing acceptance scripts, and the ten-stage Maps browser command passed. The final integrated run's sanitized diagnostics are `potomac-maps-browser-diagnostics-63056.json` in the local temporary directory. One earlier integrated run found an IndexedDB v2-fixture startup race in `acceptance:offline-storage`; its browser runner now seeds the legacy database before React mounts, and the repeated full check passed.

## #79 journey matrix

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Three isolated GM/Player A/Player B contexts and separate player enrollment | PASS | UI enrollment + credential entry; distinct browser contexts; screenshots and per-client traces. |
| Ashen Coast World Map and Flooded Observatory Battle Map created through UI | PASS | Actual React form submissions; disabled World grid and square Battle grid persisted. |
| Image upload through UI and exact bytes | PASS | Both creation/upload controls used; exact uploaded bytes checked on host and after v5 restore (304/459 bytes). |
| Actor tokens, private pin, editing, sharing | PASS | Tokens/pin added using Maps UI; visibility edited; coordinate changed by keyboard and pointer drag. |
| Publication, revocation, HTTP/image/direct-ID privacy | PASS | Both maps published; Battle revoked; unauthorized player map and image endpoints returned 404. |
| SSE replay and rendered player privacy | PASS | `/api/stream?since=0` player replay chunk excludes GM note/private pin text and ID; DOMs omit private metadata. |
| Cross-map navigation and encounter invariance | PASS | Both players navigate World→Battle→Back through UI; active encounter unchanged. |
| Encounter associations and Workspace pinned/following behavior | PASS | Map relations assigned; UI Workspace pinned map remains Ashen Coast while following brick changes with active encounter. |
| Offline image caching, reload, reconnection and revocation | PASS | API-host Fetch isolation, real page reload, cached maps/images and cross-map navigation offline; stale cache retained until reconnect; live authorization refreshed afterward. |
| Host restart persistence | PASS | Graceful host shutdown/restart; map/grid/piece/link/encounter/visibility/image state verified. |
| v5 backup/restore | PASS | Restored into separate empty host; counts and exact asset bytes verified; restored host kept revoked access denied. |
| Both fictional systems | PASS | System A journey plus System B campaign pin, compatible fixture bootstrap, World/Battle UI, images, grid, token and publication. |
| Keyboard, focus, numeric coordinates, narrow viewport | PASS | Tab focus visible on next labeled Y control after numeric X commit; pointer drag; 390px viewport with no horizontal overflow. |

The detailed issue #69/#71/#72/#74–#79 matrix, fixes, security notes and human-QA boundary are in [`docs/maps-v07-validation-2026-10-13.md`](maps-v07-validation-2026-10-13.md). Browser evidence: [`docs/evidence/maps-v07-browser`](evidence/maps-v07-browser/), including sanitized GM/Player A/Player B/System B screenshots and Chromium traces. The final integrated run diagnostics are in the local temporary file `potomac-maps-browser-diagnostics-63056.json`.

## Fixes included

- Restrict campaign bootstrap fixtures to the exact pinned system id and version; add regression tests for both systems, incompatible versions and unpinned campaigns.
- Resolve Workspace Map Scene `pinned` selection from authorized map options rather than accidentally using the brick's default `follow` binding.
- Preserve Map Piece row identity across scene revisions so numeric edits do not erase keyboard focus.
- Permit browser image-upload preflight headers `x-operation-id` and `x-base-revision`, covered by the host preflight regression.
- Stabilize offline-storage IndexedDB migration fixture setup before React startup.
- Retain dynamic port allocation, common Chrome/Edge paths, signal-aware host cleanup/WAL retries, CDP diagnostics, redaction, screenshots and per-context traces.

## Human-only gaps

Automated browser screenshots/DOM checks do not equal human visual acceptance. Human review of visual hierarchy/image legibility and physical touchscreen/browser QA are still needed. CDP mouse drag passed but does not represent touchscreen hardware, device-specific gestures, or a real router/Wi-Fi outage. Local `pnpm check` passed; no CI run URL is claimed. CI checks must be reviewed on PR #82 after push.
