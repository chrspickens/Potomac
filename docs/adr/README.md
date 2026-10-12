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
