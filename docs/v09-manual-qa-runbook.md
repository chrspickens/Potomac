# Potomac v0.9 manual QA facilitator runbook

**Human execution only where identified. All unperformed rows start PENDING.** This runbook is the facilitator’s setup, safety, observation, and follow-up guide. Use the existing [S01–S12 playtest checklist](v09-playtest-checklist.md) as the actual System A task script; do not copy its task rows into this document. Use the [finding template](v09-playtest-findings-template.md) for each distinct reproducible problem. Keep automated and human evidence separate.

Related tracking: [#110](https://github.com/chrspickens/Potomac/issues/110), [#114](https://github.com/chrspickens/Potomac/issues/114), and independent QA [#67](https://github.com/chrspickens/Potomac/issues/67), [#68](https://github.com/chrspickens/Potomac/issues/68), [#88](https://github.com/chrspickens/Potomac/issues/88). This package does not complete or replace any of them.

## Before scheduling

1. Choose a facilitator and three actual participants: GM, Player A, Player B. A role-playing agent, scripted browser context, or one person impersonating all three is not human-playtest evidence. Have each participant use an independently authenticated browser profile. The current host binds loopback-only, so those profiles must run on the host machine; separate devices cannot connect to this build. Participants may take turns at the host machine, but record the shared-device limitation and do not call it remote/network validation.
2. Start from a disposable database as described in the checklist. Confirm its path is new and dedicated to this run; never point `POTOMAC_DB` at a real or existing campaign. Keep the host loopback-only. The host rejects non-loopback binds; do not disable that guard or expose development bearer tokens to a LAN or the internet.
3. Record commit, OS, device/model, browser/full version, viewport, zoom, input method, and network setup before testing. Confirm System A `example.system-a@0.1.0` (Emberbound) on the campaign. Do not change a module pin or module contract during the session.
4. Use fictional names/content and credentials created for this run. The GM enrolls Player A and B separately through the UI and privately delivers each credential to its participant. Do not copy credentials into shared notes, screenshots, chat, shell history, reports, or issue comments. If identity/profile mix-up occurs, stop and record it without exposing the credential.
5. Agree on a stop rule: any apparent disclosure of another player’s private data, GM-only content, credential, or control stops that task. Record only the role, step, visible category, and sanitized evidence; do not reproduce the secret in the report.

## System A session: coastal investigation

Use a fresh campaign named **Graywater Signal**. The GM creates two distinct characters and assigns one to each player (Player A receives Character A; Player B receives Character B). Prepare **The Flooded Beacon** encounter, a shared Lore handout **Signal at Low Tide**, a GM-only note **Keeper’s true account**, a shared World Map **Graywater Coast**, and a Battle Map **Beacon Interior**. Keep the private note and one GM-only map pin private. Both players should receive the shared Lore/maps and only their own character grant. Never place real personal or confidential information in this scenario.

Follow S01–S12 in order, adapting only fictional names/content to the scenario above. Let each person discover controls without coaching. Ask participants to narrate what they expect before consequential actions; do not explain a label until they have attempted the task. If blocked or assistance is needed, record the exact step and assistance before helping. Cover the following planned interruptions within the corresponding checklist tasks:

- During preparation, ask the GM to change the encounter’s player-facing summary, save, navigate away, and verify the committed version before activation.
- During the session, have each player independently locate the active encounter/session, find their character and shared handout/map, perform one permitted System A action, and return to Table after navigating elsewhere.
- Have both players open the shared handout/map before the GM revokes access. Each player separately refreshes, searches, and tries to reopen it. Ask what they believe revocation does to copies already downloaded; do not promise local erasure.
- Have the GM pause, resume, and finish using the visible session controls. Ask both players what each status means and whether they can identify a way back to preparation. Record any duplicate start controls, `prepared`/`active` interpretations, blank resource defaults, scrolling, retries, and help as observations—not defects unless reproducible behavior violates an expectation or contract.
- Finish with the participant-by-participant S12 debrief. Attribute quotations only with consent.

The exact expected outcome for each checklist row remains in S01–S12. Do not mark a task PASS merely because the facilitator knows how to do it.

## Representative System B human smoke

Run separately on a fresh disposable host/database after System A, not in the System A campaign. A GM and one real player should:

1. Create a campaign pinned to **`example.system-b@0.1.0` (Hollow Stars)**, create one character and one prepared encounter through normal UI, enroll the player, and grant that character.
2. Have the player independently join, locate their authorized character and active Table, submit one permitted System B check with the required input, and use one permitted no-input resource action if available in the displayed module UI. Record validation, accepted/rejected feedback, and visible committed state.
3. Keep one GM-only field/note and one unshared item; verify they are absent from player UI/search. Share then revoke one item and verify the player’s refreshed host view. Record cached-copy expectations separately.
4. Pause/finish and return to preparation. Verify both roles understand the state. Record any reconnect only if a real supported interruption was possible; otherwise leave it pending.

Do not edit the pinned module, substitute System A rules, provision player state through API/database/fixtures, or call this smoke a full System B walkthrough. Record the exact module version shown.

## Focused manual follow-ups

| Follow-up | Human action and evidence | Gate/status |
|---|---|---|
| Enrollment, first-use, character/action | In the System A run, Player A/B independently authenticate using separate UI-issued credentials, identify their own granted character, find shared content, perform a permitted action, and explain feedback. Record wrong-profile incidents, retries, time, and help. | Ready for GM + two players in local browser profiles. Human result **PENDING**. |
| Lore/maps, grants and revocation | Both players read shared article/map before revocation; test refreshed app, search, navigation, map pins, Lore links/backlinks, and each member’s distinct character grant. Verify private titles/fields remain absent. For #68, additionally test Notes-brick visibility, links/backlinks after rename, upload/preview/remove of a permitted image, a denied image path, and each player’s own cached copy. | Ready in same session for online content and grants. The additional #68 checks count only when individually performed and recorded. Offline cache/reconnect is blocked as described below. **PENDING**. |
| Current backup v5 CLI round-trip | From the repository root, use a disposable campaign database and unused output paths: `node server/host/backup-cli.mjs export <disposable-campaign.sqlite> <current-v5-backup.json>`, then `node server/host/backup-cli.mjs restore <current-v5-backup.json> <fresh-empty-destination.sqlite>`. The CLI prints a JSON success result; inspect the archive’s `schemaVersion` and confirm it is `5`. Verify restored campaign/Lore/map/session state and separately test corrupt input and an occupied destination. The argument order and accepted commands are defined by [`backup-cli.mjs`](../server/host/backup-cli.mjs); the exporter version is defined by [`backup.mjs`](../server/host/backup.mjs). Never use valuable data. | Current v5 CLI check is ready on disposable data; record it as a v5 round-trip only. This does **not** satisfy #68’s historical-v4 requirement. |
| Historical backup v4 compatibility (#68) | Obtain an archive with verifiable provenance from the historical v4 producer, then restore it onto a fresh disposable empty host. Verify Lore IDs/links/assets and an existing Table session; also confirm corrupt archive and occupied destination are rejected. Record producer revision/provenance and sanitized restore evidence. | **PENDING / BLOCKED** until a genuine historical-v4 archive, its provenance, and restore evidence exist. A current v5 CLI export or synthetic fixture is not a substitute. Keep #68 open. |
| Historical archive restore (#67) | Obtain trustworthy real exports produced by pre-0.6 v2 and both historical v3 writers (Table-session and brief-Lore layouts) from a consenting owner or reproducible historical producer commit. Restore each into a fresh temporary host; verify IDs, permissions, module pins, actor/encounter visibility, sessions where present, and Lore/assets where present. Keep only sanitized/license-safe fixtures or provenance/checksums. | **BLOCKED — archives are not present in this repository.** Synthetic/current importer fixtures do not satisfy #67. Do not close #67 until genuine producer output is tested. |
| Real network loss/recovery (#68/#88) | A participant disconnects the actual supported network path to the host, reloads cached Lore/map while disconnected, observes stale/read-only state, then reconnects; GM revokes while disconnected and the player checks host reads/search/assets after reconnect. Record path, interruption, elapsed recovery and both players’ caches. | **BLOCKED on the current host topology:** host is loopback-only and rejects LAN binds, so a second device cannot exercise a real client-to-host Wi‑Fi path against this build. Do not relax the bind guard. Requires an explicitly approved supported network test arrangement; browser offline emulation is automation only and not a substitute. |
| Physical touch / narrow / zoom (#88) | On an actual phone and tablet where available, perform Maps tap, pan, pinch/zoom, drag, hit-target, World/Battle scene tasks, then campaign/search/character actions at narrow viewport and user-selected zoom. Check browser/device-specific storage behavior and cached map/Lore presentation. Capture device/browser/OS and sanitized screenshots. | 390px desktop emulation exists as automated evidence only. **PENDING physical hardware and participant observation**; equipment availability has not been confirmed. |
| Keyboard-only (#113) | With mouse/touch not used, complete campaign/character/encounter setup, enroll/grant, publish/search/revoke, action submission, pause/resume/finish, and return. Record tab sequence, visible focus, focus return after dialogs, traps, and any facilitator intervention. | Ready on an available desktop browser with a human operator. Existing automated focus assertions do not complete the task. **PENDING**. |
| Named screen reader (#88/#113) | Record screen reader and version plus OS/browser. Complete navigation, enrollment, form validation, dialog confirmation/cancel, status changes, search results, map/Lore access and revocation using speech/braille output. Check labels, headings, live status/error announcements, focus order, and whether private content is absent. | Requires an installed/available screen reader and a human who can operate it. Availability is **not confirmed**; do not infer from keyboard tests. **PENDING**. |

## Issue crosswalk and evidence boundary

- **#67:** historical archive compatibility is separate from System A/B playtesting. Its required actual pre-0.6 archives are absent from the repository; keep it open until trustworthy producer outputs are tested.
- **#68:** retain its independent three-profile Lore/offline/cache, per-player revocation, Notes brick, links/backlinks, images/denied-image, v4 export/restore, corrupt archive, and occupied-destination requirements. The coastal session covers only the overlapping parts; update #68 only with its own actual results.
- **#88:** retain physical touch/gesture, real Wi‑Fi/router outage, browser/storage, and screen-reader checks. Desktop Chromium emulation, simulated offline controls, and keyboard focus assertions do not complete these checks.
- Link confirmed defects to #109/#110 and the appropriate #111–#113 parent, using the finding template. Keep friction, unverified concern, expected behavior, and confirmed defect distinct. Never make a severity or issue from terminology alone.

## What automation can do now

The full `pnpm check` and existing targeted Chromium/host suites can be run on a dependency-complete checkout or CI. They are regression evidence, not participant evidence; do not repeat deterministic suites just to create more coverage for this manual package. Existing evidence already records System A/B action schemas and authorization, #119 layout repair (including collapsed activation), #126 session copy repair, selected 390px/focus checks, and automated privacy/offline/reconnect assertions. Verify the current main CI once; run targeted automation only after a code change or a suspected regression. A browser/operator can help a facilitator capture sanitized observations, but cannot mark human task outcomes.

## Observation sheet — copy one row per participant and task

Use one entry for each role’s attempt (and keep the System B smoke separate). Leave result and severity blank until observed. For a defect, copy the complete [finding template](v09-playtest-findings-template.md); this sheet is not a substitute for reproducible steps.

| Date/time + zone | Commit | Checklist/follow-up | Participant role | Device/model + OS | Browser/version | Viewport / zoom / input | Network path/state | Start–finish or duration | Expected outcome | Actual result / exact wording | Retries | Assistance (what/when) | Confusion / participant words | Result (PASS/FAIL/BLOCKED/PENDING) | Severity (only if defect) | Sanitized evidence filename + reviewer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | PENDING | | |

### Severity and privacy

Use the checklist severity rubric: S0 privacy/authority, S1 blocker/data safety, S2 major friction, S3 minor friction. Stop on suspected S0 and preserve only sanitized evidence. Never commit database files, raw traces, credentials, GM-only notes, private character data, or unredacted screenshots. Have a second reviewer check crops and traces before placing artifacts under `docs/evidence/v09-playtest/`. Store originals only in the approved private test location. Record participant statements faithfully and only with consent.

## Release-owner decisions before signoff

1. Provide participants and approve the human System A session plus representative human System B smoke; decide who owns each independent QA follow-up and when it will be recorded.
2. Decide whether the missing historical archives can be sourced/generated for #67. If not, explicitly accept or reject that compatibility risk for v0.9; do not call the gap verified.
3. Decide whether #68’s additional Lore/cache/backup checks are completed or explicitly deferred with scope and risk recorded.
4. Decide whether v0.9 requires real-network and physical device validation despite the current loopback-only host; if yes, first approve a safe supported test topology and ensure it does not weaken host security. If not, explicitly accept a deferral and state that LAN/remote behavior is not validated.
5. Arrange physical phone/tablet hardware and a named screen-reader environment, or explicitly accept their deferrals. A green CI run cannot make this decision.
6. Review all participant findings, confirm fixes/deferred items, ensure issues #109–#115, #67, #68, and #88 remain open until their own requirements are met or accepted for deferral, and record the release owner’s signoff in #115 before closing #109.

Until these decisions and the human tasks are recorded, release signoff remains **PENDING**. No claim of remote-host readiness is made.
