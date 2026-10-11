# Initial requirements (v0.1)

Priority: **P0** foundation experiment; **P1** subsequent foundation; **P2** longer-term. Acceptance criteria here describe intended behavior, not implemented features.

## Functional requirements

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-01 | P0 | Load versioned system modules | Two fictional modules load via one registry without editing Characters app logic. |
| FR-02 | P0 | Validate module data | Invalid character records and unsupported module versions fail with clear errors. |
| FR-03 | P0 | Schema-driven character UI | One Characters view renders different fields/resources/actions for each system. |
| FR-04 | P0 | Constrained rules evaluation | Modules define a derived value, a precondition and an effect using a typed IR; no arbitrary code execution. |
| FR-05 | P0 | Shared app/brick commands | A full Character view and compact brick use the same query/command contract. |
| FR-06 | P0 | Authoritative host | A host validates identity, authorization, revisions and rules before committing actions. |
| FR-07 | P0 | Permission-filtered reads | A player cannot retrieve GM-only data via a brick, API, subscription, query or event stream. |
| FR-08 | P0 | Live synchronization | Two connected clients converge on committed changes and active encounter context without reloading. |
| FR-09 | P0 | Append-only action log | Accepted state changes and live dice outcomes include actor, time, action, IDs and rule version; retries do not duplicate commits. |
| FR-10 | P0 | Offline pending edits | Player can stage equipment change and advancement proposal disconnected, then reconnect and submit. |
| FR-11 | P0 | Approval policies | Compatible self-service edits auto-accept; configured advancement needs GM approval or rejection. |
| FR-12 | P0 | Conflict detection | An offline request referencing an item removed on host does not recreate the item; user sees a conflict. |
| FR-13 | P0 | Separate dashboard context | Fixed GM and player dashboards bind to host active encounter; each keeps its layout. |
| FR-14 | P1 | Dashboard editing | Users add, resize, reorder, configure and group bricks with persistent local layouts. |
| FR-15 | P1 | Game-system-specific extensions | Apps can discover provided schema/UI/actions from the system registry rather than hardcoding system IDs. |
| FR-16 | P1 | Local backup/export | Host exports restorable campaign data with manifest and assets. |
| FR-17 | P1 | Reconciliation observability | Pending, applied, rejected and conflicted operations are identifiable and never silently dropped. |
| FR-18 | P2 | Dedicated host deployment | Same server runs without the desktop client. |
| FR-19 | P2 | Portable third-party modules | Signed or otherwise trusted package distribution with sandboxed capabilities. |

## Nonfunctional requirements

| ID | Priority | Requirement |
| --- | --- | --- |
| NFR-01 | P0 | Same core protocol and validation run regardless of browser/desktop packaging. |
| NFR-02 | P0 | Avoid requiring any Potomac-operated backend to use local and LAN features. |
| NFR-03 | P0 | Rules evaluation is deterministic given state, action, recorded random results and module version; prohibit unbounded loops and unrestricted I/O. |
| NFR-04 | P0 | WebSocket disconnection/retry does not cause duplicate accepted operations; reconnect uses durable revision/cursor checks. |
| NFR-05 | P0 | Secret data is filtered **before** transmission, not hidden solely in UI. |
| NFR-06 | P0 | All client input and downloaded module content is untrusted and validated. |
| NFR-07 | P1 | Module and database versions support explicit migration; campaign upgrade is not automatic. |
| NFR-08 | P1 | Provide clear errors and recovery paths for incompatible rules, unauthorized actions and merge conflicts. |
| NFR-09 | P1 | Protect desktop/browser local data at rest as appropriate to deployment; backups should be documented. |
| NFR-10 | P1 | Remote connections use authenticated, encrypted transport. LAN/localhost development exceptions are never presented as internet-safe defaults. |

## Operation classes

- **Authoritative live:** damage, gold changes, dice results; host validates/applies/logs immediately when allowed.
- **Automatic permitted edit:** equipment or spell preparation, subject to permissions, rules, inventory and revision checks.
- **Proposal:** e.g., attribute advancement; host queues for GM approval.
- **Private draft:** never enters authoritative campaign until explicitly submitted.
- **Conflict:** not overwritten via last-write-wins without system-specific reconciliation.

## Security and data caveats

- A session context reference does not grant access.
- Local offline content is a previously authorized copy; the host cannot guarantee revocation of copies already downloaded.
- Game master permission is distinct from operating the physical host, whose administrator can potentially inspect local files.
- Offline dice rolls are explicitly unverified and must not be silently accepted as authoritative session rolls.
- Approval policies may differ by system and campaign; a default action category is not enough to establish legality.
