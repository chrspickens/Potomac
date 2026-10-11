# ADR-0001: Keep Workspace 0.2 layouts in browser localStorage

- Status: Accepted for the 0.2 experiment
- Date: 2026-10-11

## Context

Workspace 0.2 needs small, versioned personal dashboards. These contain brick IDs, positions, settings, and entity references—not campaign records. There is no authenticated per-player identity yet.

## Options considered

- `localStorage`: synchronous, simple, suitable for the small layout document; tied to one browser profile and origin.
- IndexedDB: better for large/offline data and migrations, but unnecessary for this narrow preference document.
- Host storage: enables cross-device sharing but would imply an identity and authorization model not in scope.

## Decision

Use a schema-versioned `localStorage` key scoped by campaign and an explicitly local profile label. Validate and recover on every load. Use a twelve-column tiled grid with direct pointer drag/resize. During a gesture the active brick follows the pointer continuously and a target previews its destination; on release it snaps to the grid and colliding neighbors reflow deterministically downward. Escape cancels the uncommitted gesture. Keep keyboard-operable move/resize controls as an equal path. This avoids a drag-and-drop dependency while keeping the simple layout contract. The local profile label is never sent to the host and grants no access.

## Consequences

Layouts are browser-local and may disappear when storage is cleared. They are not synchronized across devices. The client must treat save failures as errors. Host projections resolve all brick references; layout JSON is never trusted as permission. Unknown brick instances remain placeholders so registration can be restored.

## Follow-up / validation

Run storage recovery, geometry, pointer interaction, and two-profile persistence tests, then revisit IndexedDB if layouts become larger or join an offline document store. Floating/overlapping items, nested layout containers, device-specific saved layouts, and production identity remain separate decisions.
