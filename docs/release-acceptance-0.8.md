# Potomac v0.8 release acceptance

This document is the executable acceptance map for issue #98. It composes the existing disposable acceptance suites; it does not introduce a second browser runner or a second authority model.

## Disposable browser topology

The workspace acceptance creates one isolated loopback host and three independent Chromium contexts: GM, Player A and Player B. Each player is enrolled with a distinct member credential and receives only the grants used by that context. The Maps browser acceptance repeats the same three-context topology for map, Lore, revocation, cache and backup coverage.

## Release-gate mapping

| Gate | Existing evidence |
| --- | --- |
| System A Campaign Home → preparation → Table → return | `pnpm acceptance:campaign` / `scripts/workspace-acceptance.mjs` |
| Character and encounter creation, participant persistence and stale revisions | campaign acceptance plus host encounter tests |
| Lore and World/Battle Maps, publication, links and assets | `pnpm acceptance:lore`, `pnpm acceptance:maps`, `pnpm acceptance:maps-browser` |
| Start, pause, resume and player read-only session behavior | campaign, System B Table and Table acceptance |
| Player A/B grant isolation, HTTP/SSE/replay/search/DOM privacy | campaign and Maps browser acceptance |
| Offline cache, reconnect, revocation and stale recovery | `pnpm acceptance:offline`, `pnpm acceptance:offline-storage`, Maps browser stages 6 and 8b |
| Host restart, idempotency, revision safety and session context | host tests, campaign/Table acceptance and Maps browser stage 7 |
| v5 backup/restore and managed map assets | campaign, backup tests and Maps browser stage 8 |
| Fresh System B pinned-module journey | `pnpm acceptance:system-b-table`, Maps browser stage 10 |
| Keyboard focus and 390px viewport | workspace acceptance Home/Table checks and Maps browser stage 9 |

The repository `pnpm check` command runs the complete sequence: build, unit/host/security tests, smoke checks, campaign, System B, offline, storage, Table, Lore, Maps and Maps browser acceptance. No additional duplicate suite is required for #98.

## Security and privacy boundary

Acceptance evidence must use disposable loopback hosts and generated credentials. Browser navigation, dashboard bindings, cached records, search results and SSE cursors are never treated as permissions. The host remains authoritative for grants, projections, revisions, session transitions, replay filtering, offline reconciliation and backup validation. Cached data can remain on a device after revocation; tests verify that revocation blocks new reads and refreshes while documenting that physical erasure is not promised.

## Evidence and limitations

The Maps browser runner records sanitized diagnostics and screenshots under `docs/evidence/maps-v07-browser/`. Evidence may include generated local artifacts and must not contain bearer credentials, private databases or unsanitized payloads.

Automation does not establish physical-device behavior, touch ergonomics, zoom/reflow quality, human screen-reader announcements, or assistive-technology navigation. Those remain outstanding under #67, #68 and #88. The release signoff must not mark those human checks complete based on Chromium automation.

## Signoff rule

Issue #98 is automation-complete only when the full `pnpm check` and the PR GitHub Actions run are green and this matrix has no unverified automated gate. It is not final release signoff until the independent QA issues and any explicit human/device checks are resolved or consciously accepted by the release owner. Issue #89 remains open until that explicit signoff.
