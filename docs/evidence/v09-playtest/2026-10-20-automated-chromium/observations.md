# Role-separated automated observations

These are browser-visible and host-asserted observations from scripted Chromium contexts. They are not participant statements or usability interviews.

## GM context

- Campaign Home exposes both the existing installed-system setup and the experimental “Reviewed V2 module” flow. The fresh V2 setup was reachable without `/v2-modules` or seeded state.
- The selected Revised 5e lock and assigned roster were visible in Rules. The guided form supported two named player characters and an opponent, but not separate character records.
- The Table handoff retained the encounter ID and exact lock, displayed the 8 × 5 spatial grid, refreshed from host state, and returned to Rules with the same entity revision.
- Campaign Home still reported “System not configured”/“Your campaign is ready to prepare” and no active V2 session. The V2 Table route did not provide start, pause, resume, or finish controls.
- During the separate opportunity-reaction probe, GM Rules showed a pending reaction and an adjudicate-accept control. After acceptance, the UI said the adjudication was recorded, yet the host did not apply the attack. See #172.

## Player A context

- A separate browser context authenticated with its own enrolled credential and reached Rules/Table through ordinary navigation.
- The player session banner said “No live session” and “No current encounter is published. · No authorized character yet” while the same context could load the assigned Asha encounter through V2 Rules/Table. This made the V1 session banner and the V2 authorized encounter feel disconnected.
- The Rules view displayed the actor's authorized HP resource. It did not expose a normal Move form.
- After host restart, the app header showed “OFFLINE · cached” while the V2 Table reported “Authorized encounter state loaded from the host.” This is a confusing status combination; #112 already covers cached/offline/live-state clarity.
- The Rules and Table views retained the same entity and host revision. Asha could not be used by Player B's attack command. Player A's context also received the shared encounter's participant projection, so this does not establish private-field isolation for Borin.

## Player B context

- A separate browser context authenticated as Player B, loaded the assigned encounter and could perform its own permitted attack.
- An attempt to attack with Player A's actor was denied by the host with HTTP 403 and explanatory Rules feedback.
- Table loaded the authorized host projection and returned to Rules with the same entity selected. GM ownership principal values were absent from the player-facing projection.
- Player B's access remained intact after Player A's membership was revoked in the separate revocation check.

## Human observations

No human GM or players were involved. Exact participant wording, assistance, elapsed task times, expectations, hesitation and debrief responses remain **PENDING** for #110.
