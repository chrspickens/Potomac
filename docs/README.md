# Potomac design documentation

Status: **proposed, v0.1 — 2026-10-10**. These documents capture a working product direction, not finished implementation or frozen specifications.

| Document | Purpose |
| --- | --- |
| [Vision and scope](vision.md) | Product goals, vocabulary, principles, non-goals |
| [Initial requirements](requirements.md) | Testable functional and nonfunctional requirements |
| [Architecture](architecture.md) | Clients, host, persistence, permissions, sync boundaries |
| [Module and rules specification](module-spec.md) | Manifest, schema, UI contributions, constrained rules IR |
| [Foundation experiment](foundation-experiment.md) | Minimal vertical slice, milestones, acceptance criteria |
| [Decisions and questions](decisions.md) | Proposals, assumptions, unresolved tradeoffs |

## How to use these docs

1. Review [decisions.md](decisions.md) for unresolved decisions before committing to implementation.
2. Implement the deliberately small [foundation experiment](foundation-experiment.md), not the full suite.
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
