# Potomac v0.7 Maps validation — 2026-10-13

Baseline: `d5ee626` (`main`, current `origin/main`). Validation used the original acceptance criteria and completion-review notes in GitHub issues #69, #71, #72, and #74–#79. No GitHub issue was modified or closed, and no production campaign data was changed.

## Evidence

- `pnpm check`: PASS. Build succeeded; 117 Node tests passed; debug smoke, campaign, System B/Table, offline, offline-storage, Table, Lore, and Maps acceptance all passed.
- `pnpm acceptance:maps`: PASS against a disposable SQLite host. Covered World/Battle creation, publication/revocation, private/public projections, map pieces and destination links, idempotent/conflicting operation IDs, stale revision conflict, player HTTP/state projections, v5 export/restore, and tamper rejection.
- `pnpm acceptance:campaign`: PASS against disposable host/data and three browser contexts. Covered the existing three-context GM/player browser harness, restart persistence, workspace bindings and role-filtered DOM/API behavior.
- `pnpm acceptance:offline`: PASS; browser UI queued/reconciled stale work, restart, conflict, rebase, rejection and private drafts.
- `pnpm acceptance:offline-storage`: PASS; process restart, cache recovery, scope isolation, cancellation and corruption handling.
- Visible Chromium smoke: three isolated tabs were opened. GM Maps exposed the World/Battle creation selector, bounded dimensions, grid selector, optional background-image control and Create-on-host. Both player tabs, after switching to Player role, showed no Create scene/editor control and no authorized maps. This was read-only against an already-running `test2`/`foundation-demo` host; no fixture was mutated.

Automated browser evidence is not human visual acceptance. The visible smoke checked DOM/accessibility text and the rendered screen structure, but did not establish a full human visual sign-off for image quality, touch interaction, or every journey.

## Matrix

| Issue | Result | Supporting evidence / remaining gap |
|---|---|---|
| #69 tracker | NOT VERIFIED | Automated checks and Maps acceptance are green, but the full Flooded Observatory journey with disposable GM + two enrolled players, both systems, raw SSE/cache checks, and human visual sign-off was not completed end-to-end in one visible run. |
| #71 persistence/commands | PASS | `pnpm check` host tests and `acceptance:maps` cover SQLite scenes/pieces/links, revisions, bounded coordinates, idempotent retries, conflicts, projections and restore. |
| #72 privacy | PASS | Host security tests plus Maps acceptance cover unpublished/revoked scene hiding, GM notes, player HTTP/state/replay projections, uniform direct-ID denial and publication/revocation. Full byte-level image/link/SSE replay coverage is automated in repository tests; no separate manual packet capture was taken. |
| #74 Maps app | PASS | Visible GM Chromium smoke confirmed one Maps app with World/Battle selector, All/World/Battle filter, dimensions, grid and background controls. Automated campaign/maps acceptance covers real browser interactions and host-backed mutations. Human visual/touch acceptance remains NOT VERIFIED. |
| #75 pieces | PASS | `acceptance:maps` covers persistent pins, destination links, projection filtering and safe revocation; host/client maps tests cover geometry and piece semantics. Full manual drag/keyboard piece placement was not independently recorded. |
| #76 links/integration | PASS | `acceptance:maps` covers map-to-map links and reversible authorized projections; workspace tests cover following vs pinned resolution. Full visible encounter/Lore handoff journey was not separately captured. |
| #77 workspace bricks | PASS | Workspace acceptance and registry/contribution tests pass; map brick test proves following active encounter vs pinned stability. Player DOM contains no map editor when role is Player. |
| #78 offline maps/images | PASS | Offline storage tests and acceptance pass scope isolation, bounded cache, stale recovery, reconnect/revocation semantics and cache corruption handling. Maps-specific image-offline UI was not manually inspected in a visible browser. |
| #79 release verification | NOT VERIFIED | `pnpm check` and all available acceptance scripts passed, including System B and backup/restore. The requested single comprehensive three-context Maps journey, host restart during Maps use, image upload in the visible UI, accessibility/touch human smoke, and CI run link were not all captured as one artifact. |

## Security and portability notes

The automated evidence verifies authorization at host response/projection and replay boundaries. Browser cache copies are intentionally not treated as erasable by revocation. The v5 backup tests preserve map records, links, pieces and managed image bytes, reject tampering, and retain legacy campaign/Lore/Table data. The application remains localhost/development-only and static bearer fixtures are not production authentication.

## Follow-ups

1. Run the full Flooded Observatory scenario in a fresh disposable host with three explicitly enrolled browser contexts, including image upload and visible cross-map/Lore/encounter handoffs.
2. Capture sanitized screenshots/traces and a CI run URL, then obtain human visual/touch/accessibility acceptance.
3. Keep historical #67 and post-0.6 human QA #68 as independent gaps, as required by #69.
