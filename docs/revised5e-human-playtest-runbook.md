# Revised 5e human usability playtest runbook

**Purpose:** prepare an observed, first human GM + two-player usability session for issue [#110](https://github.com/chrspickens/Potomac/issues/110). The primary question is whether people can comfortably prepare and run a Revised 5e encounter through ordinary Potomac navigation. This is a facilitator guide, not product signoff. Every human task and accessibility/network check begins **PENDING**.

## Baseline and scope

Baseline is merged PR [#177](https://github.com/chrspickens/Potomac/pull/177), `origin/main` commit `1a28fb61728d261d7ebfb6cf944b75d495b68fba` (`Improve Revised 5e action controls (#177)`). PR Checks passed (run [39523958207](https://github.com/chrspickens/Potomac/actions/runs/39523958207)). The separate post-merge `main` Checks run [39524567014](https://github.com/chrspickens/Potomac/actions/runs/39524567014) **failed** after a timeout waiting for Player A's completed Revised 5e state after host restart. A focused local run of `pnpm acceptance:v2-rules-workspace-browser` passed on source baseline `1a28fb6` (documentation branch commit `59a864a`); it exercised the ordinary Revised 5e setup, session start, Rules actions, guided movement, accepted opportunity attack, Table handoff, restart/reconnect, and finish, plus the separate Dice-pool contrast. This pass does not erase the failed full `main` Checks result; investigate the discrepancy and verify a passing full run on `main` before scheduling. Automated results do not establish participant comfort or unprompted reaction discovery.

The older recorded browser report at [`2026-10-20-automated-chromium`](evidence/v09-playtest/2026-10-20-automated-chromium/run.md) predates the later session, movement, reaction, and action-control merges; its missing-control and #172 findings are historical, not current assertions. On the merged #177 baseline, the post-merge `Checks` run reached the Revised 5e ordinary-workspace browser acceptance, which exercised setup, Start Session, Rules actions, guided movement and accepted opportunity attack before timing out while Player A refreshed to the completed state after host restart. The run therefore did not verify the post-restart completion, Table handoff after that restart, Finish Session, or full reconnect path. See [run 39524567014](https://github.com/chrspickens/Potomac/actions/runs/39524567014). The automated suite explicitly refreshes the GM to surface the pending reaction; it does not answer whether a GM discovers the need to adjudicate without a refresh cue. The runbook keeps that as a dedicated human task. Investigate the CI timeout and obtain a passing current-baseline run before scheduling the complete human session. Do not mark any human outcome from automation.

Run only against a fresh local/test database, on loopback, with three independently authenticated browser profiles: one GM, Player A, and Player B. Use the ordinary application route from Campaign Home. Do not start in a diagnostic/module page, seed or edit records through APIs/SQLite, reuse prior credentials, or point at a real campaign. The V2 host currently supports one configured campaign; use a separate disposable database for the Dice-pool smoke.

## Local disposable setup, launch, and reset

1. Check out the verified post-merge `main` commit in a clean working tree. Confirm pnpm is `11.25.0`, then run `pnpm install --frozen-lockfile`. Record commit, OS, browser versions, and date. Do not copy any credentials from earlier runs.
2. Create a new, empty, run-specific directory outside the repository (for example `%TEMP%\potomac-playtest-<date>-<random>`). Put the disposable SQLite database and three fresh browser-profile directories (`profiles\gm`, `profiles\player-a`, `profiles\player-b`) inside it. Do not reuse a path or a normal browser profile. In the host terminal set `POTOMAC_DB` to that new database path, `POTOMAC_SEED_DEMO=0`, and `POTOMAC_ENABLE_EXPERIMENTAL_V2=1`. The latter is required for the reviewed experimental V2 campaign flow. Keep values in that terminal's environment; never put credentials or personal data in them.
3. Terminal 1, from the repository root: `pnpm dev:host`. Confirm the printed host address is loopback (`127.0.0.1`) and do not change the bind address. In Terminal 2, set `$env:VITE_POTOMAC_HOST='http://127.0.0.1:4177'`, then run `pnpm dev:web`. Open the printed local web URL in three separate browser profiles (GM, A, B), not three tabs sharing one profile. Use isolated temporary profile directories under this run directory (for Chromium, pass `--user-data-dir=<runDir>\profiles\gm`, `--user-data-dir=<runDir>\profiles\player-a`, and `--user-data-dir=<runDir>\profiles\player-b` to three browser instances). Keep the default dev GM token (`local-gm`) local to this machine; it is a localhost-only fixture, not an account or production credential. V2 player identities must be separately enrolled in the normal UI.
4. Start in normal Campaign Home. GM creates a new campaign, selects the reviewed experimental Revised 5e module shown by the UI, and records its exact module ID/version/lock digest in the private run record (never credentials). If the ordinary UI or module is unavailable on the verified baseline, stop and record the exact blocker; do not seed through APIs or switch to a diagnostic page.
5. GM enrolls Player A and Player B separately in the normal UI. Deliver each generated credential privately to its participant, once. Do not write credentials into this runbook, notes, screenshots, issue comments, shell history, or shared chat. Verify each browser profile shows the intended identity before play.
6. To reset, finish/close the session, stop both dev processes, close the three temporary browser instances so their profile data is released, and delete only the uniquely named disposable run directory after confirming its resolved path is within the OS temporary directory and matches the run-specific name. This removes the test database, generated assets, remembered credentials, and all three browser profiles. Never reset by pointing at a shared DB, `git clean`, deleting repository data, or clearing another profile's general browser storage. For another run, make a new random directory and enroll fresh identities.

PowerShell example for a newly chosen suffix (replace it with a unique random value for every run):

```powershell
$runDir = Join-Path $env:TEMP 'potomac-playtest-2026-10-21-a1b2c3'
New-Item -ItemType Directory -Path $runDir
New-Item -ItemType Directory -Path (Join-Path $runDir 'profiles\gm'), (Join-Path $runDir 'profiles\player-a'), (Join-Path $runDir 'profiles\player-b') -Force
$env:POTOMAC_DB = Join-Path $runDir 'playtest.sqlite'
$env:POTOMAC_SEED_DEMO = '0'
$env:POTOMAC_ENABLE_EXPERIMENTAL_V2 = '1'
pnpm dev:host
```

In Terminal 2, after setting `VITE_POTOMAC_HOST` and starting `pnpm dev:web`, use its printed URL (shown here as an example) with three isolated Chrome profiles:

```powershell
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" # substitute your installed browser executable if needed
$webUrl = 'http://127.0.0.1:5173' # replace with the URL printed by Vite
Start-Process -FilePath $chrome -ArgumentList @("--user-data-dir=$(Join-Path $runDir 'profiles\gm')", $webUrl)
Start-Process -FilePath $chrome -ArgumentList @("--user-data-dir=$(Join-Path $runDir 'profiles\player-a')", $webUrl)
Start-Process -FilePath $chrome -ArgumentList @("--user-data-dir=$(Join-Path $runDir 'profiles\player-b')", $webUrl)
```

For the second Dice-pool run, repeat with a different never-used directory and the same loopback/experimental setup. Do not use shell history to enter or print player credentials.

Reset only after both processes have stopped and all three profiles are closed. Replace the suffix below with the exact directory created for this run; verify the printed path before the final command:

```powershell
$runDir = (Resolve-Path (Join-Path $env:TEMP 'potomac-playtest-2026-10-21-a1b2c3')).Path
$tempRoot = (Resolve-Path $env:TEMP).Path
if (-not $runDir.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing reset outside TEMP' }
if ((Split-Path -Leaf $runDir) -notmatch '^potomac-playtest-') { throw 'Refusing reset: unexpected directory name' }
$runDir
# Only after verifying the exact path above:
Remove-Item -LiteralPath $runDir -Recurse -Force
```

The credentials are local development bearer credentials, not real accounts. Keep the host loopback-only and the test fictional. Anyone with local administrator access to the host may access local test artifacts. No player should use a real password or personal campaign content.

## Participant briefing

Tell participants: “We are evaluating whether Potomac makes it comfortable to prepare and play a short fictional encounter. Please think aloud about what you expect and what you are looking for. Use the application as you normally would. I may stay quiet while you try. You can stop at any time. Please do not use real personal information.” Do not give a tour, prescribe a click sequence, or tell the GM to refresh to find a reaction. If help is requested, note the exact question and intervention before helping.

### Scenario

The group is guarding a fictional ruined observatory during a storm. The GM creates a small Revised 5e encounter with the two player characters and one generic foe using only options already available in the module. Player A is a front-line adventurer; Player B is a scout. They each have a clear goal to reach the observatory door. The foe begins near the approach. Do not prescribe character build choices or action button labels; let participants prepare through the UI and choose reasonable available options. Avoid real licensed setting text or any sensitive content.

## Human session tasks and success criteria

Aim for 60–90 minutes. Ask each participant to narrate expectations. Observe navigation; do not teach controls before an attempt. Mark each task PENDING until performed. “Pass” means the task completed with authoritative state consistent between roles; comfort/discoverability are recorded separately and do not disappear inside a pass.

| ID | Participant task | Success evidence |
|---|---|---|
| T1 Campaign setup (GM) | Start from the ordinary app and create a new campaign with Revised 5e. | Campaign and exact module identity persist after navigating away and returning. GM can explain what system/version was selected. |
| T2 Enrollment (GM, A, B) | GM enrolls both players. Each player independently signs in and describes whose account they are using. | Three distinct authenticated identities; no credential exposure; GM can identify both players. |
| T3 Guided character prep (GM, A, B) | Prepare and assign one character to each player using the guided UI. | Each player can find their own character; cross-player data stays private; participants understand their available options and what was saved. |
| T4 Encounter prep (GM) | Create the observatory encounter, add both characters and foe, and make it ready to play. If the ordinary UI supports a GM-private detail, retain one and verify players cannot see it; do not manufacture it through an API. | GM can identify roster, encounter context, and saved/prepared state without facilitator direction. Players cannot see any retained GM-private detail. If the flow has no private-detail control, record that #110 acceptance as BLOCKED for triage. |
| T5 Start Session (GM, A, B) | Begin the encounter as a live session. Players find the session and report what they think its status means. | Session is live in host state and role-appropriate views; no duplicate or ambiguous start; participants can tell when play is active. |
| T6 Rules actions (A, B) | Each player independently chooses an available action that fits their goal and completes it through Rules. | Correct actor/action and clear available choices; committed outcome is visible and understood. Invalid or unavailable choices are distinguished from pending/committed results. |
| T7 Guided movement (A, B) | Each player moves toward the door using the app's guided movement flow. | Movement resolves as intended, is bounded by the module rules, and both roles can understand the result. Record uncertainty, retries, and facilitator rescue. |
| T8 Opportunity attack (GM and eligible player) | Let a character leave the foe's threatened area through normal movement. Do not pre-explain the reaction path. | The eligible player can discover/resolve the opportunity attack and GM/player understand the effect and whose turn/action is involved. If the feature cannot be triggered by normal UI, record BLOCKED with steps; do not fabricate it. |
| T9 Pending-reaction discovery (GM, unprompted) | Trigger an action that creates a real pending reaction for another role. Say only “Continue when you think the group is ready.” Do not mention refresh, polling, or where a notice appears. Observe whether GM notices adjudication is needed and how the group discovers the responder/action. | Record time to notice, first action taken, whether refresh was independently considered, any waiting/duplicate submission, participant interpretation, and whether the authorized responder can act. GM recognizes a pending adjudication need without facilitator cue or forced refresh. This is a discoverability measure; report correctness separately. |
| T10 Table navigation (A, B, GM) | Leave Table for another normal app area, then return to the live encounter. | All three return to the correct encounter and understand shared live state without losing context. Record excess navigation and wrong turns. |
| T11 Finish Session (GM, A, B) | GM ends the encounter; each player explains what changed and how they would return to preparation. | Session is finished authoritatively, status is clear for all roles, and return path preserves the campaign/encounter. |
| T12 Reconnect (all) | Refresh each profile; restart the local host once if time permits, then reconnect. | Committed campaign, roster, encounter and finished-session state remains consistent; no duplicate actions. Record whether anyone mistakes reconnect for an uncommitted action. Host restart is local-process recovery only, not a real network outage. |
| T13 Debrief (each separately) | Ask: What felt easy? Where did you stop or backtrack? What did you think would happen? Were your available actions clear? What would you change first? | Keep each participant's exact words and role separate, with consent for quotations. Do not infer comfort from silence or task completion. |

Stop immediately for suspected disclosure of another player's data, credentials, GM-only information, unauthorized action, or UI claim that an uncommitted action was committed. Record only sanitized facts and classify P0.

## Role-specific observation sheets

Copy one sheet per role. For each assigned task, record: task ID; start/end time; result (PENDING/PASS/FAIL/BLOCKED); path tried in participant's own words; labels they noticed; confusion/hesitation; wrong turns and backtracks; retries; help or hints (exact wording); expected vs actual outcome; unexpected outcome; whether available actions were clear; reaction discovery/recognition; and sanitized evidence filename. Also record device/browser/viewport/zoom/input and accessibility preferences volunteered by the participant. Never record credentials.

### GM

Tasks: T1, T2, T4, T5, T8, T9, T10, T11, T12, T13. Specifically record encounter preparation time; whether roster/system/action options were understandable; any uncertainty about prepared/live/finished state; pending-reaction recognition time and first response; whether GM had to refresh (and whether that was self-discovered); excessive navigation; and ability to return to preparation.

| Task | Result / time | Confusion, wrong turns, retries | Help given | Expected vs actual / unexpected outcome | Actions/status clarity | Reaction noticed? time / first response | Ease (1–5) |
|---|---|---|---|---|---|---|---|
| T1 | PENDING | | | | | N/A | |
| T2 | PENDING | | | | | N/A | |
| T4 | PENDING | | | | | N/A | |
| T5 | PENDING | | | | | N/A | |
| T8 | PENDING | | | | | N/A | |
| T9 | PENDING | | | | | PENDING | |
| T10 | PENDING | | | | | N/A | |
| T11 | PENDING | | | | | N/A | |
| T12 | PENDING | | | | | N/A | |
| T13 | PENDING | | | | | N/A | |

### Player A

Tasks: T2, T3, T5, T6, T7, T8 if eligible, T9 if responder/observer, T10, T11, T12, T13. Record identity/character clarity, action discoverability, movement and opportunity-attack comprehension, reaction notice visibility, any perceived wait or uncertainty, privacy boundaries, and Table return.

| Task | Result / time | Confusion, wrong turns, retries | Help given | Expected vs actual / unexpected outcome | Available actions clear? | Reaction noticed / understood? | Ease (1–5) |
|---|---|---|---|---|---|---|---|
| T2 | PENDING | | | | | N/A | |
| T3 | PENDING | | | | | N/A | |
| T5 | PENDING | | | | | N/A | |
| T6 | PENDING | | | | | N/A | |
| T7 | PENDING | | | | | N/A | |
| T8 | PENDING / N/A if not eligible | | | | | | |
| T9 | PENDING / observer or responder | | | | | | |
| T10 | PENDING | | | | | N/A | |
| T11 | PENDING | | | | | N/A | |
| T12 | PENDING | | | | | N/A | |
| T13 | PENDING | | | | | N/A | |

### Player B

Tasks: T2, T3, T5, T6, T7, T8 if eligible, T9 if responder/observer, T10, T11, T12, T13. Record the same categories independently; do not let Player A's explanation substitute for Player B's experience.

| Task | Result / time | Confusion, wrong turns, retries | Help given | Expected vs actual / unexpected outcome | Available actions clear? | Reaction noticed / understood? | Ease (1–5) |
|---|---|---|---|---|---|---|---|
| T2 | PENDING | | | | | N/A | |
| T3 | PENDING | | | | | N/A | |
| T5 | PENDING | | | | | N/A | |
| T6 | PENDING | | | | | N/A | |
| T7 | PENDING | | | | | N/A | |
| T8 | PENDING / N/A if not eligible | | | | | | |
| T9 | PENDING / observer or responder | | | | | | |
| T10 | PENDING | | | | | N/A | |
| T11 | PENDING | | | | | N/A | |
| T12 | PENDING | | | | | N/A | |
| T13 | PENDING | | | | | N/A | |

## Standard findings matrix

Use one row per distinct observation. A task can succeed and still have usability friction. Rank confirmed issues by impact; keep raw observation separate from diagnosis.

| Rank | Definition | Disposition rule |
|---|---|---|
| **P0 correctness/security** | Unauthorized/private data exposure; unauthorized action; incorrect or duplicated committed rule effect; pending shown as committed; data loss or irreconcilable session state; host boundary bypass. | Stop the affected activity, preserve sanitized reproduction details, notify maintainers, and create/link a focused defect. Never capture the secret itself. |
| **P1 significant usability friction** | A core task is not discoverable or requires rescue; repeated wrong turns/retries; GM misses needed adjudication; actions/status are materially unclear; excessive navigation risks abandoning play. | Record exact reproduction and role; link to #110 and relevant #111/#112/#113. Open a scoped issue only for reproducible friction. |
| **P2 polish** | Localized wording, layout, or feedback annoyance with core task still clear and successful. | Record participant impact/frequency; group similar observations; defer implementation decisions until reviewed. |

| Finding ID | Rank | Task/role | Expected | Observed (quote/action) | Repro steps | Completion/time/help/retries | Privacy-safe evidence | Linked tracker | Status/owner |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

Do not promote an isolated preference or an automated observation into a confirmed human defect. Create bug issues only after reproduction; distinguish unverified concern, product defect, and facilitator question.

## Smaller Dice-pool smoke

Use a **second fresh disposable database** and new identities. In ordinary Campaign Home, create a separate campaign and select the reviewed Dice-pool module. Have the GM prepare one small scene/encounter, assign one player character, start a session, and let the player complete one available Dice-pool Rules action. Confirm ordinary Table navigation works without a grid requirement and state persists after refresh. Record exact module lock, actions, roles, and outcome. Do not edit or seed through APIs, reuse Revised 5e data, or imply this is a full Dice-pool playtest. Keep human result **PENDING** until run.

## Human evidence still required

Record each item as PENDING until a person actually performs and evidence is recorded:

- **Keyboard-only:** A human completes the core path without mouse/touch and reports focus visibility, order, dialog focus return, traps, and workarounds. Automated focus assertions do not count.
- **Touch device:** A participant tests on an actual phone/tablet (not desktop viewport emulation), including movement/map gestures and target accuracy.
- **Network interruption:** A participant uses the real supported network path, interrupts it, observes status and recovery, then reconnects. Current loopback-only topology means this may be BLOCKED until a safe supported test topology is separately available; do not weaken loopback guards or call browser offline emulation a real interruption.
- **Screen reader:** Record named reader/version, OS/browser, and a human operator's completion of navigation, forms, session/reaction status, and error announcements. Keyboard success does not substitute.

## Tracking and closeout

This package prepares #110; it does not close it. After human execution, attach sanitized evidence and update #110 with date, baseline, human roles, outcome, findings, and manual gaps. Route GM/session findings to #111, player enrollment/action/navigation findings to #112, and feedback/keyboard/responsive observations to #113. Keep #114 as the coordination/evidence gate for remaining manual QA, and maintain the human-only checks above as pending until evidenced. Do not close #110 until the genuine GM + two-player playtest is complete and every remaining acceptance criterion is satisfied or explicitly deferred by the responsible release owner.
