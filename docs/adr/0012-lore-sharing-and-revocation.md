# ADR-0012: Keep Lore sharing binary and enforce it at the host boundary

- Status: Accepted for the 0.6 requirements baseline
- Date: 2026-10-12

## Context

Shared campaign knowledge needs a deliberate publication boundary. Client-side hiding, filtering after serialization, links, search snippets, SSE replay and asset URLs can each disclose private content. Revocation also cannot erase bytes a player already downloaded.

## Options considered

- Client-side visibility: simple UI behavior, but raw responses and alternate clients expose private records.
- Per-field/per-player ACLs: flexible, but broadens the policy surface and is explicitly outside the initial Lore milestone.
- GM-only versus shared article projection with host-side filtering: small policy model consistent with existing grants and role-filtered Table projections.

## Decision

0.6 uses `visibility: gm | shared` for an article. New entries default to GM-only. Publication and revocation are explicit GM-only revisioned commands, never side effects of editing. `gmNotes` remain separate and are never included in player projections. Links and assets inherit no independent grant: players receive a link or asset only when a currently visible shared article authorizes that reference and the target is itself readable.

The host filters before serialization on all queries, search/counts, HTTP downloads, SSE notifications/replay and errors. Revocation blocks subsequent host reads and replay under current policy. Previously downloaded offline copies are unavoidable; clients identify them as stale local copies. Offline Lore is read-only in 0.6.

## Consequences

Policy is explainable and testable with two distinct player principals and raw-response assertions. The model does not support selective paragraphs or player-specific article sharing. Revocation is prospective and cannot guarantee deletion of previously copied content. IDs, link counts, target names and asset metadata are also protected against inference.

## Follow-up / validation

Test publication/revocation with guessed IDs, direct download, search, links/backlinks, SSE and replay; prove GM notes never appear in player bytes and disconnected caches are marked stale. See [Workspace 0.6 requirements](../workspace-0.6-requirements.md) and [issue #47](https://github.com/chrspickens/Potomac/issues/47).
