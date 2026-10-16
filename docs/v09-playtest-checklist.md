# Potomac v0.9 human playtest script

Tracks [issue #110](https://github.com/chrspickens/Potomac/issues/110) under the v0.9 tracker [#109](https://github.com/chrspickens/Potomac/issues/109). This document guides one complete, paced System A campaign session with a GM, Player A, and Player B. Automated evidence is recorded separately from human observations.

## Current verification record

**Automated checks run 2026-10-15** from `codex/v08-release-acceptance-98` at `a4bd781` with Node 24.13.1, pnpm 11.25.0, and Chrome available in the environment:

| Check | Result | Scope observed |
|---|---|---|
| `pnpm acceptance:lore` | PASS (exit 0) | Disposable host, Lore HTTP authorization/projection/event checks, real GM/Player A/Player B browser contexts, GM UI create/publish/revoke, shared article views, GM-note redaction. |
| `pnpm check` | PASS (exit 0) | Build; 129 Node tests; debug smoke; campaign, System B Table, offline, storage, Table, Lore, Maps, and Maps browser acceptances. Maps browser stages 1–10 passed. |
| Human GM + Player A + Player B playtest in this document | **PENDING** | Not performed in this verification run. No human observations are claimed. |
| GitHub Actions for the playtest PR | **PENDING** | Only report a CI result after the PR workflow exists and its run has completed. |

### Historical Lore contract audit

The older Lore QA notes describe mismatches that were observed at an earlier point. Current source contracts and the successful `pnpm acceptance:lore` run show no reproduction in the checked-out build:

| Historical concern | Current contract checked | Current result |
|---|---|---|
| Visibility mismatch | Client article visibility is `gm` or `shared`; the host emits those projections and filters player reads/events by current access. | Not reproduced; host tests and Lore acceptance passed. |
| Kind/type mismatch | The client uses `kind` in its app model and maps it to/from the host wire/storage field `type`. | Not reproduced; host and client tests plus Lore acceptance passed. |
| Archive route mismatch | Client and host accept `PUT /api/lore/:id/archive` (and `/restore`) with `operationId` and `baseRevision`. | Not reproduced; the acceptance archive request passed. |
| UI command-shape mismatch | Create/update send the host-accepted fields; publication uses `/publication` with `published`; archive sends the expected revision and operation ID. | Not reproduced; UI-driven create, publish, and revoke assertions passed. |

No bug issue was opened: there is no confirmed current defect from these checks. A later failure should be recorded with the request path, method, status, sanitized response, role, and reproducible browser steps before filing a bug.

## Coverage matrix

A passing automation row is evidence only for the assertions in that runner. It is not a proxy for a person completing the end-to-end session or for physical-device and assistive-technology behavior.

| Area | Existing automated coverage | Human-only coverage / limit | Human result |
|---|---|---|---|
| Campaign Home → preparation → Table → wrap-up | `pnpm acceptance:campaign` (`scripts/workspace-acceptance.mjs`) covers fresh System A setup, character and encounter preparation, grants, three browser contexts, Table roster, session start/pause/resume, navigation, persistence, redaction, and backup. | One continuous, paced tabletop-style session with participants; discoverability, comprehension, handoffs, confusion, and recovery without facilitator rescue. | PENDING |
| Lore create/share/privacy | `pnpm acceptance:lore`; `server/host/lore.test.mjs`, `clients/web/src/lore.test.mjs`; Maps browser covers Lore UI, linking, publication/revocation, assets, search/navigation, and privacy. | People understand draft/share/revoke state, find the article, follow links/backlinks, and understand that downloaded copies may remain after revocation. | PENDING |
| World/Battle Maps | `pnpm acceptance:maps`, `pnpm acceptance:maps-browser`; map UI, assets, visibility, links, offline/cache/restart, keyboard and narrow viewport assertions. | Real-device map readability, touch/gesture behavior, zoom/reflow quality, and participant understanding of the selected map. | PENDING |
| System B | `pnpm acceptance:system-b-table` runs a fresh pinned System B Table/Character smoke with API-provisioned fixtures, a player action, HTTP/SSE/DOM redaction, and reconnect. Maps browser stage 10 adds System B map bootstrap. | Human smoke on a pinned System B campaign. It is narrower than the System A walkthrough and does not establish a complete System B campaign session. | PENDING |
| Keyboard and small viewport | Campaign and Maps browser automation asserts selected keyboard controls/focus and a 390px viewport. | Full keyboard-only task completion, focus clarity during the session, real-device reflow, and zoom at user-selected magnification. | PENDING |
| Touch, screen reader, assistive technology | No automated acceptance here proves physical-device behavior or human announcements. | Touch ergonomics; screen-reader announcements and navigation using named assistive technologies. | PENDING |
| Physical connectivity and recovery | Offline and reconnect suites simulate network conditions; browser runners exercise host restart and cache/reconciliation paths. | Real Wi-Fi/cellular interruption, perceived waiting, uncertainty, and recovery comprehension on participant devices. | PENDING |
| Privacy-safe evidence | Automated assertions inspect selected DOM and actual HTTP/SSE bytes for protected values. | Human capture process must avoid credentials/private content and verify what a participant actually sees. | PENDING |

## Session objective and scenario

Run a fictional coastal investigation from campaign setup through session wrap-up. The GM prepares two characters, one encounter, one public Lore article, one private GM-only note, a World Map, and a Battle Map. Player A and Player B each use a separate enrolled identity and receive only the intended character/content grants. The group investigates a signal at the Flooded Observatory, uses the shared map and Lore, pauses and resumes the session, then finishes it.

Use names and content created for this test. Do not use a real campaign or a database that must be preserved. Do not expose the host beyond loopback. Local development bearer tokens are fixtures, not production credentials.

## Record the test environment

Complete this block before starting. Use one browser profile per role; do not reuse the GM profile for either player.

| Field | Record |
|---|---|
| Date/time and facilitator | PENDING |
| Potomac commit / branch | PENDING |
| OS and version | PENDING |
| Host device/model | PENDING |
| GM device/model, browser + full version, viewport, zoom, input method | PENDING |
| Player A device/model, browser + full version, viewport, zoom, input method | PENDING |
| Player B device/model, browser + full version, viewport, zoom, input method | PENDING |
| Screen reader / assistive technology and version, if used | PENDING / not used (record only after asking participant) |
| Network type and any interruption used | PENDING |
| Disposable database confirmed; host URL is loopback | PENDING |
| Profile separation confirmed (GM / A / B) | PENDING |
| Evidence folder and redaction reviewer | PENDING |

For a developer build, use a disposable `POTOMAC_DB` path and the documented local commands (`pnpm dev:host` and `pnpm dev:web`, in separate terminals if you need to restart only the host). Confirm the host listens on loopback before enrolling players. Never paste generated credentials into the report. A human test should use credentials enrolled for Player A and Player B; do not use shared browser storage to simulate separate members.

## How to score each step

Start every item as **PENDING**. Mark **PASS** only after the participant performs the action and the expected visible/authoritative result is observed. Mark **FAIL** when the expected result does not occur or a privacy/permission boundary is violated. Mark **BLOCKED** when the participant cannot attempt the step for a recorded environment or prerequisite reason. If the action eventually succeeds but the participant hesitates, misinterprets a label, repeats it, or needs a hint, record the result and the friction; do not hide it inside a PASS.

For every step, capture: role/profile; start and finish time or elapsed time; exact label/message seen; expected result; actual result; whether help was needed; severity if there is a defect; and a privacy-reviewed evidence filename. Write what the participant said or did, not what the facilitator assumes they meant. Blank fields remain blank/PENDING until observed.

## Complete System A playtest

| ID | Actor | Participant task | Pass observation | Fail / friction observation | Result and notes |
|---|---|---|---|---|---|
| S01 | GM | Open Campaign Home, create/configure a fresh campaign, choose the exact System A module/version, and save. Refresh and confirm the selected campaign is still clear. | Campaign name and pinned module/version are visible and remain after refresh; no unrelated campaign/fixtures appear. | Missing/ambiguous setup, wrong module/version, unexpected seed data, save not acknowledged, or facilitator must use source/database edits. | PENDING |
| S02 | GM | Create Character A and Character B through the character app. Edit one normal field and save each. Open each complete sheet. | Both distinct characters show module-defined fields/actions; saved edits appear with clear committed feedback and survive navigation. | Duplicate/unclear records, invalid edit accepted, stale state presented as committed, missing fields/actions, or rescue required. | PENDING |
| S03 | GM | Enroll Player A and Player B separately. Give each their own credential privately. Grant A their intended character and B their intended character; keep one GM-only field/note. | Each profile authenticates as the correct member and sees only granted records. Credential delivery does not expose the other player’s identity or credential. | Wrong member/profile, unrelated character/secret visible, GM-only control available, or credential copied into shared evidence. Treat a privacy leak as S0. | PENDING |
| S04 | GM | Create “Flooded Observatory” encounter, add both characters, edit the player-visible summary, and activate it. | Encounter detail and roster show both stable character identities; GM and players can tell which encounter is active. | Participant missing/duplicated, summary/roster not saved, stale active context, or unclear distinction between prepared and active. | PENDING |
| S05 | GM | Create “Signal at Low Tide” Lore article. Add a tag, safe Markdown, and a GM-only note. Keep it private while preparing, then publish it. | GM can distinguish private draft from published state; players A and B can find/open the shared article, while the GM note and private articles stay absent. | Publication unclear/not committed, wrong players gain access, GM note/private title appears to players, or Markdown renders unsafe content. | PENDING |
| S06 | GM | Create “Ashen Coast” World Map and “Flooded Observatory” Battle Map. Add one representative token/pin and connect relevant Lore or encounter context. Publish only intended content. | The intended map, token/pin, and links are visible to the right roles; GM can identify which map is active/selected. | Wrong map/context, missing asset or link, nonfunctional controls, private pin/content exposed, or share state unclear. | PENDING |
| S07 | Player A + Player B | From each independent profile, use the landing/navigation/search surfaces to find the active encounter, character sheet, public Lore, and shared map. Open an item and return to the session. | Each player reaches only authorized records and returns to the expected encounter/session context without GM intervention. | Search reveals unauthorized metadata; navigation loses context; item opens the wrong record; participant needs a hint or retries. | PENDING |
| S08 | GM + players | Start the live session from the Table/session UI. Have each player verify active/read-only status. Player A performs one permitted action declared by the pinned System A module. | GM sees committed active state; players see the same authoritative status with role-appropriate controls; accepted action shows committed feedback and consistent state. | Player can administer session; pending action appears committed; action is denied without explanation; views disagree beyond expected refresh time. | PENDING |
| S09 | GM + players | Pause the session. Ask each player what they believe the state means. Resume and continue the investigation using the shared Lore/map. | All clients converge on paused then active state; participants distinguish pause from disconnect/offline; campaign context stays usable. | Confusing status, divergent state, accidental duplicate transitions/actions, or facilitator rescue. Record participant wording verbatim when useful. | PENDING |
| S10 | GM + players | Revoke one previously shared Lore article (or map) after both players have opened it. Have each player refresh/search/reopen and explain what they expect from any already downloaded copy. | New host reads/search results are no longer available; UI indicates current access. Group understands revocation cannot reliably erase a prior local copy. | New reads still succeed, unauthorized data is re-sent, stale copy looks newly authorized/current, or UI promises physical erasure. | PENDING |
| S11 | GM + players | Resume if needed, finish the session, then navigate back to Campaign Home and reopen the campaign/encounter summary. Optionally restart the disposable host and reload all three profiles. | Finished state is clear; return navigation preserves campaign identity; after restart, committed campaign/roster/session state remains authoritative. | Session cannot be finished/reopened, return loses identity/context, state disappears/duplicates, or a pending edit is shown as accepted. | PENDING |
| S12 | GM + players | Debrief separately first, then together. Ask: where did you hesitate, what did you expect, what did you avoid because it seemed risky, and what would you change? | Facilitator records each person’s own words and links them to the step; no claim is inferred from silence. | Observation is missing role/source or combines different participants’ reports without attribution. | PENDING |

### Separate System B human smoke

This is a smaller, separate fresh-host check, not a repeat of the System A walkthrough. Pin a disposable campaign to the exact System B module/version. Have the GM create or provision one character and encounter, enroll one player, start the generic Table session, and have the player perform one System B action. Confirm the player-visible state and GM-only field handling, then reconnect after a brief controlled disconnect if feasible. Record all environment and outcome fields above. Do not count API-provisioned automation as a human UI pass.

Result: **PENDING** until performed by a human GM and player. The automated System B smoke is listed in the coverage matrix only.

## Severity rubric

- **S0 — privacy / authority:** a player sees another member’s credential or unauthorized private field/title/count/event, can perform a GM-only action, or the UI claims an uncommitted change was committed. Stop the playtest, preserve only sanitized evidence, and report promptly.
- **S1 — session blocker / data safety:** a required role cannot continue, committed state is lost/duplicated, or recovery requires database/source edits or risks data loss.
- **S2 — major friction:** task eventually succeeds but likely abandonment, repeated errors, facilitator rescue, or substantial uncertainty is needed.
- **S3 — minor friction:** wording, focus, layout, or feedback is confusing while the intended path remains discoverable.

Severity describes impact, not how often the participant complained. Record frequency and participant impact separately.

## Privacy-safe evidence capture

- Use fictional campaign content and generated credentials; never attach a database, credential, raw request body, or unreviewed trace.
- Capture screenshots only after checking the whole image for bearer values, private Lore, player names the group did not consent to share, local paths, and unrelated windows. Crop/redact before saving; keep the original only in the approved private test location.
- Store shareable evidence under a dedicated `docs/evidence/v09-playtest/` directory only after review. Prefer a short sanitized observation note over a network dump.
- If a privacy defect is suspected, capture role, action, request method/path/status, and a redacted response excerpt. Do not include the sensitive value itself. Use a fresh disposable record and stop further exposure.
- Label human artifacts `human`; label automation artifacts with the exact command, commit, and runner. Never combine them into a single “passed” claim.

## Exit and tracking rules

The playtest deliverable is ready for a facilitator, but every human row above remains **PENDING** until performed and individually recorded. Update findings using [`v09-playtest-findings-template.md`](v09-playtest-findings-template.md). Open targeted bug issues only for reproducible confirmed defects; link them to #110 and, when relevant, #109. Keep #110 open until the human-playtest deliverable and limitations have been explicitly reviewed. Keep tracker #109 open.
