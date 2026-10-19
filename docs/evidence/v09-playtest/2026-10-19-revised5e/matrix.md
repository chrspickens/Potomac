# Playability matrix

Automated Chromium evidence from [`run.md`](run.md). `PASS` means only the exact UI step below was observed; it is not a human pass. Human-run results are **PENDING** throughout.

| Workflow | GM | Player A | Player B | Result / evidence |
|---|---|---|---|---|
| Ordinary Campaign Home → fresh Revised 5e pin | PASS: selected bundled module; Campaign Home showed root ID/version/digest | — | — | Root provenance visible; full capability closure not exposed in UI. GM screenshot. |
| GM enrolls two members | PASS: two one-time credentials issued through Rules UI | — | — | Credential values stayed in memory and are absent from artifacts. GM screenshot after leaving enrollment view. |
| Original credential authentication and normal navigation | — | PASS: authenticated in separate Chromium context; opened Rules and returned Home | PASS: same | Exact-lock status visible in Rules; player principal IDs redacted in JSON. Player screenshots. |
| Character creation and assignment | BLOCKED | BLOCKED | BLOCKED | Revised 5e catalog exposes an encounter aggregate, not separate character setup; owner principal is a raw schema field. No assigned character was created. |
| Encounter preparation | PARTIAL | — | — | Generic Revised 5e encounter schema form is visible; it is very large and begins with sample `x` values. Not completed as a realistic encounter. |
| V2 Table / session return | BLOCKED | BLOCKED | BLOCKED | Campaign Home says no live session/current encounter; V1 Table navigation remains but does not show this V2 module state. |
| Initiative, attack, resources, reaction | BLOCKED in normal campaign path | BLOCKED | BLOCKED | No Revised 5e commands rendered in ordinary Rules workspace. Existing `/v2-combat` automated acceptance uses API-created state and is not a normal onboarding/playability pass. |
| Battle map | UNAVAILABLE in this module flow | UNAVAILABLE | UNAVAILABLE | No V2 map binding or encounter-to-Map flow surfaced in the inspected workspace. Existing V1 Maps remains present. |
| Restart/reconnect, exact/altered retry | NOT ATTEMPTED | NOT ATTEMPTED | NOT ATTEMPTED | No committed gameplay command existed to retry; do not infer backup/reconnect acceptance. |
| Privacy / cross-player access | PARTIAL | PARTIAL | PARTIAL | Fresh players saw no character, session, or campaign content before GM assignment; no private module record existed. Private-field and cross-owner assertions remain pending. Credentials were not present in player screenshots/text. |
| Dice-pool contrast | PARTIAL | NOT ATTEMPTED | — | Separate host; normal UI pinned Dice-pool and GM created one scene through its generic schema form. Player action and `gmNote` privacy were not tested. |
| Human GM + two-player experience | PENDING | PENDING | PENDING | No human participants. |

## Overall status

The V2 campaign setup, exact root pin display, enrollment, original credential authentication, Rules navigation and return-to-home path are supported through the application UI. The planned Revised 5e session is blocked before characters/actions: normal Campaign Home/Table is not connected to the module’s encounter state, and module combat controls are absent from the generic workspace. No API or specialized-route workaround was used to inflate acceptance.
