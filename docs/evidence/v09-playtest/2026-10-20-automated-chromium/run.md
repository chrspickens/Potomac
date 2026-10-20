# Potomac playability assessment — 2026-10-20

## Provenance

- Classification: **automated Chromium only**. No human participants or facilitator usability session were conducted.
- Repository: `chrspickens/Potomac`; `main` at merge commit `18b621f2607254585bf64aedb411e7b1f49a81b2` (PR #171).
- PR #171 source head: `0109e800216e9dfc059dd88a12d5533156d77771`; merged 2026-10-20 05:47:36 UTC.
- Post-merge GitHub Actions: workflow `Checks`, run `39376290596`, head `0109e800216e9dfc059dd88a12d5533156d77771`, completed successfully. Job `check` succeeded at 05:46:05 UTC. No other post-merge check run was reported by the PR.
- Local checkout: clean isolated worktree based on fetched `origin/main`; Windows 11 Home `10.0.26200`, Node `v24.13.1`, pnpm `11.25.0`, Chrome `155.0.8059.85` headless.
- Browser viewport for screenshots: 1280 × 800 CSS pixels, scale 1. Browser contexts were isolated per GM, Player A, and Player B. Hosts listened on random loopback ports only.
- Disposable SQLite databases and Chromium profile data were created in a temporary directory and removed by the runner at exit. No production or user campaign data was used.

## Reproduction

From repository root, on the revision above:

```powershell
$env:POTOMAC_EVIDENCE_DIR='docs/evidence/v09-playtest/2026-10-20-automated-chromium'
pnpm acceptance:v2-rules-workspace-browser
```

The command exited 0 on the recorded final run. It executes separate fresh V2 hosts for Revised 5e and Dice-pool and three isolated browser contexts for Revised 5e. The runner drives browser controls through Chromium DevTools Protocol and uses host API assertions for enrollment identity, exact retries, altered retries, stale revisions, revocation, and persistence. This is scripted browser automation; it is not mouse, keyboard-only, assistive-technology, physical-device, or human observation.

Exact locks, including full module capability closure and digests, are in [`revised5e-lock.json`](revised5e-lock.json) and [`dicepool-lock.json`](dicepool-lock.json). Sanitized screenshots are listed below. The runner does not save raw network traces, credentials, database files, or browser profiles.

## Results summary

- Revised 5e: ordinary Campaign Home setup and exact host-pinned lock passed; two players enrolled separately; guided preparation assigned Asha and Borin; initiative and permitted attacks committed; HP resource displays were present; cross-player attack was denied; GM and player Table routes showed the same encounter entity and authoritative revision; Table refresh and Rules return worked; exact retry replayed once; altered payload and stale revision conflicted; host restart, credential reconnection, and receipt persistence passed.
- The guided form creates one shared encounter containing both characters and the opponent. It does not create independent character entities or separate private character records.
- Table rendered the declared 8 × 5 grid and participant positions. It is a read-only spatial projection, not the Maps app, an editable battle map, or a live session surface.
- A separate Dice-pool host passed the small contrast: exact lock, guided scene, non-grid roster, permitted skill action, GM-only note filtering, authorized Player B brace reaction, unauthorized Player A rejection, retry integrity, and restart persistence.
- A separate direct-command probe exposed the Revised 5e opportunity-attack issue filed as [#172](https://github.com/chrspickens/Potomac/issues/172). The module declares movement and a durable opportunity attack, but no normal Rules “Move” form is rendered. A host-accepted move opened a reaction; the GM UI reported **GM reaction adjudication recorded by the host** after accept, but the continuation resumed movement without applying the accepted attack. The player's HP remained 12, the opponent reaction resource remained available, and no opportunity-attack log entry appeared. The direct command was used only to reach this otherwise inaccessible flow; it does not count as a normal player workflow pass.
- Explicit direct-grant removal left an assigned participant's access intact; the assignment is an independent authorization path. Revoking Player A's membership blocked that profile's reads while Player B remained authorized.
- Revised 5e Rules-to-Table consistency was checked after restart: stable entity ID, host projection, exact pinned module, and the same entity revision appeared in Rules and Table.

## Screenshots

Screenshots are from the actual app rendered in headless Chromium and redact UUIDs and module digests. Fictional scenario names remain visible.

- [GM Campaign Home setup with Revised 5e selected](gm-campaign-home.png)
- [Player A Revised 5e Rules view](player-a-rules.png)
- [GM Table grid](gm-table-grid.png)
- [Player A Table grid](player-a-table-grid.png)
- [Dice-pool non-grid Table roster](dicepool-table-roster.png)

## Boundaries

Human GM + Player A + Player B playthrough and debrief: **PENDING**. Human Dice-pool smoke: **PENDING**. Keyboard-only completion, screen-reader review, real Wi-Fi/network interruption, and physical phone/tablet testing: **PENDING** under #88/#114. The automation does not prove usability or public/remote hosting.
