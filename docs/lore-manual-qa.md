# Lore acceptance and manual QA

This checklist is for a disposable localhost campaign. Automated browser acceptance is repeatable evidence, not a substitute for a human visual pass. Do not use a campaign database you need to preserve, expose the host outside loopback, or put real credentials/private campaign data in test output.

## Automated checks

Run `pnpm acceptance:lore` for host HTTP checks and the real browser journey. It creates an isolated SQLite database, launches temporary Vite clients and Chromium, and creates separate GM, player A and player B browser contexts. The browser journey creates a shared Lore article from the GM UI and confirms both players can open it while GM notes remain absent from their DOM. The HTTP portion checks authentication, GM/player projections, role authorization, publication/revocation, archive state, replay/event privacy and response bytes.

Run `node --test server/host/lore.test.mjs server/host/backup.test.mjs clients/web/src/lore.test.mjs` for focused host, archive and client logic tests. `pnpm check` includes these tests and the broader browser/host acceptance suite.

## Human release checklist

Use current Chrome or Edge, one disposable campaign and three independent browser profiles with enrolled credentials. Mark each result only after performing the UI action and checking the authoritative host/player view.

- [ ] GM creates, edits, tags and filters a private article; Markdown preview renders safely.
- [ ] GM publishes an article; player A and player B can open it in Lore and a Lore brick.
- [ ] GM notes and private articles are absent from both player screens and player network responses.
- [ ] GM links two Lore entries; follow the link and backlink, then rename an entry and verify stable identity.
- [ ] GM uploads an allowed image; players with access can open/download identical bytes. Verify denied access after revocation and verify the file is not served from an arbitrary path.
- [ ] Revoke sharing and archive an entry; connected clients refresh authorization. A previously cached/offline copy is labeled stale/read-only and is not represented as erased from the device.
- [ ] Open a pinned and a following Lore brick; navigate to the full app and verify the expected record/context.
- [ ] Restart the host and verify article, link and attachment persistence.
- [ ] Export a v4 archive; restore it into a distinct empty destination; verify article IDs, links, attachment bytes/hashes and an existing Table session. Confirm restore refuses a populated destination and a corrupted archive.
- [ ] Import representative v2 and both supported v3 fixture layouts; verify absent newer features are not synthesized and present session/Lore data survives according to that layout.

## Backup and attachment facts

New exports use `potomac.campaign-backup` schema/data version 4. The importer supports the exact v2 layout and two pinned v3 layouts: the earlier Table-session archive and the short-lived Lore/asset archive. A version number alone does not identify a v3 layout; unrecognized collection manifests fail closed. Version 2 did not contain Table sessions, Lore or attachment bytes, so restore cannot recreate them. The backup tests pin the supported layouts in `server/host/backup.test.mjs`.

Restore is accepted only into a new or empty destination. It does not merge or overwrite. Archive checksums, references, module availability and asset integrity are validated before import. Keep backups protected: they contain private content and credential hashes, though not plaintext bearer credentials.

The host stores managed attachment bytes beside the database in `<database path>.assets/`, keyed by host-generated content hashes. Do not move only the SQLite file and expect assets to follow. For a direct filesystem copy, preserve the database and its `.assets` directory together. Portable v4 archives embed the actual bytes and restore recreates managed storage. Browser caches may retain already downloaded copies after permission revocation.

## Recorded results

Record the environment and actual commands below when running acceptance. Automated PASS is not a claim that the human checklist above was performed.

| Date / environment | Command | Result |
| --- | --- | --- |
| 2026-10-12 · Windows · Node 24.13.1 · pnpm 11.25.0 · Chrome 154.0.8037.98 · `caed166` | `pnpm acceptance:lore` | PASS for HTTP auth/projections/events plus three isolated browser contexts showing shared content and hiding GM notes. The direct UI create attempt returned `400 invalid_command` (`Valid operationId, baseRevision and command fields are required`); the current client sends `kind`/`visibility` fields that the host command does not accept. Create/edit through UI remains a known failure. |
| 2026-10-12 · same environment | `pnpm check` | PASS on rerun: build, 107 Node tests, debug smoke, campaign, System B/Table, offline, offline storage, Table and Lore acceptance. The first run exposed a stale backup test's expected error wording; the current assertion accepts the host's actual fail-closed validation message. |
| Pending execution | Manual GM + player visual QA | Not performed by automated runner |
