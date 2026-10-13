# Flooded Observatory acceptance run — 2026-10-13

Baseline: `989fc27` (latest `main` at run time). No production campaign data was touched. All attempted host data used temporary SQLite files and the image fixture already checked into the repository.

## Executed evidence

- Existing `pnpm acceptance:maps`: PASS for disposable host Maps HTTP/projection/idempotency/v5 backup coverage.
- Existing `pnpm acceptance:campaign`: PASS for disposable host, real Chromium CDP browser contexts, workspace/encounter journeys and two independently enrolled players.
- Existing `pnpm acceptance:offline`, `pnpm acceptance:offline-storage`: PASS for browser UI queue/reconnect and member-scoped cache behavior.
- A new disposable three-context Maps browser harness was prototyped and executed against the actual React UI. It reached the GM Maps page and rendered the World/Battle creation form in Chromium, but failed before the first scene was committed because the CDP/native controlled-input driver did not produce a reliable form submission. The run therefore is not a product PASS and produced no committed disposable map data.
- The visible browser smoke from the preceding validation remains the only human-observable Maps evidence: GM creation controls were present; Player A and Player B showed no editor controls after switching to Player role. It did not complete Flooded Observatory.

## #79 matrix

| Criterion | Result | Evidence |
|---|---|---|
| Three-context GM + Player A + Player B Maps journey | NOT VERIFIED | Existing campaign runner proves three contexts generally; Maps-specific runner stopped at first UI create submission. |
| World and Battle creation through UI | NOT VERIFIED | GM form rendered, but the disposable runner did not commit the first scene. HTTP Maps acceptance passes creation. |
| Image upload and exact image bytes | NOT VERIFIED | v5 HTTP/backup tests pass image bytes; no completed UI upload journey. |
| Grid defaults/overrides and numeric piece positioning | NOT VERIFIED | Client/host unit tests cover geometry and persistence; no completed browser journey. |
| Tokens, private pin, publication/revocation | NOT VERIFIED | HTTP acceptance passes projections and revocation; no complete Maps UI run. |
| Map-to-map navigation and encounter invariance | NOT VERIFIED | HTTP link coverage and workspace binding tests pass; no completed UI handoff. |
| Pinned/following Workspace bindings | PASS (automated) | Workspace registry/adapter tests and campaign browser acceptance pass; Maps-specific visual binding remains NOT VERIFIED. |
| HTTP/SSE/replay/direct-ID/privacy | PASS (automated) | Maps acceptance and host security tests pass; no separate packet capture artifact. |
| Offline maps/images/reconnect/revocation | PASS (automated) | Offline acceptance/storage tests pass; Maps-specific image UI remains NOT VERIFIED. |
| Host restart persistence | PASS (automated) | Host and backup tests pass for map records, pieces, links and associations. |
| v5 backup/restore | PASS (automated) | Maps backup tests pass exact map/image/record round-trip and tamper rejection. |
| Both fictional systems | PASS (automated foundation) | System A and System B acceptance suites pass; Maps UI repeat was not completed. |
| Keyboard/focus/narrow layout | NOT VERIFIED | Runner configured a narrow 390px player viewport but failed before journey; human touch/visual signoff is outstanding. |

## Failure details

The browser harness failure was in the test driver: Chromium rendered the form, but the controlled React form did not produce a committed create operation through the attempted CDP input path. Cleanup also raced SQLite WAL handles on Windows. This is test infrastructure work, not evidence of a host authorization or Maps product defect. No application fix was made and no security assertion was weakened.

Human visual acceptance, physical touch-device behavior, complete image-upload UI flow, full cross-map/Lore/encounter handoff, and a single end-to-end Flooded Observatory trace remain outstanding.
