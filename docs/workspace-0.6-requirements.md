# Potomac Workspace 0.6 — Lore and Handouts requirements

**Status:** Implemented baseline; acceptance and remaining gaps tracked separately
**Version:** 0.6.0-draft.1
**Scope:** Campaign-owned Lore articles, stable links, deliberately shared projections, managed attachment assets, search, offline read-only access, and portable backup for the existing one-campaign host.
**Specification issue:** [#47](https://github.com/chrspickens/Potomac/issues/47) · **Tracker:** [#46](https://github.com/chrspickens/Potomac/issues/46)
**Related:** [Workspace 0.4](workspace-0.4-requirements.md) · [Workspace 0.5](workspace-0.5-requirements.md) · [Architecture](architecture.md) · [Engineering standards](engineering-standards.md) · [ADR-0011](adr/0011-lore-records-and-markdown.md) · [ADR-0012](adr/0012-lore-sharing-and-revocation.md) · [ADR-0013](adr/0013-managed-assets-and-portable-backup.md)

> This document records the 0.6 contract. The current checkout implements Lore records, sharing, links, managed attachments and v4 campaign backups on the existing one-campaign, localhost-only host. Run `pnpm acceptance:lore` for isolated three-context UI and HTTP privacy coverage. Manual visual/release QA is tracked in [Lore manual QA](lore-manual-qa.md); passing automated checks is not manual signoff.

## 1. Outcome and boundaries

GM can create one generic article type for places, people, factions, quests, items, handouts and notes; edit and archive it; add typed relationships to Lore, actors and encounters; deliberately share or revoke its player-facing body; and attach safely stored local files. Enrolled players can search and follow only records and relationships authorized for them. Lore and Notes full views and Workspace bricks use the same host-owned contracts.

SQLite remains authoritative for article, link, asset metadata, authorization-relevant state and audit history. Asset bytes live in a host-managed storage area, not in client paths or an independently editable Markdown directory. Browser copies are caches, not authority. System modules do not define Lore article types or access rules.

Out of scope: nested folders, custom article schemas, graph visualization, per-paragraph or per-player ACLs, scheduled publication, collaborative editing/CRDT, arbitrary HTML, WYSIWYG, third-party plugins, web crawling/import, OCR, thumbnail/transcoding services, Maps UI, cloud asset storage, multi-campaign hosting and Internet-safe deployment.

## 2. Normative terms and resource contracts

MUST and MUST NOT state requirements. Limits below are initial interoperability bounds; a host may impose stricter configured quotas but must advertise them and return a stable limit error. It must not silently truncate accepted content.

### 2.1 Lore entries

`LoreEntry` is one versioned host resource:

```ts
type LoreEntry = {
  id: string;                 // opaque, host-issued, stable ID
  campaignId: string;
  type: "location" | "person" | "faction" | "quest" | "item" | "handout" | "note";
  title: string;              // 1–200 Unicode code points after trim
  bodyMarkdown: string;       // 0–100,000 UTF-8 bytes
  gmNotes?: string;           // 0–50,000 UTF-8 bytes; never player-visible
  tags: string[];             // normalized, unique, at most 20, each 1–40 code points
  visibility: "gm" | "shared";
  revision: number;            // starts at 1, increases on every committed edit/state change
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
```

Types are fixed UI filters and labels, not separate tables, schemas or permission profiles. IDs are opaque and never derived from title/type/position. `campaignId` is the configured host campaign. Timestamps are UTC RFC 3339. Tags are trimmed, Unicode-normalized (NFC), case-folded for uniqueness and matching, and retain one canonical display spelling; empty tags are invalid. Body and GM notes are distinct fields. A shared article's body may be projected to players; its `gmNotes` never may. GM-only articles, including title and metadata, are absent from player results.

Create defaults to `visibility: "gm"`, empty tags/body and revision 1. No create or edit implicitly publishes. A normal update replaces the editable title, type, Markdown, notes and tags only when `expectedRevision` matches; identity, campaign, timestamps, archive state, visibility and revision are host-owned. Publication is a separate command.

### 2.2 Lore links

`LoreLink` is an independently identified relation with `id`, `campaignId`, `sourceLoreId`, `targetKind: "lore" | "actor" | "encounter"`, `targetId`, optional `label` (1–80 code points), `createdAt`, and the creating principal. Source must be a non-archived Lore entry; target must exist, be non-archived/eligible, and belong to the same campaign. Unsupported kinds, including future map/resource kinds, fail as `unsupported_target_kind`; clients cannot nominate arbitrary tables or paths.

Link identity is stable across target renames. Deleting a link removes only the relation, never either endpoint. Archive/revoke of an endpoint does not cascade-delete its records or history. Queries omit links whose source or target is not currently visible to the caller; they also omit inaccessible target names, IDs, labels, counts, autocomplete suggestions and backlink existence. GM may inspect dangling legacy data for repair; players never receive it. Backlinks are derived from stored links and use exactly the same authorization filter as forward links.

### 2.3 Assets

`Asset` metadata includes opaque `assetId`, `campaignId`, original safe display filename, detected media type, byte size, SHA-256 digest, creation time/principal, archive state, and the host-generated storage key. The storage key is not a user path. Initial limits: 10 MiB per file; 100 MiB total active bytes per campaign; 100 active assets per campaign. Enforce limits on the host both before accepting bytes and at commit. Initial allowlist is `image/png`, `image/jpeg`, `image/gif`, `image/webp`, and `application/pdf`; detect content from bytes, do not trust extension or request MIME. SVG, HTML, scripts, archives, and unknown types are rejected. No inline active content; serve as attachment or with a safe raster/PDF preview policy and `X-Content-Type-Options: nosniff`.

Only a committed asset upload may create a host file. Uploads stream into a host-controlled temporary file with a hard byte limit, compute digest while streaming, validate actual media type, then atomically move to an opaque content-addressed or random managed key and commit metadata. A failed transaction removes its temporary/final orphan. A digest collision with different bytes is a hard integrity error; identical bytes may be deduplicated only within the same campaign and without changing authorization. Asset download is an authenticated host query, never a path parameter or static directory exposure.

An asset is player-readable only when referenced by at least one currently shared, non-archived Lore entry whose body/link projection is visible. A GM can read campaign assets. The host checks current authorization on every request; an unreferenced asset is not disclosed to players. Archiving/revoking an article removes that route to the asset. If another shared entry still references it, access remains. Removing the final reference does not immediately destroy the bytes: it marks the asset eligible for orphan cleanup after a documented grace window (minimum 24 hours), with audit and backup retention rules. Cleanup is idempotent and never follows a client-supplied path.

### 2.4 Markdown policy

The accepted body is plain Markdown text under the byte limit. Renderer output MUST be escaped/sanitized with a maintained first-party implementation; raw HTML is disabled (render as text or drop, consistently). Disallow `javascript:`, `data:`, `file:`, protocol-relative and unknown URL schemes. Permit HTTPS links, HTTPS images only when configured safe, and ordinary relative headings; external navigation is clearly identifiable. Do not fetch remote URLs server-side. Embedded host attachments use an explicit opaque asset reference syntax, e.g. `asset:<assetId>`, parsed as a typed reference rather than an arbitrary URL. Unknown, cross-campaign, archived or unauthorized asset references render unavailable and reveal no metadata. Markdown previews follow the same policy as final rendering and never execute script, load local files or confer permission.

## 3. Host command/query contract

All mutations are authenticated host commands. The authenticated principal and role come from host credentials, never command fields. Every command carries a unique `operationId` and contract version; updates/archive/restore/publication/unlink carry `expectedRevision` for the mutated Lore entry (or a documented asset/link revision precondition). Create/upload uses a stable client operation ID plus a create precondition. Host receipts bind operation ID, principal, canonical request hash, outcome, affected IDs/revisions and event cursor. Same ID and same canonical request returns the original receipt without duplicate effects; same ID with a different principal or payload returns `operation_id_mismatch`. Revisions are checked inside the same transaction as changes. No stale-write last-writer-wins.

Semantic operations (HTTP paths may be selected during implementation without weakening these rules):

| Operation | Authorization and preconditions | Atomic committed result |
| --- | --- | --- |
| `createLoreEntry` | GM only; valid type/content/tags; unused operation ID | Entry at revision 1, audit event, receipt |
| `updateLoreEntry` | GM only; existing active entry; exact expected revision | Validated fields, incremented revision/timestamp, event, receipt |
| `archiveLoreEntry` / `restoreLoreEntry` | GM only; exact revision; valid current state | Archive timestamp/state, revision, event, receipt; links retained but hidden where endpoint is unavailable |
| `publishLoreEntry` / `revokeLoreEntry` | GM only; exact revision; explicit deliberate action | `visibility` becomes `shared`/`gm`, revision, event and receipt; no automatic publication from edit or asset upload |
| `createLoreLink` / `removeLoreLink` | GM only; source revision and valid same-campaign endpoints | Link mutation, source revision, event and receipt |
| `beginAssetUpload` / `commitAssetUpload` / `abortAssetUpload` | GM only; scoped upload token, quotas, byte/type/hash checks; token is not a path | Asset metadata + managed bytes commit together, or neither; receipt and audit |
| `archiveAsset` / `restoreAsset` | GM only; exact metadata revision; no unsafe path | Metadata change, event and receipt; bytes preserved unless orphan cleanup policy permits later removal |
| `listLore`, `getLoreEntry`, `searchLore`, `getLoreLinks`, `getLoreBacklinks`, `getAsset` | Authenticated; current host authorization on every request | Authorized projections only; queries do not mutate |

Failure envelopes use stable codes: `unauthorized`, `not_found_or_unavailable` (for existence-sensitive targets), `validation_failed`, `revision_conflict` with safe current revision only when caller may read it, `operation_id_mismatch`, `unsupported_version`, `unsupported_target_kind`, `quota_exceeded`, `unsupported_media_type`, `payload_too_large`, `integrity_failed`, and `temporarily_unavailable`. Never echo secret content, hidden titles, paths, credentials, or rejected body values. A rejected operation changes no resource, revision, event cursor, receipt-success state or file. Failed outcomes may be safely recorded for deduplication without exposing protected payloads.

SQLite owns entry/link/asset metadata and event/operation records. Each mutation commits domain rows, revision, audit event and receipt in a transaction. File/database atomicity uses a staged protocol: durable upload intent and opaque temp key; verify bytes; atomically install managed bytes; commit metadata/event/receipt; recovery on startup resolves incomplete intents by verifying and completing only an unambiguous valid commit, otherwise removing the staged file and recording failure. A database row must never reference bytes that were not verified and installed.

## 4. Visibility, authorization and events

GM can read and mutate all Lore in the campaign, including private notes and private-only metadata. A player may read only a shared, non-archived article's player projection: `id`, `campaignId`, `type`, `title`, `bodyMarkdown`, `tags`, `visibility: "shared"`, `revision`, timestamps, authorized links and authorized asset references. `gmNotes`, GM-only articles, private links, private asset metadata, upload state and GM audit detail are excluded before serialization. No client-side hiding is a security boundary.

Every HTTP response, search result/count/facet, link/backlink/autocomplete, asset metadata/download, SSE notification, replay page, snapshot and error is filtered using current host policy before transmission. SSE remains a notification/replay hint like the existing Table contract; after a cursor gap, clients fetch a current authorized snapshot. An event that changes a private entry is GM-only. Publish may emit a minimal safe shared projection/update after commit. Revoke/archive emits only a non-disclosing invalidation to affected authorized subscribers; it must not include the now-hidden title/body/tags/links/asset IDs. Hidden-event gaps must not reveal private event counts or cursor positions through response shape; cursors remain monotonic host event cursors but responses expose only authorized continuation metadata.

Revocation blocks future queries, search, asset requests, subscriptions and replay under current membership/visibility. A previously downloaded or cached copy cannot be remotely erased. Clients MUST label offline copies with last-authorized time and stale/offline status, and MUST NOT claim that revocation erased them or that cached content remains currently authorized. Cache is read-only: offline edits are not queued or reconciled in 0.6. Reconnection replaces or revalidates the view from current host authorization before presenting it as current.

## 5. Search, offline and Workspace behavior

Search is host-side, literal case-insensitive substring matching over title and tags by default; body search is opt-in and searches only visible body text. No fuzzy/external indexing is required. Results are ordered by normalized title then opaque ID; pagination uses an opaque stable cursor. Exact query semantics, paging and limits are versioned. Search counts, empty states and suggestions are computed after authorization; inaccessible rows cannot affect counts, ranking or facets. Default page size 25, maximum 100. Archived content is excluded unless the GM explicitly requests archived records.

Offline clients may cache only authorized Lore projections and fetched asset bytes in the current authenticated member's separate cache scope. Cache stores principal/campaign scope, schema version, last-authorized timestamp and last known revision; it is read-only and never merges with host content. Revocation cannot retract a disconnected local copy. Do not persist GM-only notes/content in a player scope. Clearing a member credential or local profile must not cause another member to inherit its cached data.

The Lore full app and first-party Lore/Notes bricks use the same host query and command adapters. Layout, pin/follow binding, selected record and app handoff are presentation only and grant no access. A pinned brick re-queries its target under current authorization and shows unavailable without disclosing why when access is lost. Lore has no dependency on System A/B schema or rules.

## 6. Migration, backup and recovery

Migration from the current 0.5 host adds Lore tables/indexes and version metadata without rewriting campaign, module pin, actors, encounters, session records, event/operation IDs, receipts, grants or existing backup semantics. It is versioned, idempotent, transactional where SQLite permits, and tested on disposable copies. Create/verify a recoverable source backup before schema changes. Do not infer or seed Lore entries from encounter summaries or other text. Migration rollback is allowed only before Lore writes; after writes, restore the pre-migration backup or use a new forward migration—never drop Lore data silently.

Portable export advances the campaign archive to the next format version (v4 unless an intervening released version requires a higher successor). It includes entries, links, asset metadata, required audit/operation history, and actual binary asset bytes with per-asset byte size and SHA-256. Bytes are encoded in a deterministic archive representation and associated with an opaque asset ID, never a host filesystem path. Archive-level integrity covers manifest, database records, and every asset byte. Restore validates archive/version, checksums, quotas, uniqueness, campaign identity, all references, Markdown asset references, MIME allowlist and size limits before modifying destination. It restores only to a new/empty destination under the existing 0.4/0.5 rule; no merge or overwrite. Import existing supported v2 and v3 archives without inventing Lore records/assets; preserve their existing data and migrate to the current DB schema. Unsupported/corrupt archives fail before destination mutation. Restore stages bytes and SQLite transactionally and removes only its own newly created destination artifacts on failure.

The current checkout writes v4. The importer recognizes v2 and two precise v3 collection layouts: the earlier Table-session layout and the short-lived Lore/asset layout. This distinction matters because both historical shapes used schema version 3. Compatibility claims are limited to the fixtures in `server/host/backup.test.mjs`; an unknown v3 collection layout is rejected. Version 2 predates session history and Lore/assets, so restore supplies safe defaults and cannot recreate absent data. Backup/restore is only to a new or empty destination; it does not merge or overwrite.

## 7. Acceptance scenarios

Run against an isolated disposable host with GM, Player A and Player B using separate browser profiles; inspect raw HTTP bytes and SSE/replay, not only rendered UI. Repeat essential workflows with fresh campaigns pinned separately to fictional System A and System B.

1. GM creates a location with Markdown, tags, GM notes and an image; edits it across revisions; restarts host; content and audit persist.
2. GM links a faction to the location, an actor and encounter. Rename targets and article without changing link identity. Verify authorized backlinks work; forged, cross-campaign, archived and unavailable references fail safely.
3. Publish; both players can retrieve permitted fields through app, bricks, search, asset download and SSE. They cannot receive GM notes or a private article through guessed IDs, raw bytes, tags, counts, links, errors, replay or attachment URLs.
4. Revoke and archive; subsequent queries/search/download/replay no longer disclose the content or attachment unless another shared entry authorizes that asset. Connected clients invalidate; offline cached data is clearly stale and read-only.
5. Test Markdown raw HTML, script/event attributes, `javascript:`, `data:`, `file:`, protocol-relative URLs, unknown asset IDs, MIME spoofing, over-limit bytes, traversal filenames, interrupted uploads and quota exhaustion. No script executes and no arbitrary file can be read/written.
6. Search by title/tag/body; prove private records do not change player counts, ordering, facets or pagination. Reconnect from a cached authorized view and refresh current policy.
7. Export and restore a campaign containing shared/private entries, notes, tags, links, audit and binary assets; verify IDs, bytes and hashes. Corrupt a byte/hash, reference or archive field and prove restore refuses before destination changes. Import v2 and v3 fixtures preserving legacy data without synthetic Lore.
8. Confirm repeated command identity returns one receipt/event and one asset, changed payload conflicts, stale revision has no partial file/state, and retries after restart are safe.

## 8. Issue map and deferred decisions

| Issue | Responsibility |
| --- | --- |
| [#48](https://github.com/chrspickens/Potomac/issues/48) | SQLite Lore CRUD, stable IDs, revisions, tags, archive/restore, audit |
| [#49](https://github.com/chrspickens/Potomac/issues/49) | Lore app, filters and safe Markdown editor/preview |
| [#50](https://github.com/chrspickens/Potomac/issues/50) | Stable links and authorized backlinks |
| [#51](https://github.com/chrspickens/Potomac/issues/51) | Publication/revocation and privacy enforcement |
| [#52](https://github.com/chrspickens/Potomac/issues/52) | Managed asset upload/download and integrity |
| [#53](https://github.com/chrspickens/Potomac/issues/53) | Authorized search and offline read-only cache |
| [#54](https://github.com/chrspickens/Potomac/issues/54) | Lore/Notes Workspace bricks |
| [#55](https://github.com/chrspickens/Potomac/issues/55) | Portable next-version backup/import |
| [#56](https://github.com/chrspickens/Potomac/issues/56) | Three-browser acceptance, compatibility and docs |

Requirements baseline decisions are recorded in ADR-0011–0013. They authorize no implementation by themselves. Public wire names, exact archive binary container, cleanup grace implementation, and a future Maps target kind remain implementation details/future decisions; none may weaken these security, durability or compatibility invariants.
