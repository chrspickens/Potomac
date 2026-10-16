# Potomac v0.9 usability baseline

Date: 2026-10-15
Scope: issue #110 under #109
Evidence: automated Chromium and host acceptance only; no human participants were available.
The recorded automated run was executed from the pre-existing acceptance checkout at commit `a4bd781`; the report is being published separately from a clean `origin/main` worktree.

## Result

No reproducible S0–S3 defect was confirmed by the automated run. No child issue was created: filing a usability defect from automation alone would turn an unverified human observation into a finding.

The human System A GM + Player A + Player B walkthrough remains **PENDING**, as do physical-device/touch, real network interruption, and screen-reader checks. Chromium contexts are not human, physical-device, or accessibility validation.

## Verified automated coverage

- Fresh disposable System A host: campaign setup and pinned module, two character fixtures, enrollment and grants, encounter preparation/activation, Table roster, start/pause/resume, restart persistence, dashboard reload, backup/restore, role authorization and redaction.
- Lore: GM authoring, published/private projections, player A/B visibility, search/open/back, revocation and refresh.
- World/Battle Maps: creation, image/grid setup, tokens and private pins, publication, cross-map/Lore links, search, revocation, offline cache/reconnect, host restart, backup/restore, narrow layout, keyboard focus and pointer interaction.
- Fresh pinned System B: generic Table start, authorized player action, private-field absence from player DOM, HTTP, SSE and replay, then reconnect to authoritative session state.
- Existing checks: 129 tests passed; diagnostic smoke passed; `pnpm check` completed successfully.

## Severity-ranked findings

### No confirmed defects (S0–S3)

The automated evidence did not establish unauthorized player data, GM-only actions available to players, uncommitted state presented as committed, a required workflow blocker, or a reproducible usability defect.

## Human-only gaps and facilitator handoff

Run one paced session with a real GM, Player A and Player B using [the checklist](v09-playtest-checklist.md). Record exact wording, elapsed time, confusion/rescue, role, device and viewport for S01–S12. Specifically observe first-run discoverability, credential handoff, preparation-to-live transition, publication/revocation wording, return-to-session recovery, offline uncertainty, touch targets, physical network loss and screen-reader announcements. Capture only fictional content and sanitized screenshots/traces; never commit credentials, raw private campaign data, request bodies or full local paths.

The checklist’s “Finding / follow-up issue template” is the repository’s applicable findings template. The separately requested `docs/v09-playtest-findings-template.md` file is not present on `origin/main`, so this report does not duplicate it.

If a defect is observed, create one focused child issue linked to #109 and #110, classify S0–S3, include reproduction/expected/actual/evidence, map it to #111 (GM/session), #112 (player/navigation), or #113 (responsive/keyboard/status), and add a regression test before implementation.

## Repository/CI note

This working tree contains pre-existing modified evidence and untracked QA artifacts. The current branch is `codex/v08-release-acceptance-98`; after fetching, `origin/main` is `6f0e8e4` and is not an ancestor of this branch. No rebase, merge, PR, issue mutation, or automatic merge was performed. Re-run this report from a clean branch based on the current `main` before release sign-off, then verify the resulting GitHub Actions run.
