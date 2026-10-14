# ADR-0016: Store map raster images as managed campaign assets and include bytes in v5 archives

- Status: Accepted (0.7 requirements decision; implementation now present)
- Date: 2026-10-13

This record preserves the accepted design decision and its original rationale. “Accepted” records the decision, not by itself proof that every requirement or follow-up has been implemented or verified. The implementation and evidence status below are maintained separately.

## Context

Map backgrounds and optional piece imagery need durable identity, integrity, authorization, bounded ingestion and complete backup/restore. Lore assets already establish host-managed storage and portable binary backup, but map-image visibility must be independent of Lore article publication. The next archive must preserve existing 0.6 data and supported historical layouts.

## Options considered

- Store user paths or serve a static directory: rejected because it permits arbitrary file access and bypasses host authorization.
- Store image bytes inline in SQLite: rejected because it unnecessarily expands relational storage and conflicts with managed streaming.
- Host-managed opaque asset keys with metadata and bytes in portable archives: selected; aligns with existing host authority while preserving integrity and backup completeness.

## Decision

`MapAsset` metadata and scene references are host-owned and campaign-scoped. Image bytes reside under opaque host-generated keys, never client paths. A map asset is readable only when the requester can currently read an active scene referencing it; Lore visibility does not grant map-image access and no Lore article is required.

The accepted requirements baseline specified PNG, JPEG, GIF and WebP, bounded decoding dimensions/pixels, 10 MiB per file, 100 MiB active bytes and 100 active map assets per campaign. It called for rejecting active content/unsupported media, byte-based type detection, staged and validated uploads, crash recovery, campaign-scoped deduplication, and delayed audited orphan cleanup. The implementation has a 5 MiB per-file upload limit, a 100 MiB campaign asset budget, signature and image-dimension validation (at most 20,000 pixels per dimension and 100 million pixels total), host-managed content keys and content-hash deduplication. It does not currently enforce the baseline's 100-active-Map-asset cap or 10 MiB upload size. The implementation, rather than the earlier requirements numbers, defines the current limits. Supported uploads are PNG, JPEG, GIF and WebP; arbitrary client filesystem paths are not used.

Campaign backup advances to archive v5 and includes map records, encounter associations, metadata, required history and actual referenced bytes with size and SHA-256 integrity. Restore validates all content before activating into a new/empty destination. Import supported v2, both pinned v3 layouts and v4 without synthesizing map data or changing existing records. No merge or overwrite is added.

## Consequences

Map-image access is checked independently on every request and immediately stops after scene revocation even when the bytes remain stored. Backups grow with map images and remain sensitive. The staged upload protocol must reconcile filesystem and SQLite state after crashes. Historical compatibility depends on fixture-pinned layouts, especially the two distinct v3 shapes.

## Implementation and current verification

The current host schema and routes implement World/Battle scenes, grids, actor and pin pieces, typed Map/Lore pin destinations, encounter-to-map associations, publication/revocation, and managed background assets. Host authorization is applied to scene projections and image reads; this is not a production authentication or remote deployment design. Browser cache is bounded (20 scenes and 20 MiB aggregate image bytes, with a 10 MiB per-image cache bound) and scoped to authorized map projections, but content already downloaded cannot be remotely erased after revocation or disconnection. Maps do not implement fog-of-war or combat automation.

The v5 exporter snapshots SQLite with `VACUUM INTO`, exports all host collections including the Map collections, and embeds bytes for referenced Lore and Map assets with size/hash metadata under a canonical SHA-256 archive integrity value. It rejects missing, altered or unsafe referenced asset files and does not overwrite an existing export. Restore validates the archive, map/Lore/encounter references, module availability, image signatures, exact bytes and checksums before restoring into a new or empty database/assets destination; it does not merge. Restore retains compatibility for supported v2, both recognized v3 layouts, and v4 archives; v2 cannot restore session history it did not contain. The fixture-based tests are in [backup.test.mjs](../../server/host/backup.test.mjs), with implementation in [backup.mjs](../../server/host/backup.mjs) and routes/schema in [index.mjs](../../server/host/index.mjs).

These code and test references establish implemented behavior and automated coverage; they are not a claim of physical-device QA or production deployment validation. Check current CI and the applicable Maps acceptance/manual QA record before making a release-verification claim.

## Follow-up / validation

The original follow-up list is retained as design history, not a current list of unverified work: focused host and backup tests now cover accepted image signatures/dimensions, quotas, deduplication, hash/reference validation, failure-safe restore, v5 byte round trips and supported v2/v3/v4 fixtures. See [backup.test.mjs](../../server/host/backup.test.mjs), [Workspace 0.7 requirements](../workspace-0.7-requirements.md), [ADR-0013](0013-managed-assets-and-portable-backup.md) and [issue #70](https://github.com/chrspickens/Potomac/issues/70). Test results and outstanding acceptance/manual QA are maintained in the relevant run record; this ADR does not claim that all human/device checks passed.
