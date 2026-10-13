# ADR-0016: Store map raster images as managed campaign assets and include bytes in v5 archives

- Status: Accepted for the 0.7 requirements baseline
- Date: 2026-10-13

## Context

Map backgrounds and optional piece imagery need durable identity, integrity, authorization, bounded ingestion and complete backup/restore. Lore assets already establish host-managed storage and portable binary backup, but map-image visibility must be independent of Lore article publication. The next archive must preserve existing 0.6 data and supported historical layouts.

## Options considered

- Store user paths or serve a static directory: rejected because it permits arbitrary file access and bypasses host authorization.
- Store image bytes inline in SQLite: rejected because it unnecessarily expands relational storage and conflicts with managed streaming.
- Host-managed opaque asset keys with metadata and bytes in portable archives: selected; aligns with existing host authority while preserving integrity and backup completeness.

## Decision

`MapAsset` metadata and scene references are host-owned and campaign-scoped. Image bytes reside under opaque host-generated keys, never client paths. A map asset is readable only when the requester can currently read an active scene referencing it; Lore visibility does not grant map-image access and no Lore article is required.

Initial raster allowlist is PNG, JPEG, GIF and WebP, with bounded decoding dimensions/pixels, 10 MiB per file, 100 MiB active bytes and 100 active map assets per campaign. Reject SVG, HTML, scripts, PDF, archives, unknown media and unsafe/oversized content. Detect type from bytes. Stage uploads under a hard stream limit, hash and validate before installation, and atomically coordinate installed bytes, metadata/reference, scene revision, event and receipt. Use startup recovery for interrupted intents. Identical bytes may be deduplicated only within a campaign; hash collision with different bytes fails closed. Remove orphan bytes only after at least 24 hours and through audited idempotent cleanup.

Campaign backup advances to archive v5 and includes map records, encounter associations, metadata, required history and actual referenced bytes with size and SHA-256 integrity. Restore validates all content before activating into a new/empty destination. Import supported v2, both pinned v3 layouts and v4 without synthesizing map data or changing existing records. No merge or overwrite is added.

## Consequences

Map-image access is checked independently on every request and immediately stops after scene revocation even when the bytes remain stored. Backups grow with map images and remain sensitive. The staged upload protocol must reconcile filesystem and SQLite state after crashes. Historical compatibility depends on fixture-pinned layouts, especially the two distinct v3 shapes.

## Follow-up / validation

Test MIME/signature spoofing, decompression/dimension bounds, filename traversal, quotas, deduplication, hash mismatch, interrupted uploads and cleanup. Round-trip v5 with bytes and verify corruption or invalid references leave destination empty; import supported v2/v3/v4 fixtures and verify all pre-existing data. See [Workspace 0.7 requirements](../workspace-0.7-requirements.md), [ADR-0013](0013-managed-assets-and-portable-backup.md) and [issue #70](https://github.com/chrspickens/Potomac/issues/70).
