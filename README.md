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

The current online slice supports module/actor registration, GM-only field filtering, revision-checked and deduplicated actions, host-generated verified rolls, context updates, and replayable SSE events. Actor validation covers the JSON Schema features used by these fixtures; it is not a full JSON Schema 2020-12 implementation. The offline operation queue, review proposals, stale dependency conflict workflow, and production authentication remain follow-on work, so the full foundation acceptance checklist is not complete.

## Workspace 0.2 experiment (local branch)

The browser client includes a customizable dashboard shell inspired by the two concept images in the repository. A local profile can arrange Character, Encounter Summary, and Activity Log bricks, manage dashboard groups, and save personal layouts in browser storage. The GM can select one of two stable fixture encounters; encounter followers update from the host stream, while pinned Character bricks keep their references. The full Characters view and compact brick use the same host command adapter.

Run `pnpm dev` and open the Vite URL. Use separate browser profiles for a GM and player layout demo, or change the **Local profile** preference to compare layouts in one browser. The profile name is not authentication. The role selector and static localhost bearer tokens are development fixtures only; do not expose this host publicly. If a saved layout is corrupt, the client recovers a safe layout and reports the issue.

Available checks: `pnpm build`, `node --test server/host/index.test.mjs`, and `node --test clients/web/src/workspace/workspace.test.mjs`. The Workspace 0.2 requirements remain a target: browser-level two-client automation, production identity, full app handoffs, offline edits, complex docking, and maps are not included in this experiment.

## Licensing

No project license has been chosen yet. Do not assume the repository is open-source licensed merely because it is public.
