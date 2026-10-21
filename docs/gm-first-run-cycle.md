# GM first-run autonomous usability cycle

## Scope and method

The initial walkthrough used the checked-out `feat/issue-135-reaction-windows` branch in a disposable local host and Chromium session. The independent agent received the application URL and task objectives only, and used visible application controls. It did not use APIs, database edits, fixtures, developer routes, or source code. A fresh agent is repeating the objectives against the revised UI under the same restrictions.

This is autonomous agent-based usability evidence, not human usability validation.

## Initial walkthrough findings

| GM task | Initial result | Classification | Workflow impact |
| --- | --- | --- | --- |
| Identify active system and Revised 5e pin | Campaign displayed no pinned system. Installed choices were Emberbound 0.1.0 and Hollow Stars 0.1.0. Revised 5e was unavailable. | Missing expected functionality on this branch; unpinned state was also unclear | Blocking for a Revised 5e campaign; cannot safely substitute another system |
| Enroll two players and sign in independently | “Enroll player” produced no visible form or confirmation in Chromium. The handler used a browser-native prompt. | Existing functionality that was difficult to discover / broken in this browser context | Blocking player setup |
| Create two PCs and three enemies | Encounter shell could be created, but no characters were available. The branch offers only its two prototype modules and has no usable 5e enemy roster. | Deliberate experimental prototype limitation | Blocking a populated encounter |
| Prepare encounter roster | Encounter creation worked; the empty roster gave no useful next step when there were no actors. | Confusing or incomplete UI | High friction; appears as a dead end |
| Place participants on battle map | Map creation and actor token placement exist, but there were no actors and the encounter-to-map handoff was not apparent. | Existing functionality that is difficult to discover; actor requirement blocked the path | Blocking in this walkthrough |
| Start session, run two rounds, attacks, movement, reactions | Generic session lifecycle exists, but this branch has no combat rounds, attack/action resolution, movement mechanics, or reaction execution. | Deliberate experimental prototype limitation | Blocking combat objectives |
| Review encounter and finish session | Session history and finish controls exist in the prototype, but no session could be started from the empty encounter. | Existing lifecycle functionality behind blocked setup | Blocked by earlier steps |
| Return to preparation | A Table return-to-preparation control exists; it was not reached in the initial run. | Not observed | — |

The initial agent stopped rather than choosing a fictional substitute for Revised 5e. The pre-change Chromium view is preserved in `docs/evidence/gm-first-run/before-campaign-home.png`; it shows “System not configured” and the collapsed administration disclosure, with no visible enrollment control. The revised app is captured in `after-campaign-home.png` and `after-enrollment-form.png`. The screenshots contain no player credential values.

## Diagnosis and refinement

This branch is an experimental foundation, not the later Revised 5e implementation. Core behavior remains rules-neutral. The pinned module/version is campaign configuration, and the host continues to authorize enrollment, grants, map commands, and session lifecycle. Player credentials remain bearer credentials scoped to the existing local host; the credential value is presented for handoff only after successful enrollment.

This increment makes the highest-impact supported preparation paths visible:

- Campaign Home states the pinned module name and exact `id@version`, or clearly indicates that no ruleset is pinned.
- GM Preparation exposes player enrollment directly.
- Enrollment, player credential entry, and character grants use in-app forms instead of native browser prompts.
- The credential handoff labels the credential as shown once, without implying the bearer token itself is single-use.
- Encounter-to-Maps navigation carries the encounter context, associates a newly created map through the existing host-authorized command, and offers a direct return to encounter preparation.
- Map preparation explains that newly placed actor tokens begin at center and can be dragged or positioned with X/Y coordinates.

No Revised 5e content, enemy compendium, combat engine, or battle-map editor is added in this increment.

## Remaining unsupported work

A separate product/implementation issue should cover installing or porting the Revised 5e module and its bounded rules, schemas, character creation, enemy stat blocks, attacks, movement, rounds, and reactions on the intended branch. The current branch does not have enough rules content to complete the combat task safely. Once those module capabilities exist, a focused follow-up can connect the encounter roster to three enemies and add combat review appropriate to that module. This should not be implemented as game-specific Core logic.

## Fresh independent retest

The fresh agent received only the revised app URL and original objectives. It used ordinary browser controls and did not inspect source, APIs, databases, fixtures, or developer routes.

| Task | Retest result | Evidence / limit |
| --- | --- | --- |
| Identify active system and Revised 5e | Confirmed no system was pinned; only Emberbound 0.1.0 and Hollow Stars 0.1.0 were offered. | The agent left the campaign unpinned and did not substitute another system. |
| Enroll two players and receive credentials | Completed for Avery and Morgan. | The agent kept credentials private and omitted their values from its report. |
| Authenticate independently | Not verified by the agent. | Its browser surface exposed only one context. The repository’s Chromium acceptance later completed UI credential sign-in in two isolated contexts. |
| Create an encounter with two PCs and three enemies | Blocked. | The existing encounter opened but had no characters; Revised 5e and its enemy roster are absent. The agent canceled character creation rather than choose a different ruleset. |
| Place participants on a Battle Map | Created a 100×70 square-grid Battle Map. | Its actor selector had no authorized characters, so it could not position participants. |
| Run combat, attacks, movement and reactions | Blocked by missing ruleset, actors, and combat mechanics. | This is an experimental prototype limitation on this branch. |
| Review, finish, and return to preparation | Not reached. | No live session could be started from the empty roster. |

Compared with the initial walkthrough, the revised GM can now see the unpinned ruleset state, open enrollment immediately from Preparation, and complete two player enrollments. The first-run test suite also verified player credential entry in two independent Chromium contexts and host-authorized character grants. Encounter combat remains blocked by the missing module capabilities, so the full objective list did not complete.

## Screenshots

- Before: `docs/evidence/gm-first-run/before-campaign-home.png`
- After: `docs/evidence/gm-first-run/after-campaign-home.png`
- After, enrollment form: `docs/evidence/gm-first-run/after-enrollment-form.png`

## Verification evidence

- Focused Chromium campaign acceptance (`pnpm acceptance:campaign`): PASS. Covers two independent sign-ins, visible credential handoff, grant permissions, encounter roster workflows, and new Battle Map association plus return-to-preparation checks.
- Maps Chromium acceptance (`pnpm acceptance:maps-browser`): PASS. Its first-run portion verifies two players enroll and authenticate in separate browser contexts. Generated Maps evidence was restored after the run.
- Full `pnpm check`: PASS, exit code 0. Includes production build, 132 Node tests, smoke checks, and all repository acceptance suites.
- Separate `pnpm build`: PASS, exit code 0.
- `git diff --check`: PASS.
- Hosted GitHub Actions: not triggered. The repository’s `Checks` workflow only runs on pushes to `main` and pull requests targeting `main`. This refinement is based on `feat/issue-135-reaction-windows`; targeting that branch keeps the draft PR focused, but does not match the workflow trigger. The hosted-run limitation is recorded rather than claiming a CI result.

No human usability validation was performed.

## Independent retest

The fresh agent confirmed that the no-pin state is explicit and completed two enrollments through the visible UI. Its browser environment exposed only one browser context, so it could not authenticate both players independently; the Chromium acceptance suite then completed both sign-ins in separate contexts. It did not receive implementation coaching. Encounter creation, map placement, and combat remained blocked by the absent Revised 5e module and actor roster.

