# ADR 0008 — Versioned local campaign backup and restore

**Date:** 2026-10-12  
**Status:** Accepted for the 0.4 host experiment

## Context

Host campaign state spans relational SQLite tables and an append-only event cursor. A JSON view of current actors would omit authorization, operation idempotency, offline review, and audit history. Restore must not replace an active database or silently change the module rules needed by stored actors.

## Decision

Use a versioned JSON archive with campaign metadata, module pins, collection list, and a SHA-256 digest over canonicalized content. Export through SQLite's online backup API. Restore validates format, digest, required collections, module availability and relational references before importing all rows in one transaction into an empty destination. Include credential hashes and member/grant records, never plaintext bearer credentials; browser-local presentation and draft state remain out of scope.

## Consequences

The archive is sensitive and integrity-checked, but not encrypted or authenticated; the checksum detects accidental modification, not an attacker who can rewrite it. Required module versions must already be available locally. Automated tests cover round-trip data, corruption, unsupported schemas, unavailable modules, and non-empty destinations.

## Follow-up / validation

Revisit the format version when host tables or migration requirements change.
