# Automated walkthrough matrix

Statuses below describe only assertions exercised by `pnpm acceptance:v2-rules-workspace-browser` or the separately described reaction probe. Role labels identify the browser context, not human participants.

| Step | GM | Player A | Player B | Result and evidence |
|---|---|---|---|---|
| Fresh host and Campaign Home setup | PASS | — | — | Revised 5e selected from the reviewed V2 catalog; ordinary Campaign Home route; fresh disposable loopback host. Screenshot: `gm-campaign-home.png`. |
| Exact capability lock | PASS | PASS | PASS | Host pinned Revised 5e 1.2.0 and full 12-entry capability closure. The lock remained identical after restart. See `revised5e-lock.json`. |
| Enrollment and independent sign-in | PASS | PASS | PASS | GM enrolled A and B separately; browser contexts authenticated with their own issued credentials. Credentials were not written to evidence. |
| Guided character and encounter preparation | PASS | — | — | Guided form populated Asha, Borin, Warden and the participant assignments in one Revised 5e encounter. Limitation: characters are embedded in the shared encounter; separate character entities were not created. |
| Initiative and permitted attacks | PASS | PASS | PASS | GM started initiative; A and B attacks committed. B's attack using A's actor was denied with HTTP 403; B's own attack committed. |
| Resources and authoritative projection | PASS | PASS | PASS | Per-actor HP progress/resource UI rendered. Host state remained authoritative across refresh and restart. |
| Revised 5e movement and opportunity reaction | BLOCKED in normal UI | FAIL by direct-command probe | — | No Rules Move form is exposed. Direct host command opened the durable window; GM accepted in UI, but host continued movement with no opportunity attack, no HP change, and reaction still available. P0 issue #172. |
| Table presentation | PASS | PASS | PASS | Table loaded the same stable encounter and exact lock. Revised 5e declared grid rendered as 8 × 5; Table and Rules showed the same authoritative revision after restart. Screenshots: `gm-table-grid.png`, `player-a-table-grid.png`. |
| Battle map and active session | BLOCKED | BLOCKED | BLOCKED | No V2 start/pause/end session controls or V2 Maps handoff appeared. Campaign Home and Player Session continued to say no live session/current published encounter. Table is only the module-declared grid projection. Tracked by #110/#111; legacy Table tracker #34 remains open. |
| Rules/Table return | PASS | PASS | PASS | “Open in Rules” retained the exact selected entity and revision. Player A reloaded and reopened Table through navigation. |
| Host restart and reconnect | PASS | PASS | PASS | Host SQLite process restarted; all profiles refreshed, Player A reloaded, exact lock and receipt survived. This is local process restart evidence only. |
| Stale, exact retry, altered retry, duplicate prevention | PASS | PASS | PASS | Exact retry replayed prior receipt; changed payload with same operation ID and stale revision returned conflict; changed preparation retry created no duplicate. |
| Grant/member revocation | PASS | PASS | PASS | Removing direct grant preserved A's explicit participant authorization. Revoking A's membership blocked A's read; B's independent read remained available. |
| Cross-player privacy | PARTIAL | PARTIAL | PARTIAL | B could not act as A; GM principal IDs were filtered from player projection. Separate private character-field isolation remains unverified because the module has no separate character entity/private field in this flow; both actors share one granted encounter projection. See #110/#112. |
| Human usability and debrief | PENDING | PENDING | PENDING | No humans participated. Do not infer comprehension, hesitation, assistance, task time, or satisfaction from automation. |
| Physical device, real network, keyboard-only, screen reader | PENDING | PENDING | PENDING | Not performed. Track through #88/#113/#114. |
| Dice-pool contrast host | PASS | PASS | PASS | Fresh separate host; exact Dice-pool 1.1.0 lock; skill challenge and durable Brace response; A denied response, B permitted response; non-grid roster and restart. Screenshot: `dicepool-table-roster.png`; lock: `dicepool-lock.json`. |
