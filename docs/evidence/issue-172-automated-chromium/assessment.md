# Issue 172 playability evidence

## Scope and environment

This is an automated Chromium walkthrough of the experimental single-campaign loopback host, started from ordinary Campaign Home. The Revised 5e path used independent GM, Player A, and Player B browser contexts; the contrasting Dice-pool path used a separate disposable host and its non-grid Table. Both hosts used trusted module locks recorded alongside the screenshots. Screenshots are sanitized before writing. The runner is `scripts/v2-rules-workspace-browser-acceptance.mjs`.

The walkthrough covered campaign pin/setup, separate enrollment, guided character and encounter preparation, actor/encounter assignment, Rules movement, durable opportunity reaction and GM accept, Table navigation and return to Rules, authoritative state/revisions, restart/reconnect, exact and changed-input retries, grant revocation, player privacy, and Dice-pool module actions. The accepted Revised 5e reaction applied the pinned resolver's host-roll result, HP damage, reaction consumption, and continued movement in one committed revision. Deterministic host tests separately verified decline continues movement without the attack or reaction consumption.

## Automated result

| Area | Result | Evidence |
| --- | --- | --- |
| Revised 5e normal Rules movement form | PASS | `gm-campaign-home.png`, `gm-opportunity-attack-pending.png` |
| GM adjudication, attack, HP/reaction effects, movement continuation | PASS | `gm-opportunity-attack-resolved.png`, `player-a-opportunity-attack-resolved.png` |
| Table presentation and Rules return | PASS | `gm-table-grid.png`, `player-a-table-grid.png` |
| Retry, changed input, restart, durable receipt and revision checks | PASS | Browser runner assertions and host tests |
| Player authorization, revocation and cross-player privacy | PASS | Browser runner assertions and player/GM projections |
| Dice-pool host, non-grid Table, permitted module action | PASS | `dicepool-table-roster.png`, `dicepool-lock.json` |
| Accepted/declined/rejected/failed/repeated host resolution | PASS | Deterministic host tests; transaction failure injection covers rollback |

## Findings matrix

| Priority | Finding | Disposition |
| --- | --- | --- |
| P0 | GM acceptance previously resumed movement without the selected attack action reaching the resolver, leaving HP and reaction state unchanged. | Fixed by carrying a validated eligible module action in the GM adjudication payload and resolving it in the existing host transaction/continuation path. Exact adjudication receipts now support retry after lost acknowledgement/restart. Regression tests cover accept, decline, invalid/ambiguous input, duplicate/altered retries, restart, and rollback. Tracked by #172. |
| P1 | A pending durable reaction does not push itself into a stale browser view; the GM must use the existing authorized-state refresh before adjudicating. | Keep tracked as phase-2 session feedback in #110/#111; this run verified refresh and correct state, not a live update channel. |
| P2 | The generic movement form represents a path as schema-shaped JSON, which is functional but less discoverable than selecting waypoints on the Table. | Findings-led follow-up under #113 after human observation; no Maps integration or bespoke rules UI is proposed here. |
| P2 | The visible Rules workspace retains a dense generic module/setup shell around the encounter content, and error/empty states need human review at normal zoom and narrow widths. | Track with the existing screen/layout and feedback acceptance in #113; do not infer accessibility from Chromium screenshots. |

## Human evidence still pending

No human GM/player usability session, physical device, real-network test, keyboard-only session, or screen-reader validation was performed. Automated Chromium cannot establish comprehension, discoverability, perceived friction, or assistive-technology behavior. These items remain explicitly pending under #110, with responsive/keyboard/accessibility follow-up in #113 and player navigation follow-up in #112. The single-host constraint remains the documented experimental loopback boundary; no multi-campaign claim is made.

## Issue reconciliation and recommendation

- #110 remains open: the requested human GM + two-player walkthrough and Dice-pool contrast have not been performed. This evidence supplies the automated portions only.
- #111 remains open: activation and return paths were exercised, but the manual-refresh reaction feedback and preparation friction need human observations before scope is refined.
- #112 remains open: independent enrollment, differing grants, privacy, reconnect, and return paths passed in automation; player comprehension and authorized navigation still need human validation.
- #113 remains open: the screenshots expose candidates for layout and feedback review, but keyboard, 390px layout/reflow, and screen-reader evidence are not claimed.
- #172 is addressed by this focused repair and its automated evidence. No additional issue was created because remaining findings already map to #110–#113.

Recommended next implementation PR: add an intuitive, module-neutral waypoint editor for schema-declared coordinate arrays in the generic Rules renderer, while retaining host schema validation and command contracts. It directly reduces GM friction during movement (high practical benefit, moderate scope, moderate renderer regression risk). Before starting that work, collect the human walkthrough observations required by #110 so the next refinement is based on measured session friction. Keep this repair separate from that follow-up.
