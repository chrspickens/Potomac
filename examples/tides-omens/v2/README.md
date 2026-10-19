# Tides & Omens

Tides & Omens is a bounded, symbolic narrative scene. No dice are rolled. A player chooses an approach (`observe`, `bargain`, or `endure`) and commits one available fate token (`calm`, `storm`, or `omen`). The deterministic resolver consumes the token, advances progress and/or danger, and appends the choice to that player's persistent record. Progress and danger are capped at four; each token pool is capped at three; the recent choice history is capped at four entries.

## Sample scene: The Bell Beneath the Tide

The harbor bell is ringing underwater. The navigator and keeper each receive a principal-owned decision record, initialized by the GM with role, `progress: 0`, `danger: 0`, `tokens: { calm: 2, storm: 2, omen: 1 }`, and `choices: []`. The players make independent persistent decisions through the same command. `observe` with `calm` opens a path; `endure` or `storm` raises danger; `omen` with `bargain` reveals a clue while advancing progress and danger. A successful bargain after a calm opening restores one calm token, up to the pool limit.

These are two distinct player roles and two independent principal-owned records. In the trusted generic workspace, the GM creates one record per enrolled player, selects its role and token counts in the schema-driven form, and grants the corresponding player read/act access. Public command outcomes reveal only role and scene counters; the state-changing effect and durable event stay private to the owner and GM, so token inventory and choice history are not broadcast across the two records.

The module is trusted bundled JavaScript, explicitly allowlisted in the repository's static V2 catalog. Its declarations and digest do not make it safe to load as an untrusted plugin; adding a catalog row is a reviewed operator action, not general installation.
