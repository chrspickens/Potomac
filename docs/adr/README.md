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
