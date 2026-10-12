# Architecture decisions and open questions

These are **proposals** from early product discussion, not irreversible decisions or implemented guarantees.

The current localhost 0.2 experiment uses SSE rather than the proposed WebSocket notifications, and stores personal dashboard layouts in `localStorage` rather than an IndexedDB offline queue. Its static role tokens are demo fixtures, not authenticated player identities. The rows below remain targets unless a decision record explicitly promotes them.

| Topic | Proposed direction | Status |
| --- | --- | --- |
| Hosting | Local-first, self-hosted host authoritative for shared state; optional dedicated deployment | Proposed |
| Platform | One TypeScript client UI shared between browser and desktop; modular Node host | Proposed |
| Persistence | SQLite on host, IndexedDB on browser client | Proposed |
| Live sync | WebSocket notifications plus revision/cursor reconciliation and idempotent commands | Proposed |
| Offline edits | Local draft/queue; host-side validation on reconnect | Proposed |
| Approval | Policy-driven: valid routine changes auto-accept; significant changes GM-review | Proposed |
| Presentation | User-owned dashboard groups, layouts, binding modes; bricks have focused actions | Proposed |
| Contexts | `session.activeEncounter`, personal selections, pinned entity references; not grants | Proposed |
| Permissions | Server-side authorization for fields, entities, actions, events and subscriptions | Proposed |
| Module SDK | Versioned manifests + JSON Schema + declarative UI + rules IR | Proposed |
| Rules language | Tiny typed JSON rules IR first; possibly readable PRL later | Proposed |
| Deployment | Monorepo, modular monolith initially; Electron later | Proposed |

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

When implementation begins, add small ADRs under `docs/adr/` with context, considered alternatives, decision, consequences and date. Avoid treating the examples in these docs as finalized protocols.

- [ADR 0001 — Local Workspace layouts](adr/0001-workspace-local-layout.md)
- [ADR 0002 — Workspace hardening integration route](adr/0002-workspace-hardening-integration.md)
- [ADR 0003 — Local enrollment and offline authority](adr/0003-local-enrollment-and-offline-authority.md)
