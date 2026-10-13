# Potomac Workspace 0.7 — Maps and Encounter Scenes requirements

**Status:** Proposed for review; requirements baseline before implementation  
**Version:** 0.7.0-draft.1  
**Scope:** Campaign-owned World and Battle map scenes, shared map pieces, explicit publication and authorization, encounter relationships, safe managed raster images, Workspace integration, and portable backup evolution.  
**Parent:** [Issue #69](https://github.com/chrspickens/Potomac/issues/69) · **Specification:** [Issue #70](https://github.com/chrspickens/Potomac/issues/70)  
**Related:** [Workspace 0.4](workspace-0.4-requirements.md) · [Workspace 0.5](workspace-0.5-requirements.md) · [Workspace 0.6](workspace-0.6-requirements.md) · [Architecture](architecture.md) · [Engineering standards](engineering-standards.md) · [ADR-0012](adr/0012-lore-sharing-and-revocation.md) · [ADR-0013](adr/0013-managed-assets-and-portable-backup.md) · [ADR-0014](adr/0014-map-scenes-and-pieces.md) · [ADR-0015](adr/0015-map-links-and-encounter-associations.md) · [ADR-0016](adr/0016-managed-map-images-and-backup.md)

> This document specifies a target contract; it does not assert that Maps or Encounter Scenes are implemented. It extends the one-campaign, host-authoritative model and the 0.6 managed-asset/archive contract. Requirements-baseline ADRs authorize no implementation by themselves.

## 1. Outcome and boundaries

The Maps app presents two kinds of campaign-owned scene through one `MapScene` resource: `world` and `battle`. Kind selects creation and presentation defaults, not storage, permissions, or capabilities. A GM can create a world map with location pins and a battle map with a square grid and actor tokens, publish each deliberately, and associate scenes with encounters. Players receive only currently authorized scenes, pieces, links and image bytes. Full app and Workspace bricks use the same host contracts.

One host still contains at most one campaign pinned to one exact game-system module version. Maps introduce no executable module code, alternate authority, cloud dependency or remote-host exposure. Player map edits are out of scope. Fog-of-war, dynamic lighting, secret pixels inside an otherwise shared image, turn/combat automation, automatic distance calculation, online map providers, GIS/geographic coordinates and arbitrary uploads are out of scope.

## 2. Normative requirements

### 2.1 Scene and piece model

**WS07-001 — Shared scene resource.** The host MUST store World and Battle maps as one versioned `MapScene` resource with a stable opaque `sceneId`, `campaignId`, `kind: world | battle`, display title, bounded coordinate-space width/height, nullable managed background asset ID, `visibility: gm | shared`, optional archived state, optional GM-private description, grid configuration, revision, schema version and timestamps. It MUST be campaign-scoped and must not encode authorization in `kind`.

**WS07-002 — Map pieces.** A `MapPiece` MUST have a stable opaque identity, owning scene ID, piece type, bounded scene-local x/y coordinates, visibility `gm | shared`, layer/order value and revision/version participation. Optional size, label and typed reference to an actor, Lore entry, encounter or destination map are validated host-side. A location pin MAY link to a destination scene by stable target ID. Coordinates MUST be in the scene coordinate space, never screen pixels or geographic coordinates.

**WS07-003 — Presets and capability parity.** Creating a `world` scene defaults to no grid, location pins first, optional Lore and destination-map links, and no required encounter. Creating a `battle` scene defaults to square grid on, actor tokens first and optional encounter association. Both kinds MUST support grids, pins, tokens, images, Lore links and encounter associations. Changing kind changes defaults only: it MUST preserve explicit grid configuration, coordinates, stable IDs, images, links, pieces and sharing.

**WS07-004 — Grid contract.** Grid configuration is `none` or `square`. A square grid defines finite positive cell width, finite origin x/y in scene coordinates, and alignment `origin_at_cell_corner`, meaning grid lines occur at origin + n × cell width. Scene dimensions, grid values, origin and all piece coordinates MUST be validated as finite and within versioned bounds. Bounds and defaults are specified below; invalid, NaN, infinite, negative or out-of-scene values are rejected without mutation.

**WS07-005 — Shared revision and conflict story.** Scene metadata and all contained piece mutations MUST use one scene revision as the atomic conflict boundary in 0.7. Each successful scene or piece mutation increments the scene revision exactly once and commits affected rows, audit event and operation receipt atomically. Piece identity remains independently stable; a separate piece revision MAY be included for diagnostics but MUST NOT allow a stale piece write to bypass the scene revision. Stale revision fails with no partial change.

**WS07-006 — Idempotency.** Every mutation MUST include authenticated principal, contract version, stable operation ID and expected scene revision (or a documented create precondition). Repeating the same operation ID and canonical payload returns its original outcome without duplicate change/event/cursor advance. Reusing the ID with a different principal or payload returns a stable mismatch error. A mutation receipt identifies affected IDs, resulting scene revision and event cursor.

**WS07-007 — Archive, restore and reference cleanup.** Archiving a scene is a revisioned GM command that preserves scene/piece identities, links, associations and image bytes for history and restore. Archived scenes are excluded from ordinary player reads, navigation, search and encounter default selection. Restore is explicit and revisioned. Deleting a piece is an explicit revisioned command with an audit event; referenced entities are not deleted. Removing a scene MUST NOT silently delete an encounter or Lore record. Dangling references resolve as unavailable and reveal no target metadata. Physical asset cleanup follows the managed-asset orphan policy in WS07-022.

### 2.2 Relationships, navigation and presentation

**WS07-008 — Typed destination-map links.** A versioned pin-to-map target contract MUST permit World→World, World→Battle, Battle→World and Battle→Battle navigation by stable target ID. Navigation cycles are allowed. A client follows one explicit user action at a time and MUST NOT recursively fetch a link graph. Link resolution is a host-authorized query returning only destination metadata currently visible to that principal; the source pin itself confers no access.

**WS07-009 — Encounter association.** A host-owned `MapEncounterLink` relates a scene and campaign encounter by stable IDs. An encounter MAY have at most one GM-chosen default scene; additional non-default scene associations are allowed if explicitly represented. The relation is not a permission grant. GM-only add/remove/default commands are revisioned and idempotent, and validate same-campaign live references. Encounter archive/missing state makes the relation unavailable but does not delete the scene; scene archive removes it from default resolution without erasing the relationship. Revoke or archive MUST produce a safe unavailable state in following clients.

**WS07-010 — Following and pinned selection.** A scene view can follow an explicitly selected encounter's GM-chosen default scene or pin a personal stable scene ID. Follow resolution uses the current authorized relationship and never changes campaign-wide active encounter context. Pinned selections re-query authorization on each load. Missing, archived, revoked or unauthorized references render a generic unavailable state without revealing existence or reason. App handoff may preserve a scene ID as navigation context, never as authority.

**WS07-011 — Viewport is client presentation state.** Pan, zoom, fit/crop and selection are local presentation state. They MUST NOT change shared scene or piece coordinates. Rendering MUST map the authoritative coordinate space to the viewport without writing transformed screen pixels back to the host. Viewport changes MAY be stored in the member's local Workspace preferences, isolated by member/profile.

**WS07-012 — Input, responsiveness and accessibility.** The map surface MUST support pointer, mouse, touch and keyboard for core selection, navigation and piece placement/movement available to the GM. All actions need keyboard-operable controls, visible focus, accessible names and non-drag alternatives. Responsive layouts MUST provide bounded fit/crop behavior, usable controls and empty, loading, error, unauthorized, offline and unavailable states. Players have no shared-write controls in 0.7.

**WS07-013 — Bounded resource limits.** Initial defaults are integer coordinate-space dimensions from 1 through 100,000 units per axis with width × height at most 1,000,000,000 coordinate units; square-grid cell width from 1 through 10,000 units; origin within the scene bounds; at most 10,000 pieces per scene; 1 MiB of metadata/text per scene including pieces; 10 MiB per image; 100 MiB total active map-image bytes and 100 active map images per campaign. Limits are enforced by the host at validation and commit, count deduplicated active bytes once, and are versioned. Oversized requests fail without partial rows, revisions, events or installed bytes. Adjusting these defaults later requires a versioned contract decision.

### 2.3 Visibility, authorization, and replay

**WS07-014 — Deliberate publication.** New scenes and pieces default to GM-only. Publication or revocation is an explicit GM-only revisioned command; editing content or uploading an image MUST NOT publish it implicitly. Scene and piece visibility are independently represented. A shared piece cannot make a GM-only scene visible. A player may receive a piece only inside a scene currently readable to that player and when that piece itself is shared.

**WS07-015 — Host filtering before serialization.** The host MUST filter current authorization before serialization for scene lists/details, piece lists, search and counts, link resolution, encounter association, image metadata/downloads, HTTP responses, SSE notifications, cursor replay, snapshots and errors. No client-side hiding is a security boundary. Hidden scene IDs/titles, private piece coordinates/labels/types, existence, counts, ordering effects, link counts, thumbnails, asset IDs/bytes, GM descriptions and derived data MUST NOT leak. Inaccessible and nonexistent resources use equivalent non-disclosing outcomes where existence is sensitive.

**WS07-016 — Redaction on map content and relationships.** A shared scene projection may contain its authorized title, dimensions, published grid, shared pieces and currently authorized references. A `gm` scene or piece MUST be omitted entirely from player results, not represented as a redacted placeholder. GM-private description is never player-visible. A public pin linking to a hidden or inaccessible scene exposes no destination ID, title, kind, thumbnail, count or hint. Actor and Lore references are resolved through their own current host permissions; placement in a shared map grants no access to the referenced actor or article.

**WS07-017 — Visibility changes and events.** Events carry stable operation identity and visibility classification, but every delivery and replay page is filtered using current policy. If an event's scene/piece has since become private, it is not disclosed to players merely because it was once shared. Publish may send a minimal newly authorized projection after commit. Revoke/archive uses a non-disclosing invalidation and must not include content or hidden identifiers. Cursor gaps are repaired from a current authorized snapshot; hidden-event counts and cursor positions must not be inferable from response shape.

**WS07-018 — Revocation and cached copies.** Revocation blocks subsequent host reads, link navigation, image requests, subscriptions and replay using current policy. Previously downloaded data cannot be recalled. Offline scene metadata, pieces and images are read-only cached copies, scoped to the authenticated member and campaign, tagged with last-authorized time/revision and shown as stale/offline when authority cannot be checked. Reconnection revalidates current policy before representing data as current. A cache MUST NOT be shared across member credentials or become an offline mutation queue.

### 2.4 Managed map images

**WS07-019 — Separate map asset contract.** Map images use host-managed `MapAsset` metadata and opaque asset IDs. They MUST NOT depend on a Lore article for ownership or privacy. A map asset belongs to one campaign and is readable only when the caller can read a currently active scene that references it. The background reference is optional; piece-level image references MAY be supported only through the same explicit contract.

**WS07-020 — Raster allowlist and safe ingestion.** Initial supported types are PNG, JPEG, GIF and WebP. SVG, HTML, scripts, PDF, archives, unknown media and animated content beyond the documented decoder/preview policy are rejected. The host detects type from bytes, not extension or request MIME; validates signatures and decodable dimensions/pixel bounds; enforces hard streaming and decompressed-size limits; normalizes unsafe filenames to display-only metadata or discards them; and serves with safe raster policy and `X-Content-Type-Options: nosniff`. Image bytes are never served from a static directory or opened using client paths.

**WS07-021 — Upload atomicity and deduplication.** Only GM may upload, replace, archive or restore map assets in 0.7. Uploads stream to host-controlled staging with a hard byte limit and computed SHA-256. The host validates actual raster type and quotas, then installs bytes under an opaque host-generated key and commits metadata/reference, scene revision, audit event and receipt using a recoverable staged protocol. Failure leaves no active metadata or orphan staged bytes. Identical bytes may be deduplicated within the campaign while retaining independent asset IDs/authorization references; same digest with different bytes is an integrity failure. Clients never choose filesystem paths.

**WS07-022 — Asset lifetime.** Removing or replacing the final active scene reference marks bytes eligible for orphan cleanup after a documented grace period of at least 24 hours. Cleanup is idempotent, audit-recorded, host-owned, and never follows client-supplied paths. Archived scenes and backups retain referenced bytes. A shared scene grants access only to its referenced map image after a fresh per-request authorization check. Revocation immediately blocks future downloads, even if the asset remains stored or another GM-only scene references it.

### 2.5 Migration, backup, and recovery

**WS07-023 — Additive schema migration.** Migration from the 0.6 database MUST be explicit, versioned, idempotent, transactional where supported, and exercised on disposable copies. It preserves all 0.6 campaign, Lore, link, asset, session, encounter, member/grant, receipt, event and cursor data and identifiers. A recoverable source backup is required before migration. Failure preserves source data and reports a recovery path. No synthetic maps or inferred links are created from Lore or encounter text.

**WS07-024 — Portable archive v5.** The next campaign archive format is v5. It includes MapScene and MapPiece records, encounter associations, map asset metadata, required audit/operation history and actual referenced raster bytes with lengths and SHA-256 digests. Archive integrity covers manifest, existing data and map image bytes. Restore validates versions, sizes/quotas, uniqueness, all same-campaign references, visibility enums, coordinate/grid bounds, image signatures/dimensions/hashes and asset references before modifying a destination. Restore remains new/empty-destination only; no merge or overwrite. Any failure leaves the destination empty and source untouched.

**WS07-025 — Backward compatibility.** The v5 importer MUST preserve existing supported v2, both fixture-pinned v3 layouts, and v4 archives without inventing maps or changing legacy IDs/data. v2–v4 payloads receive safe empty map collections on import. Unknown archive layouts or unsupported versions fail before destination mutation. Compatibility claims remain pinned to known fixtures; a version number alone is not evidence that an unknown layout is safe.

### 2.6 Typed contract sketches

These sketches specify semantic boundaries, not mandated wire spelling or programming language. All IDs are opaque, all reads are caller-authorized projections, and all writes are host validated.

```ts
type MapScene = {
  sceneId: string;
  campaignId: string;
  kind: "world" | "battle";
  title: string;
  width: number;
  height: number;
  backgroundAssetId: string | null;
  visibility: "gm" | "shared";
  gmDescription: string | null;
  grid: { kind: "none" } | {
    kind: "square";
    cellWidth: number;
    originX: number;
    originY: number;
    alignment: "origin_at_cell_corner";
  };
  archivedAt: string | null;
  revision: number;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
};

type MapPiece = {
  pieceId: string;
  sceneId: string;
  type: "location_pin" | "actor_token" | "note";
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  visibility: "gm" | "shared";
  layer: number;
  target?:
    | { kind: "map_scene"; sceneId: string; contractVersion: string }
    | { kind: "actor"; actorId: string }
    | { kind: "lore_entry"; entryId: string }
    | { kind: "encounter"; encounterId: string };
};

type MapEncounterLink = {
  sceneId: string;
  encounterId: string;
  isDefault: boolean;
  revision: number;
};

type MapAsset = {
  assetId: string;
  campaignId: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  revision: number;
};

type MapMutation = {
  operationId: string;
  expectedSceneRevision: number;
  contractVersion: string;
};
```

`type` is a fixed platform piece kind, not an arbitrary module-defined schema. Optional references are a closed, versioned target union. Implementations may extend the union only through a reviewed contract version and matching authorization rules.

Semantic queries include `listMapScenes`, `getMapScene`, `listMapPieces`, `searchMapScenes`, `resolveMapTarget`, `getEncounterMapScenes` and `getMapAsset`. GM commands include `createMapScene`, `updateMapScene`, `changeMapSceneKind`, `publishMapScene`, `revokeMapScene`, `archiveMapScene`, `restoreMapScene`, piece create/update/remove/reorder, map-encounter associate/remove/set-default, and begin/commit/abort map-image upload. Stable response errors distinguish validation, unauthorized/unavailable, revision conflict, duplicate operation mismatch, unsupported version/target, quota exceeded, unsupported media, payload too large, integrity failure and temporary unavailability. Errors never echo hidden titles, paths, bytes or private payloads.

### 2.7 Initial defaults and limits

| Contract | Initial value | Validation |
| --- | --- | --- |
| Scene width/height | 1–100,000 units each | Finite positive integers; product also capped at 1,000,000,000 coordinate units |
| Piece x/y | 0 through width/height | Finite; placement inside scene bounds |
| Square cell width | 1–10,000 units | Finite positive; no automatic distance semantics |
| Grid origin | Within scene bounds | Finite; alignment `origin_at_cell_corner` defines grid lines at origin + n × cell width |
| Pieces | 10,000 per scene | Host count, including archived pieces retained in the scene contract |
| Scene plus piece text/metadata | 1 MiB per scene | UTF-8 byte count, enforced at commit |
| Image | 10 MiB each; 100 MiB and 100 active assets per campaign | Actual bytes; dedup counts stored active bytes once |
| Raster dimensions | At most 16,384 px per axis and 100 megapixels | Decode before installation under bounded memory/time; GIF is normalized to a static first frame |
| Search | Default 25; max 100 | Authorized results/counts only; cursor opaque |

The world preset is `kind=world`, `grid=none`, no default encounter, location-pin creation prioritized. The battle preset is `kind=battle`, `grid=square` with cell width 100 units, origin (0,0), `origin_at_cell_corner`, and actor-token creation prioritized. These are defaults at creation only; later kind changes do not rewrite explicit settings or contents.

## 3. Authorization and transition summary

| Operation | GM | Player | Atomic effect |
| --- | --- | --- | --- |
| Create/update scene, change kind, grid, title, description | Allow | Deny | Scene revision + event + receipt |
| Publish/revoke/archive/restore scene | Allow | Deny | Visibility/archive revision + filtered invalidation/event + receipt |
| Create/move/label/reorder/remove piece | Allow | Deny | Scene revision + event + receipt |
| Associate/remove/default encounter link | Allow | Deny | Link + scene revision + event + receipt |
| Upload/replace/archive/restore image | Allow | Deny | Staged bytes + metadata/reference + scene revision + event + receipt |
| Read shared scene/piece/link/image | Full read | Only current authorized shared projection | No mutation; current policy applied before bytes |
| Follow/pin/view/pan/zoom | Personal view allowed | Personal view allowed | Client presentation state only |
| Replay event/cursor | Full authorized history | Current-policy-filtered history | No hidden event count/metadata |

The campaign GM retains private scene and piece access. Players can read only published scenes and shared pieces. No map relationship or visual placement grants actor, Lore or encounter access. Players cannot mutate shared map state in 0.7.

## 4. Acceptance scenarios

These are required implementation checks, not claims about current behavior.

1. Create a world scene using defaults; add a location pin linked to a second world scene, a Lore entry and an encounter. Create a battle scene using defaults; add an actor token. Confirm coordinates persist in scene units and viewport pan/zoom does not change them.
2. Change each scene kind in both directions. Confirm grid, piece IDs/coordinates, background asset, links, sharing and encounter associations remain byte-for-byte/identity stable except the kind and revision/audit metadata.
3. Verify grid origin/alignment and all coordinate, metadata, count, dimension and file limits at boundary and just beyond boundary. Invalid values, stale revisions, quota exhaustion and interrupted uploads leave state unchanged.
4. Attempt all four World/Battle navigation combinations, including cycles. Follow one explicit link and confirm no recursive fetch. Test missing, archived, private and cross-campaign targets with generic unavailable results.
5. Associate multiple scenes to one encounter, set exactly one default, replace it and remove it. Restart host and confirm links persist. Archive encounter/scene independently and verify no unintended deletion or unauthorized default resolution.
6. Publish a scene with a shared and GM-only piece. From two separate players, inspect UI and raw HTTP/SSE bytes, list/search results, counts, event replay, link resolution, image metadata and bytes. No private IDs, names, labels, coordinates, references, counts or image data are disclosed.
7. Revoke or archive a previously shared scene while players are connected and disconnected. Verify current reads and replay stop disclosure, clients mark cached copies stale, and reauthorization requires a fresh host response. Previously downloaded bytes are not represented as erased.
8. Upload allowed PNG/JPEG/GIF/WebP and reject spoofed MIME/extensions, SVG/HTML/PDF, malformed/truncated images, extreme dimensions/pixel bombs, oversized streams, traversal filenames, duplicate/hash mismatch and quota overflow. Interrupt at each staged commit step; restart and verify recovery leaves either one valid asset or no active asset/orphan.
9. Export a v5 archive containing private/shared scenes, all piece kinds, encounter links and raster bytes; restore into a new empty host. Validate identities, revisions, relationships, hashes and bytes. Corrupt every manifest/record/byte/reference boundary and prove destination remains empty.
10. Import supported v2, both v3 fixtures and v4; preserve existing 0.6 data and create no maps. Run migration from 0.6 on a copy, interrupt/retry and verify source backup, idempotence and preserved IDs/history.
11. Verify pointer/mouse/touch and keyboard operation, focus and accessible labels, responsive fit/crop, empty/loading/offline/unavailable states, GM/player permissions, and full-app/brick parity through the same adapters.

## 5. ADRs and implementation map

The requirements baseline records key decisions in [ADR-0014](adr/0014-map-scenes-and-pieces.md), [ADR-0015](adr/0015-map-links-and-encounter-associations.md) and [ADR-0016](adr/0016-managed-map-images-and-backup.md). These define the semantic contracts before implementation; they do not claim the application supports Maps.

Issue #70 is the specification task. Implementation tasks belong under parent [#69](https://github.com/chrspickens/Potomac/issues/69) and MUST use this reviewed, versioned contract. No implementation PR should invent coordinates, visibility behavior, image ownership or archive compatibility at the point of coding.
