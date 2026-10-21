# Playability and refinement plan

**Scope:** Issue [#109](https://github.com/chrspickens/Potomac/issues/109), with [#110](https://github.com/chrspickens/Potomac/issues/110) as the next P0. This plan moves the next evidence-gathering step from V2 architecture work to an observed GM and player workflow. It does not claim that v0.9 or v1.0 release gates are complete.

**Verified baseline:** PR #179 is merged into `main` at `2b9110dd1ea113a485f6e8d85baeea096b3dac54`. The exact post-merge `Checks` run [39537184949](https://github.com/chrspickens/Potomac/actions/runs/39537184949) passed on that SHA. On the same baseline, `pnpm acceptance:v2-rules-workspace-browser` passed three consecutive times, including the Revised 5e restart/reconnect journey and the separate Dice-pool Finish Session flow; full `pnpm check` passed. These are automated results, not human usability signoff. The genuine GM + two-player playtest and human-only accessibility/network checks remain pending. The ordinary Campaign Home exposes trusted V2 setup behind the experimental loopback-only gate; the host pins the exact reviewed lock. Use the [Revised 5e human playtest runbook](revised5e-human-playtest-runbook.md) to prepare the human session. See [ADR-0014](adr/0014-normal-ui-trusted-v2-onboarding.md) and the [v0.9 playtest checklist](v09-playtest-checklist.md).

## Next P0: Revised 5e GM + two-player walkthrough

Use one fresh disposable host per V2 module because the current V2 host supports one configured campaign. GM, Player A, and Player B use separate fresh Chromium profiles for automated acceptance; a separate human session uses real participants and records only what they did and said. Start at ordinary Campaign Home. Do not enter via `/v2-modules`, seed data through APIs, edit SQLite, or imply that one host supports multiple V2 campaigns.

| Step | Role and task | Observe and verify |
| --- | --- | --- |
| 1. Setup | GM creates a fresh campaign from Campaign Home and chooses the reviewed experimental Revised 5e option. | Host-created campaign ID; full exact lock (module ID/version/digest and capability closure); no browser-constructed provenance; refresh preserves the workspace. |
| 2. Enroll | GM enrolls Player A and Player B separately and securely gives each their own original credential. Each player signs in through ordinary navigation. | Correct member identity per fresh profile; no credentials in screenshots, logs, or another player's view. |
| 3. Characters | GM creates two module-defined characters with the generic schema-aware UI, assigns ownership/grants, and retains one GM-private field. | Stable IDs and owners; GM can inspect both; each player sees only their authorized character and permitted fields. |
| 4. Encounter preparation | GM prepares a small encounter using existing module-defined records and adds both characters. | Preparation is discoverable in the normal workspace; active context and roster are explicit and survive navigation. |
| 5. Table | GM opens the existing Table/session flow and starts the session; both players navigate to it. | GM and players see role-appropriate session state; Return to Table preserves campaign and encounter context. |
| 6. Actions and reaction | Each player performs a permitted Revised 5e action. Trigger one real authorized durable reaction; test the eligible responder and an ineligible/revoked responder. | Committed feedback matches host state; reaction eligibility is explicit; no duplicate effect on exact retry; unauthorized continuation fails closed. |
| 7. Battle map | GM opens the encounter's battle map, makes one representative change, and grants only the intended view/action. Players use the normal navigation route. | Correct map/context; each player sees only authorized content; player A cannot read or act on player B's private/owned data. |
| 8. Return and reconnect | Pause/finish as appropriate, return to preparation, refresh all three profiles, and restart the disposable host once. Then reconnect and resume the campaign. | Campaign, lock, ownership, grants, receipts, events and session state persist; exact retry returns the prior receipt; altered retry conflicts; stale state refreshes from host. Do not queue offline V2 encounter actions. |
| 9. Debrief | Ask each participant separately where they hesitated, what they expected, and whether they needed help; then compare. | Capture each person's words and role separately; record assistance and elapsed time, including uneventful steps. |

Use only mechanics and actions already supplied by the pinned module; this exercise is not a request to add gameplay features. Any permission/privacy defect is a stop condition. A host restart verifies the documented local SQLite process-restart scenario only, not power-loss, multi-process, or public-host guarantees.

## Contrast: Dice-pool modularity smoke

Use a second fresh disposable single-campaign host and a second ordinary Campaign Home setup. Select the reviewed experimental Dice-pool module, record its complete exact lock, create one module-defined entity through the generic UI, enroll one player, perform one permitted module-defined action, and verify the corresponding authorized view and persistence after refresh. Do not reuse a lock, campaign, or seeded V2 state from Revised 5e. This is a small contrast for modularity, not a second full human campaign or evidence of broad module support.

## Evidence bundle and result rules

For every run, retain a privacy-reviewed bundle under `docs/evidence/v09-playtest/` (or an explicitly private location until reviewed):

1. `run.md`: reproducible steps, date, commit, commands, browser versions/viewports, loopback host setup, module lock, profile separation, and whether the run was **automated Chromium** or **human**.
2. `matrix.csv` or `matrix.md`: one row per step and role with expected result, observed result, elapsed time, help/rescue, `PASS` / `FAIL` / `BLOCKED`, severity, and evidence filename. Initialize unattempted rows as `PENDING`; never infer a pass.
3. `observations.md`: GM, Player A, and Player B notes in separate sections, including exact wording or action and the step where it happened.
4. Sanitized screenshots only where a visible state helps reproduce or explain the result. Review the entire image for credentials, private content, names without consent, local paths, and unrelated windows; never commit databases, bearer credentials, raw private payloads, or unreviewed traces.
5. `friction.md`: confirmed defects and friction ranked by impact: S0 privacy/authority, S1 core-flow/data-safety blocker, S2 substantial confusion/rescue, S3 minor wording/layout. Each item links to its reproduction and existing issue or one new focused issue if no tracker covers it.

An automated Chromium result demonstrates only the assertions exercised by that runner. It does not count as a human pass, physical device/network test, keyboard-only task completion, or screen-reader evaluation. Leave human, real-network, physical-device, and assistive-technology rows explicitly `PENDING`/`BLOCKED` until performed. AI-simulated users are also not human participants. Reuse `docs/v09-playtest-findings-template.md` for confirmed observations; do not create speculative child issues.

## Execution order and safeguards

1. **P0 #110:** run the walkthrough above and publish the evidence bundle; keep human results separate from Chromium.
2. File or fix only reproduced S0/S1 core-flow, privacy, authorization, recovery, or V1-compatibility blockers. Link them to #109/#110 and add a regression at the owning layer.
3. **#111 GM preparation/session friction**, then **#112 player enrollment/navigation/return friction**, driven by the recorded observations.
4. **#113 responsive, keyboard and feedback refinement** from observed issues; preserve the separate manual accessibility gate in #114.
5. **#114 manual QA coordination** and **#115 regression/release signoff** after scoped issues are resolved or explicitly dispositioned by the release owner.

Within all steps, preserve V1 campaign behavior, immutable exact V2 module locks, host authorization and visibility filtering, durable receipts/recovery, and game-neutral Core. Do not implement gameplay mechanics during the playtest-planning pass.

## Deferred future work

The following remain documented future work and are not the immediate #110 implementation plan: multi-campaign V2 host support (which needs campaign-scoped routing, membership/authority and isolation across persistence, events, assets and backups); extra example modules; third-party/untrusted module installation or execution; programmable combat AI; offline encounter-action queues or automatic reconciliation; and major abstractions/architecture rewrites. Reopen these only when a reproducible blocker demonstrates the need and the boundary is separately reviewed.

The single-campaign V2 host, loopback-only default-off experimental gate, bundled trusted catalog, and absence of public identity/transport guarantees must remain visible in any playtest report. This plan does not close #131, #139, #145, #109, or any historical/device QA issue.
