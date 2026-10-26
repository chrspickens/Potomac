# Potomac

Potomac is an experimental, localhost-only, modular tabletop roleplaying game (TTRPG) workspace.

The long-term vision is a suite of connected applications—such as Characters, Lore, Maps, Encounters, and Table—with customizable dashboards assembled from reusable **bricks**.

> **Project status:** the v0.7 Maps slice is implemented and covered by automated browser acceptance, but Potomac remains a development prototype, not a production-ready or publicly hosted service. The included game systems are fictional test fixtures.

Historical design documents retain their original requirements and decisions; see the implementation status and verification notes in [Workspace 0.7 requirements](docs/workspace-0.7-requirements.md) and [Maps manual QA](docs/maps-manual-qa.md).

## Guiding principles

- Local ownership of campaign data; no required Potomac-operated cloud service.
- A host-authoritative multiplayer model with offline-capable player clients.
- GM-governed permissions and player-customizable dashboard layouts.
- Game-system-neutral apps powered by modular schemas, interfaces, and rules.
- Versioned offline edits, explicit review policies, and an auditable activity history.

## Contributing and coding standards

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Engineering Standards](docs/engineering-standards.md) before implementing changes. Coding agents should also follow [AGENTS.md](AGENTS.md). Use focused pull requests and capture cross-package decisions in [ADRs](docs/adr/README.md). The standards are proposed for adoption and do not imply the foundation experiment has shipped.

## Foundation experiment (local implementation)

The initial localhost build now contains a shared contracts package, module registry, bounded rules evaluator, two fictional system fixtures, a browser client, and a SQLite host. It is an experimental development build; use only on localhost with the development bearer tokens. Node 22.5 or later and pnpm are required.

```sh
pnpm install
pnpm dev
```

The host listens on `http://127.0.0.1:4177`; Vite serves the browser client on its printed local URL. The host loads the example module manifests, schemas, views, and actions from `modules/`; on first GM connection, the client creates the demo actors. Use the role selector to compare the GM and player projections. Set `VITE_POTOMAC_HOST` in the web environment to point the client at another local host URL. `POTOMAC_DB`, `PORT`, `POTOMAC_GM_TOKEN`, and `POTOMAC_PLAYER_TOKEN` configure the host.

### Local launch helpers

The launch helpers require Node.js 22.12 or later and pnpm 11.25.0, matching the current Vite 8 and host requirements and this repository's pinned package manager.

- **Windows:** double-click `start-potomac.bat` for the local host and web app, or `start-playtest.bat` for a fresh V2 Revised 5e playtest. Their console shows the URLs and service output; close it with Ctrl+C. Double-click `stop-potomac.bat` in another window to stop tracked services.
- **PowerShell:** from the repository folder, run `./start-potomac.bat`, `./start-playtest.bat`, or `./stop-potomac.bat`.
- **Linux/macOS:** run `./start-potomac.sh`, `./start-playtest.sh`, or `./stop-potomac.sh`. If needed, make the scripts executable with `chmod +x start-potomac.sh start-playtest.sh stop-potomac.sh reset-playtest.sh`.

The regular launcher uses `.potomac-local/data/local-host.sqlite`. Each playtest gets a unique database and browser profile under `.potomac-local/playtests/`; it opens Campaign Home (`/`) in the fresh profile when Chrome or Edge is available. Follow [the Revised 5e human playtest runbook](docs/revised5e-human-playtest-runbook.md) to create the campaign and enroll players through the normal UI. Playtest data is preserved by default. The launcher enables the experimental V2 host API and binds both services to `127.0.0.1`. It uses ports 4177 and 5173 by default, and automatically selects an available port if either preferred port is occupied; the chosen URLs are printed at startup. It tracks only sessions started by these helpers. If a session is already running, use `stop-potomac` before starting another.

To explicitly reset one playtest, copy its ID from the startup output and run `node scripts/local-launch.mjs reset-playtest <playtest-id>` (Windows: `reset-playtest.bat <playtest-id>`; Linux/macOS: `./reset-playtest.sh <playtest-id>`). The reset accepts one generated ID, refuses active sessions and paths outside the playtest folder, and removes only that ID's database, SQLite sidecars, host assets, and browser profile.

**Troubleshooting:** If Vite's package folder exists but its command shim is missing, startup tries a normal filtered install, then one forced offline relink from the local package store if the install reports success without restoring the shim. It does not delete dependency folders. You can set `POTOMAC_LOCAL_HOST_PORT` / `POTOMAC_LOCAL_WEB_PORT` to preferred ports; if one is unavailable, startup picks an available local port and prints it. If no browser opens for playtest, open the printed URL manually; the fresh profile location is printed for use with a browser's profile option. If Windows closes the window after a startup error, rerun from PowerShell to keep the error visible.

The current host and browser include the local 0.3 offline path: GM-enrolled member credentials, actor-scoped projections, authorized IndexedDB snapshots, durable queued operations, host revalidation and receipts, and GM review proposals. This remains an experimental localhost workflow; actor validation is limited to the JSON Schema features used by these fixtures, and authentication is not suitable for public hosting. A focused 0.3 end-to-end runner checks reconnect, idempotency, review, and stale dependency behavior.

An unsent queued edit can be canceled locally; once a submission attempt starts, its ID and intent remain for safe retry instead of being misrepresented as canceled. Rejected or conflicted edits can be retained as editable private drafts. Reconciliation never promotes those drafts to committed state without a new explicit operation and host validation. A dependency rebase requires the player to review currently authorized revisions and creates a new operation ID.

