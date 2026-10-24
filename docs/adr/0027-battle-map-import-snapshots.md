# ADR-0027: Import reusable Battle Maps as independent encounter snapshots

- Status: Accepted; implemented in the Maps and Encounters applications
- Date: 2026-10-24

## Context

The Maps application has one campaign-owned scene model for World and Battle maps. Its older encounter association UI made a reusable Battle Map look owned by one encounter and placed the import decision on the map itself. GMs need a library of reusable Battle Map designs and an encounter-specific copy they can publish or edit independently. World Maps remain campaign-level references with location pins and Lore destinations.

## Options considered

- Keep a live reference from each encounter to a reusable Battle Map: rejected because edits to the reusable design would change prepared encounters unexpectedly.
- Move a Battle Map into one encounter: rejected because it consumes the reusable design and implies exclusive ownership.
- Copy its bounded map data through one host-authoritative import command: selected; the source stays available and each encounter can receive its own copy.

## Decision

Maps presents separate World Maps and Battle Map Designs collections. World maps focus on location pins and Lore destinations. An unassigned Battle Map is a reusable design. A GM imports a selected design from encounter preparation; the host checks source revision and current encounter association, then atomically creates an independent GM-only scene, copies its dimensions, grid, background metadata and pieces with new scene-local IDs, and associates that copy with the encounter. The source remains unchanged and may be imported into other encounters.

The copied background asset points to the same content-addressed bytes, so copying metadata does not duplicate stored image bytes. The encounter copy has its own scene revision, visibility and pieces. The operation has an idempotent receipt and a GM-only audit event. A stale source or changed encounter association conflicts instead of silently replacing the selected map. Replacing a copy leaves the previous scene and history in Maps.

Map/Lore destinations remain World Map behavior and are not copied into a Battle Map import. The import command is GM-only and does not grant player read access. The host continues to filter the imported scene and background under current encounter and map visibility.

Existing map records and encounter associations remain readable; the schema does not change. V1 encounter persistence and session lifecycle remain unchanged. Existing stable map IDs, V1 permissions, image storage, backup/restore and V2 ruleset authority are not altered.

## Consequences

Each encounter copy can diverge from its reusable design by intent. GMs must re-import if they want later design edits copied into an encounter. Old imported copies remain addressable until explicitly archived. Map collection tabs are a presentation choice and do not grant access. World map cross-links and Lore destinations continue to resolve under host authorization.

## Validation

The host map suite covers atomic copy data, new piece IDs, shared content-addressed image bytes, repeated import into multiple encounters, idempotent retry after restart, stale-association conflict, World Map rejection, player denial and private copy projection. The real-browser Maps acceptance journey covers GM encounter preparation, import, player map visibility, offline behavior, V1 module compatibility and the System B map flow. Automated results are recorded with the change; no human usability validation is claimed.
