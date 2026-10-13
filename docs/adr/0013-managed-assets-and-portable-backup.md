# ADR-0013: Manage Lore asset bytes on the host and carry them in campaign backups

- Status: Accepted for the 0.6 requirements baseline
- Date: 2026-10-12

## Context

Lore attachments need durable IDs, access checks, integrity and safe backup/restore. Storing arbitrary client paths or exposing a static directory risks path traversal and bypasses authorization. Backing up only SQLite metadata would create restored records with missing files. The current campaign backup is a versioned JSON archive (v2 in this checkout), and 0.5 requires preserving prior backup imports.

## Options considered

- Store client paths or expose a filesystem tree: rejected because callers could select/read arbitrary host files and authorization would be bypassed.
- Store all bytes in SQLite: simple atomicity, but expands the existing database/archive model and creates unnecessary database growth.
- Store metadata in SQLite and bytes under host-generated managed keys: preserves host authority while allowing bounded file streaming and explicit integrity checks.

## Decision

Asset metadata and references are SQLite-owned; bytes reside under a host-managed storage root keyed only by opaque host-generated values. Enforce an allowlist by detected content, per-file and campaign quotas, hard streaming limits, SHA-256 verification, atomic staged writes and cleanup of incomplete uploads. Downloads are authenticated host operations; no user path is opened or served.

Campaign backup advances to v4 (or the next successor if another format ships first), containing Lore rows, links, asset metadata and actual binary bytes with sizes and hashes, under archive-wide integrity. Restore validates all bytes/references before changing a new or empty destination. Import supported v2 and v3 artifacts without inventing Lore content; current checkout support is v2, and any v3 format must be pinned with a fixture before implementation. No merge or overwrite is introduced.

## Consequences

Backup size grows with attachments and restore must stage both database and file data. Upload recovery needs a durable intent protocol across filesystem and SQLite transaction boundaries. Integrity failures must fail closed. Quotas and supported media types are part of the host contract and must be versioned if expanded.

## Follow-up / validation

Test traversal attempts, MIME spoofing, oversized/interrupted uploads, duplicate hashes, cleanup, access revocation, archive corruption, rollback, v2/v3 import fixtures and complete asset-byte round trips. See [Workspace 0.6 requirements](../workspace-0.6-requirements.md) and [issue #47](https://github.com/chrspickens/Potomac/issues/47).
