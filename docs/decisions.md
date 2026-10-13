# Architecture decisions and open questions

These are **proposals** from early product discussion, not irreversible decisions or implemented guarantees.

The current localhost 0.3 experiment uses SSE rather than the proposed WebSocket notifications. Personal dashboard layouts remain in `localStorage`; authorized actor snapshots, queued edits, and drafts use member-scoped IndexedDB. GM-enrolled players have individual credentials, while static role tokens remain development fixtures. These are experimental choices, not production identity or remote-host guarantees. The rows below describe longer-term targets unless a decision record explicitly narrows them.

| Topic | Proposed direction | Status |
| --- | --- | --- |
| Hosting | Local-first, self-hosted host authoritative for shared state; optional dedicated deployment | Proposed |
| Platform | One TypeScript client UI shared between browser and desktop; modular Node host | Proposed |
| Persistence | SQLite on host, IndexedDB on browser client | Exercised in 0.3 localhost experiment; production migration/backup path open |
| Live sync | WebSocket notifications plus revision/cursor reconciliation and idempotent commands | Proposed |
| Offline edits | Local draft/queue; host-side validation on reconnect | Exercised with fictional fixtures in 0.3 |
| Approval | Policy-driven: valid routine changes auto-accept; significant changes GM-review | Exercised with fictional fixtures in 0.3 |
| Presentation | User-owned dashboard groups, layouts, binding modes; bricks have focused actions | Proposed |
| Contexts | `session.activeEncounter`, personal selections, pinned entity references; not grants | Proposed |
| Permissions | Server-side authorization for fields, entities, actions, events and subscriptions | Exercised for local enrolled members in 0.3; broader relation/search policy open |
| Module SDK | Versioned manifests + JSON Schema + declarative UI + rules IR | Proposed |
| Rules language | Tiny typed JSON rules IR first; possibly readable PRL later | Proposed |
| Deployment | Monorepo, modular monolith initially; Electron later | Proposed |
| Workspace 0.4 campaign scope | One configured campaign per local host; exact default module ID/version pinned | Accepted for 0.4 requirements; see [ADR-0004](adr/0004-single-campaign-and-system-pin.md) |
| Entity permissions | Host-side member grants plus field-level projections; bindings never grant access | Accepted for 0.4 requirements; see [ADR-0005](adr/0005-host-authorization-and-entity-visibility.md) |
| Encounter lifecycle | Persistent planned/active/completed/archive lifecycle and one GM-controlled active encounter | Accepted for 0.4 requirements; see [ADR-0006](adr/0006-encounter-lifecycle.md) |
| Migration and backup | Preserve legacy data; versioned snapshot backup restores only into an empty host | Accepted for 0.4 requirements; see [ADR-0007](adr/0007-migration-and-backup-restore.md) |
| Table session persistence | One durable session resource for the one-campaign host; `context.activeEncounter` migrates as a reference, not as a session | Accepted for 0.5 requirements; see [ADR-0010](adr/0010-durable-table-session.md) |
| Lore article storage | Generic campaign-owned SQLite records with fixed built-in types and safe Markdown; no filesystem document source of truth | Accepted for 0.6 requirements; see [ADR-0011](adr/0011-lore-records-and-markdown.md) |
| Lore sharing and revocation | GM-only/shared article boundary, deliberate host-audited publish/revoke, filtering before every response; cached copies cannot be remotely erased | Accepted for 0.6 requirements; see [ADR-0012](adr/0012-lore-sharing-and-revocation.md) |
| Lore assets and portable archive | SQLite metadata plus host-managed bytes; backup carries bytes and integrity data; next archive imports supported v2/v3 without merging or overwriting | Accepted for 0.6 requirements; see [ADR-0013](adr/0013-managed-assets-and-portable-backup.md) |

## Questions to answer through experiments

1. Should local player data use browser IndexedDB only, or also an optional SQLite desktop store?
2. What per-field filtering model prevents inference leaks via entity search, events, and relations?
3. How precisely do action dependencies and revision conflicts work for inventory/resource operations?
4. What workflow should support a player with multiple local devices while the GM is offline?
5. Which action types are system-level, and which are campaign-specific GM policy overrides?
6. Which JSON Schema dialect and UI schema components are sufficient across two dissimilar systems?
7. What deterministic rules IR and execution limits are easiest to validate and test?
8. What software/data/content license should be selected? The repository is currently unlicensed.
9. What distribution and update strategy works without centrally operated services?
10. How are remote joining, TLS, invitations and firewall traversal implemented securely in later phases?

## Decision records

Record consequential new implementation decisions as small ADRs under `docs/adr/` with context, considered alternatives, decision, consequences and date. Avoid treating examples in these docs as finalized protocols.

- [ADR 0001 — Local Workspace layouts](adr/0001-workspace-local-layout.md)
- [ADR 0002 — Workspace hardening integration route](adr/0002-workspace-hardening-integration.md)
- [ADR 0003 — Local enrollment and offline authority](adr/0003-local-enrollment-and-offline-authority.md)
- [ADR 0008 — Versioned local campaign backup and restore](adr/0008-campaign-backup-and-restore.md)
- [ADR 0009 — Generic session state and commands](adr/0009-generic-session-state-and-commands.md)
- [ADR 0010 — Durable Table session resource](adr/0010-durable-table-session.md)
- [ADR 0011 — Lore records and safe Markdown](adr/0011-lore-records-and-markdown.md)
- [ADR 0012 — Lore sharing and revocation](adr/0012-lore-sharing-and-revocation.md)
- [ADR 0013 — Managed Lore assets and portable backup](adr/0013-managed-assets-and-portable-backup.md)
- [ADR 0004 — One campaign per host and exact system pin](adr/0004-single-campaign-and-system-pin.md)
- [ADR 0005 — Host authorization and entity visibility](adr/0005-host-authorization-and-entity-visibility.md)
- [ADR 0006 — Encounter lifecycle and session activation](adr/0006-encounter-lifecycle.md)
- [ADR 0007 — Legacy migration and backup/restore safety](adr/0007-migration-and-backup-restore.md)

The 0.4, 0.5 and 0.6 decisions are accepted as requirements for review and implementation planning; they do not alone establish implementation. See [Workspace 0.4 requirements](workspace-0.4-requirements.md), [tracker issue #26](https://github.com/chrspickens/Potomac/issues/26), [Workspace 0.5 requirements](workspace-0.5-requirements.md), [tracker issue #34](https://github.com/chrspickens/Potomac/issues/34), [Workspace 0.6 requirements](workspace-0.6-requirements.md), and [tracker issue #46](https://github.com/chrspickens/Potomac/issues/46).
