# Architectural decision records (ADRs)

Use a short ADR when a choice significantly affects cross-package contracts, hosting, data durability, permissions, modules, rules or offline synchronization.

Create `0001-short-title.md` and increment numerically. Suggested structure:

```markdown
# ADR-0001: Decision title

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context
Why does this decision matter?

## Options considered
List realistic alternatives and trade-offs.

## Decision
What was chosen and why?

## Consequences
What becomes easier/harder? Security, migration, compatibility?

## Follow-up / validation
What experiment or test would confirm this choice?
```

Do not retroactively treat current proposals in `docs/decisions.md` as accepted ADRs. Link accepted ADRs from the decision register.

The [Workspace 0.4 requirements](../workspace-0.4-requirements.md) and ADRs 0004–0008 define the proposed first playable campaign contracts. Their acceptance is for the requirements baseline; implementation and verification are tracked separately in [issue #26 and its dependent issues](https://github.com/chrspickens/Potomac/issues/26).

The [Workspace 0.5 requirements](../workspace-0.5-requirements.md), [ADR-0009](0009-generic-session-state-and-commands.md) and [ADR-0010](0010-durable-table-session.md) define the proposed live Table session contracts. Acceptance is for the requirements baseline; implementation and verification are tracked separately in [issue #34 and its child issues](https://github.com/chrspickens/Potomac/issues/34).

The [Workspace 0.6 requirements](../workspace-0.6-requirements.md) and [ADR-0011](0011-lore-records-and-markdown.md)–[ADR-0013](0013-managed-assets-and-portable-backup.md) define the proposed Lore record, sharing and managed-asset/backup contracts. Acceptance is for the requirements baseline; implementation and verification are tracked separately in [issue #46 and its child issues](https://github.com/chrspickens/Potomac/issues/46).

The [Workspace 0.7 requirements](../workspace-0.7-requirements.md) and [ADR-0014](0014-map-scenes-and-pieces.md)–[ADR-0016](0016-managed-map-images-and-backup.md) define the shared World/Battle scene model, typed map/encounter relationships, authorization and managed raster-image/archive contracts. Maps is implemented; current automated evidence and remaining device/human checks are tracked in [Maps manual QA](../maps-manual-qa.md) and under [issue #85](https://github.com/chrspickens/Potomac/issues/85) within [tracker #69](https://github.com/chrspickens/Potomac/issues/69). Map-to-Lore acceptance is also recorded in the [PR #86 report](../maps-v07-map-pin-lore-acceptance-2026-10-13.md).

The [Workspace 0.8 requirements](../workspace-0.8-requirements.md) and [ADR-0018](0018-campaign-workflow-navigation-and-context.md) define the proposed campaign preparation/Table/player workflow, navigation intents, context ownership, authorization matrix, privacy/search/deep-link boundaries, and implementation sequencing for [issue #90](https://github.com/chrspickens/Potomac/issues/90) under [tracker #89](https://github.com/chrspickens/Potomac/issues/89).
