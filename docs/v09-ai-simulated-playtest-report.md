# Potomac v0.9 AI-simulated exploratory playtest

**AI-SIMULATED — NOT HUMAN-VALIDATED.** This is a role-based automated exploration of issue [#110](https://github.com/chrspickens/Potomac/issues/110), under tracker [#109](https://github.com/chrspickens/Potomac/issues/109). It is not evidence of a human GM/player session, physical-device use, real network loss, or screen-reader validation.

See the [human playtest checklist](v09-playtest-checklist.md), its [findings template](v09-playtest-findings-template.md), and the earlier [automated usability baseline](v09-playtest-report.md). This report adds exploratory UI observations; it does not replace or duplicate the S01–S12 facilitator script.

## Summary

Two reproducible S2 defects were confirmed through the real loopback UI and recorded as focused issues: [#119](https://github.com/chrspickens/Potomac/issues/119) (GM setup/activation controls are occluded by the GM administration overlay; maps to #111) and [#120](https://github.com/chrspickens/Potomac/issues/120) (player-facing check buttons omit required difficulty parameters in both bundled systems; maps to #112). The reviewer independently verified the action-contract mismatch from source; live UI reproduction was performed by the main agent. The reviewer could not independently launch the app to reproduce #119; the main agent reproduced it twice in fresh campaign setup and once in encounter activation.

No S0 or S1 issue, privacy leak, or unauthorized player control was observed. A separate System B GM/player smoke used a fresh host and pinned campaign. Human GM + two-player playtesting remains **PENDING**, as do physical-device, actual network interruption/reconnect, keyboard-only completion, and screen-reader checks.

## Method and setup

- App source: clean `origin/main` commit `5475f401d0beba63e866deb560b98e69b081eef5`; date 2026-10-16.
- Browser: headless Chrome `155.0.8059.40`, 1424×805 viewport, through the rendered local app UI using Chromium DevTools Protocol pointer/keyboard input. The in-app browser blocked loopback access, so it was not used.
- System A: fresh disposable database and loopback host `127.0.0.1:4187`, web UI on `127.0.0.1:5187`; GM, Player A, and Player B used three isolated Chromium browser contexts and distinct role credentials. Player credentials were enrolled and handed to each context through the GM/player UI prompts. No bearer credential is included here or in committed evidence.
- Setup exception: first GM connection bootstrapped the repository’s demo character Mira Vell. Tamsin Reed was created through the Character UI. Player A was enrolled a second time under the same display name after the first credential had been handed off; the newer membership was used for the final character grant and the first membership was unused. This was test setup, not a product defect finding.
- System B: separate disposable host/database on loopback `127.0.0.1:4188` and web UI `127.0.0.1:5190`, campaign pinned to `example.system-b@0.1.0`. The GM prepared and started a session; a separately authenticated Player B context received Tarin Vale and exercised its visible actions. Neither system module nor its pin was edited.
- Persona/review agents received role-scoped summaries and performed independent reasoning/source review; they did **not** operate the live browser contexts. The main agent performed all reported UI interactions. Thus the three contexts provide isolation, not three independent human participants.
- A browser offline toggle was attempted for Player A, but the app continued to report connected. DevTools’ `Network.closeConnections` was unavailable in this Chrome protocol. Disconnect/reconnect is therefore **NOT VERIFIED**.

The only committed screenshot is a crop of a public Lore article from Player A’s authorized view. It excludes the campaign header, identity/profile controls, GM-only note, credentials, and private campaign content. No database, raw trace, credential, GM-only Lore, or full-page screenshot is committed.

## Automated exploratory coverage

“Observed” below means an AI agent operated the application UI in an isolated Chromium context, not that a human participant completed the checklist step.

| Checklist | Automated observation | Result |
|---|---|---|
| S01 Campaign setup | Fresh loopback startup succeeded. Saving from the center of the visible Save campaign control was intercepted by the GM administration disclosure; a narrow edge click saved. See #119. | Defect confirmed |
| S02 Characters | Created Tamsin Reed through the UI; the pre-existing Mira Vell was a startup demo actor, not a second UI-created character. Leaving resource fields blank was accepted as 0/0 HP and Mana. | Partial; 0/0 presentation is friction to ask humans about, not a confirmed defect |
| S03 Enrollment/grants | Separate GM/A/B browser contexts authenticated with distinct credentials. Characters were granted through the GM UI. No cross-player or GM-only content exposure was observed. | Partial; duplicate Player A enrollment setup exception above |
| S04 Encounter preparation | Created “Graywater at Low Tide”, edited its player-facing summary, selected both characters, saved, and opened Table. Expanded GM administration also intercepted the encounter-activation control until collapsed. See #119. | Defect confirmed |
| S05 Lore | Published a shared article with a GM-only note and created a separate GM-only Lore entry. Player A saw the shared article body but not the GM-only note or private entry. After “Revoke from players,” the shared article disappeared from Player A’s current view. | Observed for Player A; Player B’s post-revocation view was not checked |
| S06 Maps | Created a World Map and Battle Map through the UI, published both, and verified that Player A could find both. A location pin was created at the default center and remained GM-only. No image was uploaded; no map-revocation pass was completed. | Partial |
| S07 Navigation/search | Player A opened Maps then used Return to Table. Player B searched for Graywater, opened the encounter result, and used Back to origin. | Observed |
| S08 Live session/action | Started the Table session; both player contexts saw active status without pause/end controls. The visible System A Roll Strength Check action rejected for both players. Spend 1 Mana was accepted. In System B, Roll Instinct Test rejected while Spend 1 Hope was accepted. See #120. | Defect confirmed |
| S09 Pause/resume | GM paused and resumed through the session controls. Both players’ Table status changed with the session. | Observed via UI; no human interpretation interview |
| S10 Revocation | GM revoked the shared Lore article. Player A no longer saw its title or body. | Partial; no Map revocation or Player B post-revocation check |
| S11 Finish/return | Finished the System A session, then returned to preparation; later restarted only to reproduce the player-action rejection, and finished again. The separate System B session was also ended. | Observed |
| S12 Debrief | Low-cost persona agents commented on role-scoped views; they were not participants and were given summaries rather than live browser access. | Human debrief PENDING |

The separate [automated usability baseline](v09-playtest-report.md) records earlier results. During this report’s preparation, `pnpm check` was also rerun successfully: build, 129 tests, diagnostic smoke, System A campaign, System B Table, offline, offline storage, Table, Lore, Maps host, and Maps browser acceptance all passed. The run used the dependency-complete checkout after verifying its tracked `packages`, `server`, `clients`, `modules`, `scripts`, and package manifests match this report’s `origin/main` commit. The checkout’s pre-existing evidence changes were left untouched. These deterministic checks do not validate human usability.

## Role-scoped observations

- **GM:** The create-character form extended below the initial viewport and required scrolling to reach submission. Submitting blank resource fields produced 0/0 values without inline explanation. The Save campaign target and encounter activation target were obscured as detailed above. Both “Start Table session” and a separate “Start session” control were visible in different Table surfaces; the intent overlap was not explained in their labels.
- **Player A:** After authentication but before the character grant, Campaign Home said no authorized character/content was available and directed the player to wait or review content. After the grant, Tamsin was visible. Player A navigated Maps → Return to Table, opened the shared Lore article before revocation, did not see GM-only text, and no longer saw the article after revocation. The visible Character-sheet check action was rejected.
- **Player B:** With Mira authorized, the player independently searched for “Graywater,” opened the encounter result, and used Back to origin to return to Table. The live Table showed Mira and active-session status, but search described the encounter as `prepared`; whether this wording is expected lifecycle terminology remains for a human facilitator to assess. A valid resource action succeeded while both System A and System B check buttons failed as described.
- **Timing, retries, and assistance:** No stopwatch or human hesitation measure was collected. The UI driver had to scroll to reach below-fold form controls, collapse GM administration before activation, and click the exposed save-button edge to complete setup. Those are observed automation recovery actions, not participant timing or human facilitator-rescue measurements. Role-play subagents reviewed supplied role-scoped descriptions; they did not receive live browser control. No human participant quotations are included.

## Verified findings

### S2 — GM administration obscures primary setup and activation controls (#119)

Role: GM. Fresh campaign setup at a 1424×805 viewport.

1. Enter a campaign name and select an installed module in Campaign setup.
2. Click the center of Save campaign. The app expands GM administration rather than saving; the campaign remains on its prior setup. Browser hit-testing showed the Save button center targeted the overlapping GM administration `SUMMARY` element.
3. On the encounter page, leave GM administration expanded and click Activate and open Table. The overlay intercepts the control; collapsing the GM panel makes it actionable.

The Save control occupied x=954.47–1086.73, y=67–106; the disclosure occupied x=970–1388, y=71–102. Clicking at x=960,y=85 saved successfully, but requires discovering a narrow exposed strip. This is reproducible UI occlusion, not a host-authority or data-integrity failure. The issue is linked to #109, #110, and parent work #111.

### S2 — System A/B player check actions omit required parameters (#120)

Role: authorized Player A/B, during active sessions.

1. Open Characters and select an authorized character.
2. Click the visible System A “Roll Strength Check” action. Both Player A and Player B received `strength-check rejected; no local state was committed.`
3. In the separate pinned System B campaign, click “Roll Instinct Test.” Player B received `instinct-test rejected; no local state was committed.`
4. As controls, Player B’s System A “Spend 1 Mana” and System B “Spend 1 Hope” actions were accepted and advanced character revisions.

The bundled check rules require `difficulty`; the Character-sheet action controls provide no parameter. Their compact-brick counterparts supply fixed difficulty values. The visible Character action therefore cannot succeed as presented. The failure is reproducible in both systems and is consistent with the source contracts. No unauthorized data or false committed-state feedback was observed. The issue is linked to #109, #110, and parent work #112. Do not change an already pinned module in place; any fix must preserve versioned module contracts.

## Friction and unverified concerns (not filed as defects)

- A new character submitted with blank resource inputs appeared as 0/0 HP and Mana. The form accepted it, but an automated actor cannot determine whether this is an intentional zero-resource character or a harmful default. Ask a human GM what they expect before filing.
- The UI presents both “Start Table session” and a separate pinned-brick “Start session” control. Both led to a live session in the observed GM flow, but agents found the distinction unclear. Human comprehension and duplicate-transition behavior remain unvalidated.
- Campaign search showed the encounter as `prepared` while Table simultaneously showed the live session and current encounter. This may distinguish encounter lifecycle from live-session state; confirm the meaning with human participants before calling it misleading.
- The World map pin began GM-only. The map itself was published; no attempt was made to expose that pin. This was expected under the visible privacy model and not a leak.
- The network toggle did not cause the app to show disconnected, so offline-state messaging and recovery were not assessed.

## Human facilitator handoff — still pending

The human acceptance rows in the checklist remain **PENDING**. A facilitator should use a fresh disposable database and three people (GM, Player A, Player B), each on their own profile/device; do not reuse these generated credentials or seed data. Follow S01–S12 in [the checklist](v09-playtest-checklist.md) and copy observations into [the findings template](v09-playtest-findings-template.md). Existing issue [#114](https://github.com/chrspickens/Potomac/issues/114) tracks independent manual QA follow-ups.

At minimum, still ask participants to:

1. Complete the full paced System A session without hints; capture hesitation, retries, exact wording, time, and expected versus actual at each step.
2. Create two characters with realistic nonzero resources; clarify whether blank resource values should be rejected or defaulted.
3. Independently locate authorized characters, Lore, maps, and the active session; test actions and explain the two GM session controls and prepared/active wording.
4. Have both players open a shared Lore article/map before GM revocation, then refresh/search/reopen from both profiles. Explain that revocation cannot erase already downloaded copies.
5. Perform a real Wi-Fi/cellular interruption and reconnect on participant devices; do not substitute Chromium contexts or offline emulation for this.
6. Repeat on physical touch devices and complete keyboard-only and screen-reader tasks with named assistive technology. Record exact hardware, browser/OS, viewport, zoom, and screen-reader versions.
7. Debrief participants separately and attribute their own words; do not infer human results from the AI role agents.

Keep #109 and #110 open until their acceptance requirements, including the human follow-up above, are reviewed. This report and its evidence are explicitly AI-simulated.
