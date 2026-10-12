# Potomac

Potomac is an early-stage concept for a local-first, self-hostable, modular tabletop roleplaying game (TTRPG) workspace.

The long-term vision is a suite of connected applications—such as Characters, Lore, Encounters, and Table—with customizable dashboards assembled from reusable **bricks**.

> **Project status:** early foundation implementation in progress. The only systems currently included are fictional development examples; this is not a released or production-ready product.

The initial design documentation will be developed in `docs/`. Architectural choices are proposals until validated by experiments.

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

The current host and browser include the local 0.3 offline path: GM-enrolled member credentials, actor-scoped projections, authorized IndexedDB snapshots, durable queued operations, host revalidation and receipts, and GM review proposals. This remains an experimental localhost workflow; actor validation is limited to the JSON Schema features used by these fixtures, and authentication is not suitable for public hosting. A focused 0.3 end-to-end runner checks reconnect, idempotency, review, and stale dependency behavior.

For the local-host demo, the GM enrolls a player from **GM administration** and shares the displayed credential privately. The player enters it with **Use player credential**; it is remembered in that browser profile so permitted cached data can reopen offline. **Forget this device** clears that remembered credential and its scoped cache, queue, and drafts. Anyone with access to the browser profile can access the credential and already downloaded data; revoking or rotating a member credential stops future host access but cannot erase copies already downloaded. The host stays loopback-only. The development `local-gm` and `local-player` tokens are fixtures, not a production login model.

## Workspace 0.2 experiment

The browser client includes a customizable dashboard shell inspired by the two concept images in the repository. A local profile can arrange Character, Encounter Summary, and Activity Log bricks, manage dashboard groups, and save personal layouts in browser storage. The GM can select one of two stable fixture encounters; encounter followers update from the host stream, while pinned Character bricks keep their references. The full Characters view and compact brick use the same host command adapter.

Run `pnpm dev` and open the Vite URL. Use separate browser profiles for a GM and player layout demo, or change the **Local profile** preference to compare layouts in one browser. The profile name is not authentication. The role selector and static localhost bearer tokens are development fixtures only; do not expose this host publicly. If a saved layout is corrupt, the client recovers a safe layout and reports the issue.

To arrange a dashboard, choose **Edit layout**. On desktop, drag a brick by its header grip and resize it from the lower-right corner. It follows the pointer smoothly; a target shows where it will land, and it snaps to the twelve-column tiled grid on release. Displaced neighbors then move down instead of overlapping. Press Escape during a gesture to cancel it. The labeled move/resize buttons provide a keyboard-accessible alternative, and completed edits are saved in the current local profile. This is the tiled part of Tableau-style layout editing, not floating layers or nested containers.

Run `pnpm check` for the build, rules/host/workspace tests, isolated host diagnostics, and browser acceptances. `pnpm acceptance:workspace` remains the separate 0.2 GM/player dashboard scenario. `pnpm acceptance:offline` runs the focused 0.3 offline scenario with one GM and two enrolled members. `pnpm acceptance:offline-storage` checks browser-process restart, scoped IndexedDB isolation, cancellation, and corrupt-record preservation. These require installed Chrome or Edge (`POTOMAC_CHROME` may select its executable) and use temporary loopback-only data and browser profiles. `pnpm debug:doctor` and `pnpm debug:watch` inspect a running local host; see [Agent and developer diagnostics](docs/agent-debugging.md). The optional `node scripts/workspace-pointer-smoke.mjs` exercises detailed gestures against a separately running `pnpm dev` client and isolated Chrome debugging port 9229. Production identity, full app handoffs, complex docking, and maps are not included in this experiment.

## Licensing

No project license has been chosen yet. Do not assume the repository is open-source licensed merely because it is public.