For the local-host demo, the GM enrolls a player from **GM administration** and shares the displayed credential privately. The player enters it with **Use player credential**; it is remembered in that browser profile so permitted cached data can reopen offline. **Forget this device** clears that remembered credential and its scoped cache, queue, and drafts. Anyone with access to the browser profile can access the credential and already downloaded data; revoking or rotating a member credential stops future host access but cannot erase copies already downloaded. The host stays loopback-only. The development `local-gm` and `local-player` tokens are fixtures, not a production login model.

## 0.4–0.6 local campaign workflow

The current implementation includes a GM campaign setup form with an exact system-version pin, schema-driven character creation and GM field editing, persistent encounter preparation and participant editing, cross-app dashboard bindings, a Lore app and bricks, host-managed image attachments, and portable campaign backup/restore. The host remains one campaign per local database and only listens on loopback. Lore manual checks and tested backup layouts are listed in [Lore manual QA](docs/lore-manual-qa.md).

### Maps and v0.7 campaign backups

The Maps app supports host-owned World and Battle Maps, scene grids, location pins and actor tokens, Map-to-Map and authorized Map-to-Lore navigation, encounter associations, deliberate publication/revocation, and Workspace pinned/following Map Scene bricks. Host authorization filters map records and images before HTTP/SSE delivery. Players can read authorized maps offline from member-scoped cached snapshots and image blobs; offline copies are stale/read-only until reconnect. Revoking access blocks future host requests, but cannot remotely erase content already downloaded to a device.

Campaign backup and restore are available through `node server/host/backup-cli.mjs`. New exports use portable v5 and include Maps, Lore, links, managed asset bytes, Table sessions, campaign data and audit/operation records. Restore validates archive integrity and refuses populated destinations. The importer also supports the documented v2, both fixture-pinned v3 layouts, and v4 formats. Backups contain sensitive campaign records and credential hashes; protect them appropriately. Browser-local layouts, caches and private drafts are not included. See [host backup guidance](server/host/README.md).

Run `pnpm acceptance:maps-browser` for the disposable three-context Chromium Maps acceptance; `pnpm check` includes it. See the [v0.7 QA record](docs/maps-manual-qa.md) for automated evidence and human/device verification gaps.

The v0.8 release acceptance matrix composes the existing disposable GM, Player A and Player B campaign, offline, Lore, Maps, Table and backup journeys without duplicating them. See [v0.8 release acceptance](docs/release-acceptance-0.8.md) for the release gates, evidence mapping and explicit physical-device/screen-reader limitations.

This deployment remains localhost-only and uses development bearer tokens, not production identity. Do not expose it to the internet. Maps do not implement fog-of-war, hidden regions within a shared image, or combat automation. Previously downloaded offline content cannot be remotely erased.

Run `pnpm acceptance:lore` for isolated GM/two-player Lore UI and HTTP privacy coverage, `pnpm acceptance:campaign` for the campaign browser workflow, or `pnpm check` for the full suite. The local-host prototype is **not ready for internet exposure**. Development bearer credentials are not production identity; revocation prevents future host access but cannot erase already downloaded copies.

## Workspace 0.2 experiment

The browser client includes a customizable dashboard shell inspired by the two concept images in the repository. A local profile can arrange Character, Encounter Summary, and Activity Log bricks, manage dashboard groups, and save personal layouts in browser storage. The GM can select one of two stable fixture encounters; encounter followers update from the host stream, while pinned Character bricks keep their references. The full Characters view and compact brick use the same host command adapter.

Run `pnpm dev` and open the Vite URL. Use separate browser profiles for a GM and player layout demo, or change the **Local profile** preference to compare layouts in one browser. The profile name is not authentication. The role selector and static localhost bearer tokens are development fixtures only; do not expose this host publicly. If a saved layout is corrupt, the client recovers a safe layout and reports the issue.

To arrange a dashboard, choose **Edit layout**. On desktop, drag a brick by its header grip and resize it from the lower-right corner. It follows the pointer smoothly; a target shows where it will land, and it snaps to the twelve-column tiled grid on release. Displaced neighbors then move down instead of overlapping. Press Escape during a gesture to cancel it. The labeled move/resize buttons provide a keyboard-accessible alternative, and completed edits are saved in the current local profile. This is the tiled part of Tableau-style layout editing, not floating layers or nested containers.

Run `pnpm check` for the build, rules/host/workspace tests, isolated host diagnostics, and browser acceptances. `pnpm acceptance:workspace` remains the separate 0.2 GM/player dashboard scenario. `pnpm acceptance:offline` runs the focused 0.3 offline scenario with one GM and two enrolled members. `pnpm acceptance:offline-storage` checks browser-process restart, scoped IndexedDB isolation, cancellation, and corrupt-record preservation. Browser acceptance scripts require installed Chrome or Edge (`POTOMAC_CHROME` may select its executable) and use temporary loopback-only data and browser profiles. `pnpm debug:doctor` and `pnpm debug:watch` inspect a running local host; see [Agent and developer diagnostics](docs/agent-debugging.md). Physical touch-device behavior and real network interruption require separate human/device QA; automated pointer events do not establish either.

## Licensing

No project license has been chosen yet. Do not assume the repository is open-source licensed merely because it is public.
