# Role observations (automated browser only)

These are screen observations, not participant opinions. No human usability validation was performed.

## GM

- Started in ordinary Campaign Home and selected the reviewed Revised 5e module; no manual catalog URL or module provenance construction was needed.
- Campaign Home displayed the exact root module ID, version and digest and an **Open rules workspace** control.
- **Enroll a player** issued a one-time credential for each enrollment. The UI says to share it securely; the runner kept it in memory and excluded that view from screenshots.
- The Rules create form for `example.revised5e.encounter` exposes a large nested combat-state schema (multiple actors, positions, movement, class/resource fields, grid, initiative, logs). Default strings appear as `x`; the UI does not turn this into a guided character/encounter-preparation flow.
- Returning to Campaign Home showed no authorized characters and no active session. No V2 encounter, Table roster, map handoff, or next action was available there.

## Player A

- The original GM-issued credential authenticated in an isolated browser context; Rules navigation and return to Home worked.
- Home showed a getting-started/no authorized content state, no character, no current encounter and no live session.
- The V1 private-draft controls were also present at the top of the V2 player home. This is potentially confusing because no V2 character/action was available to draft.
- The player view contained no bearer credential. There was no private module data to evaluate against the other player.

## Player B

- Same authentication and navigation outcome as Player A in a distinct Chromium context.
- No authorized character, encounter, or player action was available. The same V1 draft controls were shown.
- The player view contained no bearer credential. Cross-player privacy was not meaningfully exercised because there was no player-owned state.

## Automated evidence boundaries

Separate Chromium contexts prove the UI accepted each issued identity and displayed the Player role. The run did not establish human comprehension, clear recovery guidance after errors, concurrent live-table collaboration, actual player action, or private-field filtering when content is present.
