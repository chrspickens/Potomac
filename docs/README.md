# Potomac design documentation

Status: **proposed, v0.1 — 2026-10-10**. These documents capture a working product direction, not finished implementation or frozen specifications.

Implementation note (2026-10-11): the Workspace 0.2 localhost experiment uses SSE for live notifications and `localStorage` for personal layouts. Architecture references to WebSockets, IndexedDB offline edits, Electron, and production identity describe targets, not implemented behavior.

| Document | Purpose |
| --- | --- |
| [Vision and scope](vision.md) | Product goals, vocabulary, principles, non-goals |
| [Initial requirements](requirements.md) | Testable functional and nonfunctional requirements |
| [Architecture](architecture.md) | Clients, host, persistence, permissions, sync boundaries |
| [Module and rules specification](module-spec.md) | Manifest, schema, UI contributions, constrained rules IR |
| [Foundation experiment](foundation-experiment.md) | Minimal vertical slice, milestones, acceptance criteria |
| [Workspace 0.2 requirements](workspace-0.2-requirements.md) | Brick registry, personal dashboards, context bindings and acceptance tests |
| [Workspace 0.4 requirements](workspace-0.4-requirements.md) | First playable single-campaign workflow, contracts, authorization, migrations and backup/restore ([tracker #26](https://github.com/chrspickens/Potomac/issues/26)) |
| [Workspace 0.5 requirements](workspace-0.5-requirements.md) | Live Table session lifecycle, module-neutral action/roll contracts, role-filtered projections, recovery and browser acceptance ([issue #35](https://github.com/chrspickens/Potomac/issues/35)) |
| [Workspace 0.6 requirements](workspace-0.6-requirements.md) | Generic Lore articles, host-filtered sharing, stable links, managed assets, read-only offline access and portable backup ([issue #47](https://github.com/chrspickens/Potomac/issues/47)) |
| [Workspace 0.7 requirements](workspace-0.7-requirements.md) | Shared World/Battle map scenes, pieces, links, encounter associations, permissions, managed raster images and archive v5 ([issue #70](https://github.com/chrspickens/Potomac/issues/70)) |
| [Lore manual QA](lore-manual-qa.md) | GM/two-player release checklist, backup compatibility, attachment handling and recorded automated results |
| [Engineering standards](engineering-standards.md) | Code organization, module contracts, security, UX, and testing expectations |
| [Agent and developer diagnostics](agent-debugging.md) | Localhost-only debug commands and isolated smoke checks |
| [Architectural decision records](adr/README.md) | Template and decision-record conventions |
| [Decisions and questions](decisions.md) | Proposals, assumptions, unresolved tradeoffs |

## How to use these docs

1. Review [decisions.md](decisions.md) for unresolved decisions and accepted ADRs before committing to implementation.
2. Implement only the active milestone's requirements: see [Workspace 0.4](workspace-0.4-requirements.md) and its [implementation tracker](https://github.com/chrspickens/Potomac/issues/25), [Workspace 0.5](workspace-0.5-requirements.md) and its [milestone tracker](https://github.com/chrspickens/Potomac/issues/34), [Workspace 0.6](workspace-0.6-requirements.md) and its [tracker](https://github.com/chrspickens/Potomac/issues/46), then [Workspace 0.7](workspace-0.7-requirements.md) and its [specification issue](https://github.com/chrspickens/Potomac/issues/70).
3. Update requirements and architecture as experiments disprove assumptions.
4. Keep example formats explicitly provisional until validated in executable tests.

## Terminology

- **Workspace:** the common environment for applications, dashboards, identities and projects.
- **Application:** a full-featured workflow (e.g., Characters, Encounters).
- **Brick:** a focused, embeddable interface contributed by an app or the platform.
- **Dashboard / Group:** a user-owned layout of bricks / switchable collection of dashboards.
- **Context:** a scoped reference such as `session.activeEncounter`, not a permission grant.
- **System module:** a ruleset-specific collection of data schemas, views and mechanics.
- **Host:** the authoritative process for an individual campaign, run locally or headlessly.
