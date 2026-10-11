# Potomac

Potomac is an early-stage concept for a local-first, self-hostable, modular tabletop roleplaying game (TTRPG) workspace.

The long-term vision is a suite of connected applications—such as Characters, Lore, Encounters, and Table—with customizable dashboards assembled from reusable **bricks**.

> **Project status:** discovery and foundational architecture. No implementation or supported game systems yet.

The initial design documentation will be developed in `docs/`. Architectural choices are proposals until validated by experiments.

## Guiding principles

- Local ownership of campaign data; no required Potomac-operated cloud service.
- A host-authoritative multiplayer model with offline-capable player clients.
- GM-governed permissions and player-customizable dashboard layouts.
- Game-system-neutral apps powered by modular schemas, interfaces, and rules.
- Versioned offline edits, explicit review policies, and an auditable activity history.

## Contributing and coding standards

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Engineering Standards](docs/engineering-standards.md) before implementing changes. Coding agents should also follow [AGENTS.md](AGENTS.md). Use focused pull requests and capture cross-package decisions in [ADRs](docs/adr/README.md). The standards are proposed for adoption and do not imply the foundation experiment has shipped.

## Licensing

No project license has been chosen yet. Do not assume the repository is open-source licensed merely because it is public.
