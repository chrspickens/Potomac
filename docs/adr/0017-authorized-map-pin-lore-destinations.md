# ADR-0017: Resolve map-pin Lore destinations at the host boundary

- Status: Accepted
- Date: 2026-10-13

## Context

Map location pins may navigate to another map or to a Lore article. A target reference must not become an authorization grant: a shared pin can point to GM-only, archived, missing, or later-revoked Lore. Map projections are also cached offline and delivered through HTTP and the event stream.

## Decision

Store a Lore destination as a typed, stable Lore entry ID associated with a map pin. Keep the relationship separate from the pin row so existing map records and map-to-map links remain compatible. The host resolves each Lore target using the existing Lore read policy before constructing a player map projection. If the player cannot currently read the target, the projection contains no Lore destination fields; it does not contain a placeholder ID, title, count, backlink, or other target metadata. The GM may create, change, or remove a Lore destination through a revisioned Maps command.

Lore-target changes and access changes notify players through an opaque permissions-refresh event. Replay and direct reads re-evaluate current authorization. A previously downloaded offline article or map is an unavoidable stale copy; after reconnection, clients refresh authorized projections and mark any retained offline data according to the existing stale-cache policy.

Portable v5 backups include the relationship collection. Older v5 backups without that collection remain importable, and older backup versions retain their existing migration path.

## Consequences

Navigation is typed rather than inferred from labels, and the Lore ID remains stable across edits and backup/restore. Authorization stays centralized in the host Lore policy. Security tests must inspect raw map responses, image and article requests, event streams/replay, offline storage and rendered UI independently; hiding a button in the client is insufficient.

The destination is not a permission grant and does not change the active encounter. Revocation prevents future host-authorized reads but cannot erase bytes already copied to a disconnected device.

## Validation

See issue [#84](https://github.com/chrspickens/Potomac/issues/84), issue [#69](https://github.com/chrspickens/Potomac/issues/69), and the Maps browser acceptance evidence produced for this change.
