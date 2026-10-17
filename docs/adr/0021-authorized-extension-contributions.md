# ADR-0021: Register extension entities and UI as host-authorized contributions

- Status: Proposed
- Date: 2026-10-17

## Context

Potomac must support new entity types, commands, workflows, applications, sheets and bricks without system-specific Core branches. Existing web fixture modules render a separate character contract, while workspace bindings and map/Lore links correctly demonstrate that presentation references do not grant access. V1 offline operations already carry stable operation IDs, revisions and module identity.

## Options considered

1. Add every new entity and control to Core: predictable but creates system-specific branching and migration coupling.
2. Render arbitrary JSON in clients: flexible but unsafe and lacks a host authorization path.
3. Host-registered typed descriptors for entities, commands, workflows and UI projections, all using shared host commands and permission filtering: selected.

## Decision

Propose option 3. Contributions have stable namespaced IDs, schema versions, declared commands/workflows, explicit authorization scopes, bounded queries and accessible pending/offline/unavailable states. A UI binding is never a permission. Commands are host-bound and idempotent; workflows persist serializable state; migrations are explicit, backup-first and atomic.

## Consequences

Generic persistence and UI adapters must validate descriptor references and supported controls. Missing extensions leave records unavailable/read-only rather than being silently dropped. Backup archives must include descriptors, lock closure, extension records, workflow state and migration history. The minimum schema/UI dialect and query cost limits require implementation experiments.

## Relationship to execution and capability decisions

Commands select resolver and handler references from the exact capability lock described by ADR-0019, then enter the host-mediated transaction boundary described by ADR-0020. A contribution descriptor never authorizes itself, bypasses effect validation, or changes the requirement for idempotent offline receipts and filtered projections. The execution spike demonstrates only the transaction/continuation mechanics, not generic entity persistence, UI safety or migration behavior.

## Follow-up / validation

Build a starship reactor fixture with a custom entity, command, workflow, sheet and brick. Test GM/player projections, owner/relation authorization, unsafe field/action rejection, offline conflict, migration/restore and shared app/brick command behavior before accepting.
