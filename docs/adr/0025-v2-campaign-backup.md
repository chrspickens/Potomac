# ADR 0025 — V2 campaign backup archive v6

- Status: Proposed implementation increment
- Date: 2026-10-18
- Issue: #139 (parent #131)

## Context

The v5 archive predates V2 and intentionally contains only the V1 campaign collections. V2 authority is committed across the same SQLite database but spans the immutable capability lock, campaign authority epoch, effect entities/events/receipts, extension ownership/workflows/receipts/events/pending commands, and durable reaction windows/submissions/events. A V1 export cannot represent these records. Copying the live database file is not the logical backup contract; WAL state must be captured consistently.

## Decision

Keep the existing `potomac.campaign-backup` JSON envelope and add schema v6 only for a host containing V2 lock tables. V1-only exports remain v5 and v2–v5 imports retain their existing exact-layout compatibility rules. V6 uses SQLite `VACUUM INTO` to form a consistent database snapshot, then serializes the existing V1 collections plus every V2 durable table in that snapshot. The SHA-256 integrity field covers the manifest and all rows. Validation binds the stored lock to the locally loaded trusted catalog's exact root digest and capability closure, checks authority epoch and V2 record campaign/provenance references, and rejects unavailable or changed module source before destination mutation.

Restore remains empty-destination only. It validates before staging, creates the V2 schemas in a staged database, inserts rows in one transaction, and initializes authority triggers before publishing the staged database and assets. If staging or publication fails, the existing restore rollback path removes staged files and restores prior paths.

Member credential hashes are included because they are required to reconnect the same authenticated principals; plaintext bearer credentials are never stored or exported. Credential hashes are sensitive authentication material, so archives must be handled as private files. The checksum detects accidental corruption, not malicious rewriting: an archive creator can recompute it after changing records. V6 is neither encrypted nor signed, and semantic validation is not a signature. Player-facing queries continue to use normal host authentication and visibility filtering after restore; credential hashes are never included in projections.

## Consequences and limits

Supported restore requires the same reviewed trusted module source and exact capability lock. There is no module substitution or automatic ruleset migration. Archive schema migration (v2–v5 to current host representation) remains separate from module/schema migration and from offline command reconciliation. Pending reactions/continuations are preserved verbatim with their authority epoch; an authority mismatch, invalid identity, stale lock, or unsafe time boundary must fail closed under the existing runtime protocol. V6 does not include browser-local caches, pending offline queues, layouts, or private drafts. It does not claim multi-process or power-loss guarantees, production identity, or completion of genuine historical-archive/device evidence.

## Validation status

Focused backup tests cover V1 v2/v3/v4/v5 archive layouts, recomputed-checksum V2 lock/closure/ownership/campaign/epoch/receipt/event tampering, corrupted checksums, missing or digest-mismatched trusted catalog entries, and deterministic failures at validation/import/asset/final-publication boundaries with no published partial state. Three isolated Chromium contexts exercise pending V2 reaction export/restore, responder authorization, exact lock/epoch, one-time continuation, retry behavior, filtering, and second-restart persistence. These generated tests do not establish genuine historical archive provenance or manual device/accessibility evidence; those remain open under #139.
