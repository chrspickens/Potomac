# ADR-0029: Add a campaign entity catalog and encounter roster

- Status: Accepted; initial GM workflow implemented
- Date: 2026-10-25

## Context

GMs need reusable named records, initially with an optional image, and a way to select quantities of those records for prepared encounters. These records are distinct from player characters: they do not join the character participant roster or receive combat actions in this increment.

## Decision

Store campaign-scoped entity definitions in host tables with stable IDs, a broad kind (`creature` or `item`), and managed image assets. The host authorizes catalog reads and writes to the GM. Encounter membership is a separate revision-checked relation containing a creature ID and quantity from 1 to 1,000. Each counted creature also has a normalized map position, snapped to the selected battle map's grid in the encounter designer. Entity names are searchable in the catalog; Encounter preparation queries only creatures and the host rejects items from its participant relation. Existing entity rows migrate as creatures to preserve current encounters.

Images use the existing content-addressed asset store, supported raster formats, size limits, host validation, and authenticated reads. Backups include entity metadata and kinds, encounter selections, placements, operation receipts, and referenced image bytes under backup schema version 9. Existing backup versions remain readable and older entity records restore as creatures; version 7 selections restore without positions and receive default encounter positions in the client.

## Consequences

- Entity definitions remain unchanged when selected for an encounter; only the encounter association and quantity change.
- Each unit in an encounter quantity gets an independent position. Coordinates are normalized to map bounds so a reusable map design and its encounter copy share the same layout.
- Entity records do not imply player visibility or combat participation. Encounter entity projections are currently GM-only.
- This increment does not add statblock fields, system-specific rules, entity editing/deletion, player projections, combat tokens, or V2 workflow integration.
- Entity creation and image attachment are separate host operations, so a failed image upload can leave the named record saved without its image.

## Follow-up / validation

Exercise create/search/image attachment, authorization, encounter quantity and position validation, stale encounter revisions, and version-8 backup/restore with images and placements. Later work can add system-specific statblocks and use the encounter roster to create mutable runtime instances.
