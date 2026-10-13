# ADR-0014: Use one campaign-owned MapScene model for World and Battle maps

- Status: Accepted for the 0.7 requirements baseline
- Date: 2026-10-13

## Context

Issue #70 requires World maps and Battle maps to share a model and Maps app while preserving distinct creation defaults. Separate storage or authorization semantics would duplicate contracts and risk treating a presentation distinction as a security boundary. Shared scene state also needs clear coordinate, conflict, publication and archive rules before schema implementation.

## Options considered

- Separate `WorldMap` and `BattleMap` resources: rejected because common pins, images, grids, links and sharing would require duplicated lifecycle and authorization logic.
- One scene with `kind`-specific schema/capabilities: rejected because kind would create incompatible capabilities and make conversion destructive or ambiguous.
- One `MapScene` plus stable `MapPiece` records, with kind selecting creation/UI defaults: selected; both kinds have the same capabilities and one host policy.

## Decision

0.7 uses one versioned `MapScene` resource with opaque stable ID, campaign, kind, title, bounded local coordinate dimensions, optional managed background asset, `gm|shared` visibility, GM-private description, grid, archive state, revision and timestamps. `MapPiece` has a stable ID, scene-local x/y, fixed platform piece type, visibility, layer/order, optional size/label and a closed typed reference union.

World creation defaults to no grid, location pins first and no required encounter. Battle creation defaults to a square grid and actor tokens first. Both kinds support all piece/link/image/grid/encounter capabilities. Changing kind preserves explicit settings and all content and identity. Coordinates are scene-local units, never screen pixels or geographic coordinates. Pan/zoom/crop are client presentation state.

One scene revision is the atomic conflict boundary for scene and piece changes. Every mutation is authenticated, GM-only, operation-ID-idempotent, revision checked, and commits resource changes, audit event and receipt atomically. Same ID/same canonical request replays the result; changed request conflicts. New scenes/pieces default GM-only. Publication is explicit; players receive only currently authorized shared projections filtered before serialization. Archive/restore are explicit and preserve identities/history; removal of one piece does not cascade to linked entities.

Initial requirements bounds are 1–100,000 units per axis, 10,000 pieces per scene and 1 MiB scene/piece metadata. Initial grid is none or square with positive bounded cell width, origin and a defined cell-corner alignment. Limits and semantic enums are versioned contracts.

## Consequences

The model permits both scene kinds to evolve uniformly and lets a GM change kind without conversion or data loss. A scene-level revision can create more conflicts when separate pieces are edited concurrently, but yields a simple atomicity and stale-write story. Host authorization must cover every scene, piece, relation, event and image path; client-side visibility is never sufficient. Shared coordinate data is deliberately independent of viewport geometry.

## Follow-up / validation

Validate bounds and grid semantics, kind changes preserving all fields/IDs, concurrent stale piece edits, operation retries, archive/restore, current-policy event filtering and keyboard/touch map interactions. See [Workspace 0.7 requirements](../workspace-0.7-requirements.md) and [issue #70](https://github.com/chrspickens/Potomac/issues/70).
