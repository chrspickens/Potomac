# V2 combat turn and action clarity

This autonomous assessment started from `origin/main` at `6a90b3fb6912c29f30bc905b9b30ec3e6308c09c`, after PR #184 was merged. The trusted Revised 5e module remained exactly pinned at version `1.3.0`; no Revised 5e rules or capability digests changed.

## Source-blind initial walkthrough

A separate agent used normal visible controls in a disposable V2 playtest. It created a Revised 5e campaign, enrolled two players, prepared two characters and three enemies, started the session, rolled initiative, completed two combat rounds with an attack, movement and opportunity-attack adjudication, reviewed the finished encounter and returned to preparation.

Observed problems:

- Players could not tell which encounter character they controlled. The host correctly removed owner principal IDs from player projections, but exposed no safe ownership cue.
- Initiative showed raw participant IDs and did not mark the active participant or current round clearly.
- The global Table route appeared empty until the GM used **Open in Table** from Rules. That control worked, but its relationship to the active encounter was unclear.
- A player could see “No live session” and “No authorized character yet” in the legacy session banner while the V2 Rules workspace showed a live encounter.
- Some invalid movement submissions produced generic conflict feedback.
- The supported opportunity-attack flow worked. The prototype still supports only one eligible responder for a triggering movement and does not model multiple simultaneous responders.

The initial agent reported that screenshots appeared in its browser-tool output but could not save them to local files. The source-blind findings therefore have no local screenshot paths.

## Refinement

- Added a readable initiative sequence using only the module's existing ordered participant IDs, participant records, round and current-turn index. Rules and Table both identify the active participant and distinguish player characters from GM-controlled enemies.
- Added host-generated `viewerOwnedPaths` to authorized entity projections. It contains only paths to records owned by the authenticated principal, never principal IDs. The player UI labels the matching character **Your character**; host filtering and command authorization remain authoritative.
- Disabled an out-of-turn character action after the player selects that character, with a message naming the current participant. Other action permissions and all submitted commands are still checked by the host.
- Summarized committed Revised 5e attack, movement and turn outcomes from the host response. Rendered combat and movement history as readable chronological lists. Pending reactions continue to state that effects are not committed yet.
- Mapped recognizable host rejection messages to plain-language explanations while retaining the original host detail.
- Replaced the stale V1 player session banner in the V2 Rules workspace with a workspace-specific cue and a direct **Return to Table** action.

## Screenshots

The browser acceptance runner sanitized principal IDs and capability digests before saving evidence.

| Before | After |
| --- | --- |
| ![Before: generic initiative command feedback](../evidence/v2-combat-turn-action-clarity/before/host-feedback.png) | ![After: readable host-confirmed initiative feedback](../evidence/v2-combat-turn-action-clarity/after/host-feedback.png) |
| ![Before: stale V1 player session banner in V2 Rules](../evidence/v2-combat-turn-action-clarity/before/player-rules.png) | ![After: V2 Rules workspace context](../evidence/v2-combat-turn-action-clarity/after/player-rules.png) |

The focused browser run also captures the three-opponent Table and finished-session state in its disposable evidence directory; those files are not committed here because they repeat PR #184's roster evidence.

## Retest and limits

- The fresh independent source-blind agent could not access a browser in its environment, so an independent post-change usability walkthrough was not completed. This is not human usability validation.
- Automated Chromium acceptance used isolated GM, Player A and Player B contexts against a real host, and verified the ownership marker, out-of-turn action feedback, combat outcomes, opportunity reaction, session completion, privacy and persistence.
- The generic contribution still shows some resource values without a complete per-action economy explanation. That needs module-declared action-cost metadata before the UI can accurately distinguish every already-spent resource without guessing rules.
- History keeps the module's separate combat and movement logs in chronological order within each list. The module does not store a shared sequence number, so the UI does not claim a precise cross-list interleaving.
- Revised 5e's single eligible opportunity-attack responder limitation is unchanged and remains documented by the module.
