# ADR-0007: Preserve legacy state and restore verified backups only into empty hosts

- Status: Accepted for the 0.4 requirements baseline
- Date: 2026-10-12

## Context

0.4 introduces persistent campaigns, characters and encounters over an experimental SQLite database containing fixture state, member credentials (hashed), grants, events, operation receipts and offline proposals. Users need a dependable way to upgrade and move a campaign without silently losing or overwriting data.

## Options considered

- Versioned, explicit migrations plus a consistent versioned backup and atomic restore into an empty isolated destination: preserves recovery options and makes failure behavior testable.
- Recreate the demo database at startup or overwrite a destination on import: simpler, but risks irreversible loss and obscures which state is authoritative.
- Export only current entities as JSON: portable-looking but omits grants, receipts, decisions, cursors and audit history needed for a true restore.

## Decision

Migrations are explicit, versioned, non-destructive and tested against disposable copies of supported 0.1–0.3 databases. A recoverable SQLite backup precedes migration. Stable IDs, operation outcomes, permissions and event history are preserved. Campaign export includes a versioned manifest and integrity digests for a consistent authoritative snapshot, but excludes plaintext bearer credentials, host secrets, local layouts, caches, drafts and unsubmitted client queues. Restores validate compatibility, integrity and references before atomic activation, and are accepted only into an empty isolated host. No overwrite mode is provided in 0.4.

## Consequences

Backups remain sensitive because they contain private campaign content and credential hashes; integrity checks are not encryption or exporter authentication. Restored users may need credential rotation/re-enrollment. Unsupported module or archive versions fail safely. Failed migrations preserve the source; failed restores leave the destination empty.

## Follow-up / validation

Run migrations against copies of legacy fixtures, simulate interruption, verify restart/idempotency and data preservation, and test consistent export/restore plus corruption, unsupported versions, missing modules and non-empty destination. See [Workspace 0.4 requirements](../workspace-0.4-requirements.md) and [issues #31–#32](https://github.com/chrspickens/Potomac/issues/31).
