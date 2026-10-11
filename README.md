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

## Contributing

Documentation and implementation are still being planned. Please discuss significant architectural decisions before implementing them.

## Foundation experiment (local implementation)

The initial localhost build now contains a shared contracts package, module registry, bounded rules evaluator, two fictional system fixtures, a browser client, and a SQLite host. It is an experimental development build; use only on localhost with the development bearer tokens. Node 22.5 or later and pnpm are required.

```sh
pnpm install
pnpm dev
```

The host listens on `http://127.0.0.1:4177`; Vite serves the browser client on its printed local URL. The host loads the example module manifests, schemas, views, and actions from `modules/`; on first GM connection, the client creates the demo actors. Use the role selector to compare the GM and player projections. Set `VITE_POTOMAC_HOST` in the web environment to point the client at another local host URL. `POTOMAC_DB`, `PORT`, `POTOMAC_GM_TOKEN`, and `POTOMAC_PLAYER_TOKEN` configure the host.

The current online slice supports module/actor registration, GM-only field filtering, revision-checked and deduplicated actions, host-generated verified rolls, context updates, and replayable SSE events. Actor validation covers the JSON Schema features used by these fixtures; it is not a full JSON Schema 2020-12 implementation. The offline operation queue, review proposals, stale dependency conflict workflow, and production authentication remain follow-on work, so the full foundation acceptance checklist is not complete.

## Licensing

No project license has been chosen yet. Do not assume the repository is open-source licensed merely because it is public.
