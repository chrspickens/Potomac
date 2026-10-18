# Tides & Omens

Tides & Omens is a bounded, symbolic narrative scene. No dice are rolled. A player chooses an approach (`observe`, `bargain`, or `endure`) and commits one available fate token (`calm`, `storm`, or `omen`). The deterministic resolver consumes the token, advances progress and/or danger, and appends the choice to that player's persistent record. Progress and danger are capped at four; each token pool is capped at three; the recent choice history is capped at four entries.

## Sample scene: The Bell Beneath the Tide

The harbor bell is ringing underwater. The navigator and keeper each receive a principal-owned decision record, initialized by the GM with role, `progress: 0`, `danger: 0`, `tokens: { calm: 2, storm: 2, omen: 1 }`, and `choices: []`. The players make independent persistent decisions through the same command. `observe` with `calm` opens a path; `endure` or `storm` raises danger; `omen` with `bargain` reveals a clue while advancing progress and danger. A successful bargain after a calm opening restores one calm token, up to the pool limit.

These are two distinct player roles and two independent owned records. The public contract does not define how a GM assigns a created record to a player principal or how to bind multiple private records into one shared scene panel; those setup details are intentionally not implied as implemented integration behavior. The entity's current visibility is `owner` or `gm`; public outcome/event summaries reveal only role and scene counters, never token inventory or choice history.

The module is trusted bundled JavaScript. Its declarations and digest do not make it safe to load as an untrusted plugin. This phase does not add it to the trusted catalog.
