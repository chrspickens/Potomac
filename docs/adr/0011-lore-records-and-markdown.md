# ADR-0011: Store Lore as generic SQLite records with safe Markdown

- Status: Accepted for the 0.6 requirements baseline
- Date: 2026-10-12

## Context

Issue #46 scopes campaign Lore and handouts alongside host-owned Characters, Encounters and Table state. A directory of editable Markdown files would create a second source of truth, bypass host revisions/authorization, and complicate backup and links. Separate schemas for each article type would make ordinary UI filters into incompatible data models. Markdown also introduces active-content and local-file risks.

## Options considered

- Filesystem Markdown as the canonical store: convenient for external editing, but bypasses SQLite transactions, host authorization and the existing campaign backup boundary.
- A separate table/schema per Lore type: can encode different structures, but creates unnecessary contract duplication for the specified shared fields.
- One campaign-owned SQLite article model with a fixed type enum and Markdown body: matches current host ownership and permits uniform revision, audit and filtering.

## Decision

For 0.6, `LoreEntry` is a generic host resource stored in SQLite with opaque stable ID, campaign ID, fixed type enum, title, Markdown body, separate optional GM notes, normalized tags, GM/shared visibility, revision, timestamps and archive state. Type is a presentation/filter value, not a schema discriminator. SQLite remains authoritative; no runtime Markdown directory or client-side persistence is authoritative.

Accept plain Markdown under explicit byte limits. Disable raw HTML, sanitize rendered output, reject dangerous/unknown URL schemes, do not fetch remote content server-side, and represent embedded local assets by explicit opaque asset ID references. The Lore app and Notes/Lore bricks use the same host contracts.

## Consequences

Host mutations can atomically validate revision, persist content, record audit and return an idempotent receipt. Search and backup operate on the same records. External editors cannot bypass host policy. Markdown rendering and any future article-specific fields require a versioned contract change; broad custom schemas are out of scope.

## Follow-up / validation

Implement and test safe Markdown handling, Unicode/tag normalization, exact limits, optimistic conflicts, stable IDs, idempotency, restart persistence and parity between full app and bricks. See [Workspace 0.6 requirements](../workspace-0.6-requirements.md) and [issue #47](https://github.com/chrspickens/Potomac/issues/47).
