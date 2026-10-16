# Potomac v0.9 AI-simulated regression report

**AI-SIMULATED — NOT HUMAN-VALIDATED.** This focused regression follow-up is for [#110](https://github.com/chrspickens/Potomac/issues/110), after the fixes in [#119](https://github.com/chrspickens/Potomac/issues/119) and [#120](https://github.com/chrspickens/Potomac/issues/120) merged to `main` at `da6e5c51d05a9151fa7a36b5a14eaecc198733b7`. It supplements, rather than replaces, the [S01–S12 facilitator checklist](v09-playtest-checklist.md), its [findings template](v09-playtest-findings-template.md), and the earlier [AI-simulated exploratory report](v09-ai-simulated-playtest-report.md).

No human GM/player session, physical-device use, real network interruption, or screen-reader validation is represented here. The role contexts were isolated Chromium browser contexts, not people.

## Outcome

- The #119 Save overlap repair remained usable in the actual GM UI: Save campaign was center-clicked with administration both expanded and collapsed and each save produced host-confirmed feedback. Activate and open Table was center-clicked with administration expanded and entered the Table for the prepared encounter. The collapsed-state activation control was not available for a second check in this follow-up because the encounter was already active; see remaining tasks.
- The #120 System A player check repair worked through the real Character UI. Missing and out-of-range difficulty submissions were rejected without advancing the actor revision and showed validation feedback; entering an in-range difficulty was accepted at revision 2, with a visible roll result. The first attempt at the submit button was below the viewport; scrolling it into view made the actual interaction possible. No module contract or pin was changed.
- The separate pinned System B browser acceptance passed on a fresh host. It verified schema-rendered difficulty, missing/invalid feedback, an accepted check, a no-input resource action, revoked-player denial, private-field redaction, and reconnect to authoritative session state. This was deterministic acceptance automation, not an independently navigating System B persona.
- No new reproducible S0–S2 defect or privacy/authorization leak was confirmed. One reproducible S3 copy defect was observed in GM session feedback: Pause session displayed `Session pauseed.` and Resume session displayed `Session resumeed.` The source constructs these by appending `ed` to command names. It is tracked in [#124](https://github.com/chrspickens/Potomac/issues/124), linked to #109, #110, and GM workflow parent #111; this is not a session-state failure.

## Direct UI observations

The main agent used a fresh disposable System A host on loopback with separate GM, Player A, and Player B browser contexts and distinct enrolled credentials. Setup, enrollment, character grants, encounter preparation/update, activation, session start/pause/resume/end, and player actions were performed through visible controls. Credentials and private character details were not copied into this report. No screenshots or traces were committed because the rendered GM view includes a one-time credential and private campaign fields.

| Area | Observed result | Assessment |
|---|---|---|
| Save / #119 | Center hit target was the Save button; save feedback confirmed host persistence with administration open and closed. | Repaired path passed in both disclosure states. |
| Activate / #119 | With administration expanded, the prepared encounter’s activation button center was unobscured; click opened Table with the intended encounter context. | Repaired expanded-state path passed. Collapsed-state activation was not separately re-run because the encounter was already active. |
| Session controls | GM started, paused, resumed, and ended a session; players observed live-session state and had no GM session controls. The GM then used **Return to preparation** separately; the UI confirmed that shared session context was unchanged. | Core transitions worked. Pause/resume confirmation text has the S3 grammar defect noted above. |
| Character actions / #120 | Player A’s authorized System A character showed a schema-derived required Difficulty input. Empty and value 31 submissions showed validation errors with no revision change; an in-range submission was accepted at revision 2 with a visible roll result. | Repaired path passed. Button placement below the initial viewport required scrolling. |
| Mobile emulation / keyboard | At 390×844 CSS pixels, `document.documentElement.scrollWidth` and `document.body.scrollWidth` were both 390. Tab navigation reached a button with `:focus-visible`, solid 2px outline. | No horizontal overflow or missing focus indicator observed in this sample. Not physical-device or assistive-technology testing. |
| System B | Fresh pinned System B acceptance browser workflow passed; module action schema and compact Table-brick parameters remained unchanged. | Automated regression passed; no independent persona exploration in this follow-up. |

An independent low-cost reviewer reviewed the status-message implementation and issue classification. That reviewer did not use the browser; the observations above are direct main-agent browser observations. Existing acceptance assertions on main cover System A/B invalid and valid inputs, actor switching after validation, authorization, and no-input actions, but this follow-up did not rerun those assertions because a dependency-complete installation was unavailable in this worktree.

## Residual friction and limits

The disposable System A character created with blank resource fields displayed 0/0 HP and Mana while default attributes displayed 1. The GM Table offered both “Start Table session” and a Session brick “Start session” before the session began. Search and lifecycle wording such as `prepared` versus active-session state should be assessed by facilitators. These are usability observations, not confirmed rule or authorization defects; no issues are filed for them.

This focused follow-up did not freshly revisit Lore publication/revocation, map sharing/revocation, search across all content types, or player actor switching by direct persona exploration. The prior AI report documents its earlier exploration; those areas still need human review. Offline/cache behavior, a real network disconnect/reconnect, physical devices, and screen-reader operation also remain unvalidated here.

## Verification and facilitator handoff

- `pnpm acceptance:system-b-table` — passed, including the coverage listed above.
- `pnpm check` — attempted but blocked before build/tests: pnpm refused the worktree’s dependency junction as its task-run-state directory. Removing the junction and trying an offline dependency install failed because required packages were absent from the local store; online install was stopped after registry TLS certificate verification failures. A fresh green GitHub Actions run is required for this report PR.
- `git diff --cached --check` — passed for the report.

Human follow-up remains **PENDING**: run S01–S12 with one GM and two players on separate profiles/devices; verify the collapsed-state Activate/Open Table hit target; have each person independently create/find characters and shared Lore/maps, search, leave/return to Table, perform permitted actions, and report confusion without coaching; repeat with a fresh pinned System B campaign; test physical mobile devices, real network interruption/reconnect, keyboard-only completion, and a named screen reader. Use the checklist and findings template above and do not reuse the disposable credentials or campaign data.
