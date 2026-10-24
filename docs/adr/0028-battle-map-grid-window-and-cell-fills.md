# ADR-0028: Fit map scenes to a clipped grid window and persist square-cell colors

- Status: Accepted; implemented in the Maps application and host map contract
- Date: 2026-10-24

## Context

The Maps canvas used one fixed aspect ratio for every scene, which could distort or letterbox maps with different dimensions. GMs also need to mark terrain on tactical battle maps with color while retaining a reusable, importable design.

## Decision

The canvas window follows the scene's width-to-height ratio and fits within the available width and viewport height. The scene and its grid render together in that window; zoom magnifies both and pan moves both while the outer window clips overflow. Reset returns to the fitted scene view.

Square Battle Maps can store cell fills as an optional `fills` list on the existing grid value. Each entry identifies a zero-based cell and an opaque six-digit RGB hex color. The host validates the scene kind, grid type, coordinates, color syntax, uniqueness and bounded list length, then persists the updated grid through the existing revisioned GM map command. The GM paint and erase tools are available only while connected. Published players may see fills as map content but cannot edit them.

This stays within the existing JSON grid field, so no SQLite migration is needed. Existing maps omit `fills` and keep their current behavior. Existing backup, restore, offline-cache and encounter snapshot flows carry colors with the grid. Importing a reusable design copies its fills as part of the existing independent snapshot.

## Consequences

Colors are cell-level design data and are copied into each encounter map snapshot. Changing the grid type to anything other than square clears painted cells after an explicit confirmation. The first version supports opaque RGB colors; alpha, gradients, hex-cell fills and collaborative painting are outside this change.

## Validation

Host tests verify RGB validation, unique and in-bounds cells, GM-only writes, restart persistence and independent encounter snapshot copying. Browser acceptance paints a cell through the Maps UI, verifies zoom and pan inside the fixed frame, and confirms players see published fills without GM paint controls.
