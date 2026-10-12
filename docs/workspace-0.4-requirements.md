# Potomac Workspace 0.4 — First playable campaign requirements

**Status:** Proposed for review; prerequisite contract for implementation
**Version:** 0.4.0-draft.1
**Scope:** One locally hosted campaign, a GM and individually enrolled players, persistent characters and encounters, cross-app session flow, and a portable backup.
**Parent tracker:** [Issue #25](https://github.com/chrspickens/Potomac/issues/25)
**Specification issue:** [Issue #26](https://github.com/chrspickens/Potomac/issues/26)
**Implementation issues:** [#27 campaign setup](https://github.com/chrspickens/Potomac/issues/27) · [#28 Characters](https://github.com/chrspickens/Potomac/issues/28) · [#29 Encounters](https://github.com/chrspickens/Potomac/issues/29) · [#30 Workspace integration](https://github.com/chrspickens/Potomac/issues/30) · [#31 backup/restore](https://github.com/chrspickens/Potomac/issues/31) · [#32 acceptance automation](https://github.com/chrspickens/Potomac/issues/32)
**Related:** [Architecture](architecture.md) · [Engineering standards](engineering-standards.md) · [Module and rules specification](module-spec.md) · [Workspace 0.2 requirements](workspace-0.2-requirements.md) · [ADR index](adr/README.md)

> This document specifies intended behavior. It does not assert that the 0.3 prototype already supports campaign setup, full character CRUD, persistent encounters, or backup/restore. Those are implementation tasks. 0.3 remains a localhost experiment with a seeded `foundation-demo` campaign, fixture encounters, member enrollment, grants, filtered projections, SSE, and offline proposals/receipts.

## 1. Outcome and boundary

A GM creates one persistent local campaign, pins it to one exact installed game-system module version, enrolls two players, creates and grants characters, prepares encounters, and activates one encounter for a session. The GM and players use the same host-owned records through full applications and dashboard bricks. The host enforces permissions and revisions for every read and command. A GM can export the campaign and restore it into an empty isolated host without losing history or overwriting live data.

0.4 is a single-campaign-per-host milestone. It is not a multi-campaign manager, public hosting/authentication release, module marketplace, or complete virtual tabletop. A separate fresh-host compatibility run covers each fictional system; one campaign does not mix incompatible system schemas.

### Priorities

- **P0:** first playable workflow, persistent host state, module pinning, safe authorization, character/encounter lifecycle, active context, migration and restorable backup, deterministic acceptance automation.
- **P1:** usability and recovery improvements that do not weaken P0 correctness, such as richer search/filter controls and optional GM-facing backup affordances. A documented CLI may satisfy backup UX in P0.
- **Out:** multiple campaigns per host, cross-campaign moves, maps, combat automation, cloud backup, multi-host restore/merge, arbitrary module code, Internet exposure, and production identity/invitation infrastructure.

## 2. Ownership and core invariants

| Concern | Authority |
| --- | --- |
| Campaign configuration, installed modules, committed entities, memberships/grants, revisions, events, proposals, receipts, active encounter | Host database and validated host commands |
| Module schema, defaults, declarative UI, actions/rules | Exact campaign-pinned module version, validated by the host |
| Dashboard layout, brick placement/options, local selection | Per-member/browser Workspace preferences; never an authorization source |
| Pending offline operation and private draft | Member-scoped client store until host receipt; never committed campaign state |
| Authorization | Host policy applied before data or event transmission and again at command commit |

Every host-owned mutation is authenticated, authorized, schema/policy validated, based on a current revision, and idempotent by stable operation ID. A successful mutation increments the relevant revision and appends its audit event atomically. Repeating an operation ID with the same canonical request returns the recorded result; reusing it with a different request is rejected. Stale revisions return a conflict with safe current revision metadata and do not partially commit. Unknown and inaccessible resources use equivalent non-disclosing outcomes where revealing existence would leak private information.

All commands are typed contracts, independent of UI. Success and failure responses are stable, machine-readable envelopes. At minimum, outcomes distinguish `accepted`, `validation_error`, `unauthorized_or_unavailable`, `conflict`, `incompatible_module`, `duplicate_operation_mismatch`, and `unsupported_version`; validation details identify safe field paths without echoing secrets. Reads return caller-authorized projections, not storage rows. SSE remains a notification/replay mechanism as implemented in 0.3; clients reconcile by fetching an authorized snapshot/cursor. Transport changes are not required by this specification.

## 3. Single-campaign setup and configuration

The host contains zero or one configured campaign. First run has an explicit uninitialized state; opening or restarting the host must not silently create `foundation-demo`, reset an existing DB, or replace user content. A GM-only setup command creates a stable campaign ID, validated non-empty name, optional description, exact default `moduleId` and `moduleVersion`, setup state, revision, and timestamps. The host verifies that the exact module version is installed, valid, and compatible before accepting setup.

GM configuration reads return full campaign configuration. Player reads expose only approved metadata (stable campaign ID and display name; description only if configured public). They do not reveal setup secrets, module administration state, or private configuration. Name/description changes require GM authority and expected campaign revision. The pinned module cannot be changed through an ordinary edit. A future migration/upgrade workflow must be explicit, backed up, validated against all campaign entities and pending operations, auditable, and separately approved; 0.4 rejects a different or unavailable version rather than silently upgrading.

Campaign setup is one-time for an uninitialized host. Duplicate setup, concurrent setup, invalid module/version, or stale update cannot create a second campaign. Existing 0.3 databases are migrated in place without changing the campaign identity unexpectedly; the seeded `foundation-demo` is adopted once as the single campaign if no user-created campaign already exists. If ambiguous/corrupt state prevents safe adoption, startup fails with a recovery instruction and preserves the original DB for backup/manual recovery.

## 4. System module and character contracts

The campaign pins one exact `(moduleId, moduleVersion)` pair. Every character stores that pair, its schema version, stable ID, revision, and validated module data. The generic Characters app asks the registry/host for the pinned module manifest, character schema, declared defaults, UI controls, and actions. Creation applies module defaults through the host contract, then validates the complete record. Edit accepts only explicitly editable fields/actions permitted by both the module declaration and host policy; clients cannot submit arbitrary replacement JSON or overpost GM-only fields. The host validates module identity/version/schema, action parameters, authorization, and revision again at commit.

The same generic form and host path must create and edit both fictional modules in separate fresh campaigns. Modules contribute field names, control types, defaults, and bounded declared actions. Platform and Workspace code contain no branches on fictional system IDs. System B support proves the platform is system-neutral; it does not authorize mixing System A and B records in one campaign.

If the pinned module or required schema is missing, corrupt, or incompatible, the host fails closed for writes and reports a stable compatibility error; existing records remain available for safe backup/export and non-mutating inspection where possible. It must not guess a replacement version, rewrite records, install code, or run module-provided executable code. Existing module versions remain available to interpret data; migration is an explicit, separately reviewed operation. Unknown module/schema versions in a backup are rejected before restore commit.

Character ownership is represented by host enrollment/grant records. The GM may create, edit, assign, grant/revoke read and act capabilities, and archive a character. A player may read/act only on actors authorized by current membership and explicit actor permissions. Assignment does not grant permission to unrelated actors. Archived actors are excluded from ordinary pickers and new encounter participation, but history and references remain resolvable. Destructive deletion is out of scope; archive/deactivate is the lifecycle operation.

Player projections omit GM-only fields before serialization, including nested fields, derived values dependent on hidden values, search/filter results, snapshots, event payloads, and offline cache responses. Forbidden and nonexistent actor requests must not provide a reliable existence oracle. Existing 0.3 `gmOnly` visibility declarations remain honored and are further restricted by member grants. Revocation immediately blocks future host reads, writes, subscriptions, proposal decisions, and replay for that member. Already downloaded copies cannot be remotely erased and remain a documented local-data risk.

## 5. Encounter and session lifecycle

An encounter is a persistent campaign resource with stable ID, title, public/player-visible summary, optional GM-only preparation notes, visibility, participant actor IDs, lifecycle (`planned`, `active`, `completed`, or archived), revision and created/updated metadata. The GM creates, lists, edits, adds/removes existing eligible participants, activates, completes, and archives through typed, revisioned commands. Players receive only encounters and fields they are authorized to know, and encounter summaries include only permitted participants. Secret encounters must not be exposed by list counts, search, event replay, SSE, or error differences.

Only one encounter may be active for the campaign session. `session.activeEncounter` is a nullable stable encounter ID controlled by the GM; it is context, never a grant. Activation atomically sets lifecycle/context and emits the relevant event. Ending/completing the active encounter clears context atomically. Activating another encounter transitions the previous one to planned or completed according to an explicit GM action; the host must not silently complete it. Repeating an identical activation command is idempotent. Invalid IDs, inaccessible references, stale revisions, archived encounters, and completed encounters cannot be activated. The GM must explicitly reopen a completed encounter before reactivation.

Participants must be existing, non-archived campaign characters compatible with the pinned module and eligible under host policy. Archiving a participant is rejected while an active encounter references it until the GM removes it or ends the encounter; planned encounters may retain a historical reference but cannot start with unavailable participants. No operation silently recreates a missing actor. Completion preserves participants and event history. Fixture encounter IDs from 0.3 migrate to persistent encounter records while preserving whichever ID is currently active; ambiguous references block safe migration rather than being dropped.

The `encounters.summary` brick and full Encounters app use the same authorized read/command adapters. Follow bindings resolve the current authorized active encounter; pinned bindings remain attached to their configured stable reference. Binding edits, forged layout data, and local profile names never expand permissions. Null, archived, deleted/inaccessible references render safe unavailable/empty states without disclosing why.

## 6. Typed command and response surface

Exact wire names may be finalized during implementation, but these semantic operations and guarantees are required. All write requests carry `operationId` and `expectedRevision` (or an explicitly documented create precondition); identity comes from the authenticated principal, never a body-supplied role/member ID.

| Area | Required operations | Required response/projection |
| --- | --- | --- |
| Campaign | `getCampaign`; `createCampaign`; `updateCampaign` | Role-filtered campaign projection; stable ID, exact pinned module pair, setup state and revision for GM; safe public metadata for players |
| Characters | `listCharacters` with authorized search/filter; `getCharacter`; `createCharacter`; `updateCharacter`; `assignCharacter`/`setActorGrant`; `archiveCharacter` | Authorized module-driven projection, revision and module/schema provenance; safe validation/conflict/permission outcomes |
| Encounters | `listEncounters`; `getEncounter`; `createEncounter`; `updateEncounter`; `setParticipants`; `activateEncounter`; `completeEncounter`; `archiveEncounter` | Role-filtered summary/details, authorized participants, lifecycle and revision; session active ID in snapshot |
| Session | `getSession`; `activateEncounter`/`endEncounter` as GM commands | Nullable stable active encounter reference and cursor/revision; filtered event notifications |
| Backup | `exportCampaign`; `inspectBackup`; `restoreCampaign` to empty destination | Versioned manifest/integrity result; compatibility and validation errors before activation; restore receipt with new host/campaign identity mapping if needed |

`createCharacter` and `createEncounter` require an idempotent create operation ID and host-generated or validated stable ID. Updates use expected revision. Multi-record operations (grant+assignment where atomic, participant updates, activation/context transition, event+state, restore import) either commit fully or leave state unchanged. Offline 0.3 operations preserve their identity scope, base revision, module/schema provenance and existing receipt/proposal behavior; reconnection revalidates against current grants, lifecycle, revision and pinned module. A local pending state never appears in authoritative reads or events.

## 7. Migration from 0.1–0.3 fixture data

SQLite schema changes must be ordered, versioned, transactional where SQLite permits, repeatable after interruption, and tested against disposable copies of representative 0.1/0.2/0.3 databases. The migration test copies a legacy DB to a temporary location, records pre-upgrade counts/hashes for actors, module registrations, members/grants, events/cursors, operations, proposals, decisions and receipts, upgrades the copy, then verifies IDs, records, relationships, event ordering, deduplication outcomes and authorization semantics. The real user DB is never used by automated tests.

Migration requirements:

1. Take or require a recoverable byte-for-byte SQLite backup before schema migration; use SQLite's online backup/snapshot facility where available so WAL state is included consistently.
2. Apply explicit schema versions and transaction boundaries. On failure, retain the original DB and report the failed migration/version; never delete/reinitialize tables to recover.
3. Preserve stable IDs, exact operation IDs and stored responses, cursor/event history and timestamps. New optional provenance may be nullable only with a documented legacy interpretation.
4. Adopt `foundation-demo` only when the database has no configured user campaign; do not create duplicate campaigns on repeat startup. Preserve existing module/actor versions and do not claim an implicit module upgrade.
5. Convert the two fixture encounters into persistent records using their existing stable IDs and preserve active context. If legacy references cannot be reconciled, stop and give a recovery path.
6. Preserve 0.3 member credential hashes, revocation state, actor grants, proposal decisions and receipts. Never turn legacy shared-role permissions into broader member grants; preserve or reduce ambiguous legacy access according to the least-privilege migration rule and record the conversion.
7. Migration tests cover fresh DB, each supported legacy fixture, interrupted/retried migration, malformed legacy content, duplicate IDs, unknown module versions, and data-count/integrity checks.

No migration may silently reset data or erase event history. Destructive cleanup, compaction, credential export, or automatic module conversion is outside 0.4.

## 8. Backup artifact and safe restore

The export is a versioned archive with a manifest containing format version, minimum/maximum supported Potomac data version, campaign ID, exact pinned module IDs/versions, creation timestamp, declared collections, byte sizes, and cryptographic integrity digests for each payload. The manifest digest is computed over a canonical manifest with its digest field omitted, avoiding self-reference. Digests detect accidental/tampered content but do not authenticate the exporter. The archive must represent one consistent SQLite snapshot taken while writes continue safely or while the host briefly coordinates a transactionally consistent snapshot.

Included authoritative data: campaign configuration; installed module manifests needed to identify dependencies (not executable packages); enrolled member IDs/display names/credential hashes/revocation state; actor grants and visibility; characters and revisions; encounters, participant references, session active context; operations and durable responses; offline proposals/decisions/receipts; and ordered authoritative event history/cursors. Plaintext bearer credentials, environment secrets, host tokens, logs containing secrets, local browser layouts, cached projections, offline private drafts, and unsubmitted client queue items are excluded. If campaign credentials are restored, their bearer hashes remain sensitive; restore must explain that players may need GM-led credential rotation/re-enrollment. Exports contain private campaign content and must show a sensitivity warning before writing.

Restore is allowed only into an explicit empty/isolated host destination. Before changing destination state, verify archive size/structure, manifest and supported format/data versions, digests, all referenced collections, module compatibility availability, schemas, IDs, foreign references, event/operation uniqueness, and that destination has no campaign data. Then import atomically or stage in a temporary database and activate only after full validation. Any failure leaves destination empty and source untouched. A non-empty destination is refused; there is no overwrite flag in 0.4. Missing exact module versions or unsupported format/schema produce actionable errors, never automatic module substitution.

Round-trip semantics preserve campaign records, revisions, members/grants, encounters/context, proposal outcomes, operation receipts and event cursors. The restored host follows normal authorization rules. Deployment-specific campaign/host identity must be regenerated or explicitly mapped to avoid operation/campaign namespace collisions; any mapping is recorded in the restore receipt and must not alter entity IDs without a documented reference-preserving migration. Integrity digests are not encryption: users must store backups securely.

## 9. Acceptance workflow and deterministic tests

The primary journey is called **The Ashen Road** and must run without hand-edited DB rows or pre-seeded actors/encounters:

1. On an empty disposable host, GM creates campaign “The Ashen Road”, pins System A at an exact installed version, restarts the host, and verifies the campaign persists.
2. GM enrolls Player A and Player B with distinct credentials. GM creates two System A characters through the Characters UI using module defaults/schema, edits them, assigns one to each player, and configures explicit read/act grants.
3. GM creates “The Glass Bridge”, adds both characters as participants, saves it as planned, and sees it survive restart.
4. GM activates the encounter. Both players see only their authorized summary/participants; their `session.activeEncounter` followers update. A pinned Character brick and both independently saved dashboard layouts remain unchanged.
5. Player A performs an allowed action; host commits once and full app, brick and activity converge. A stale edit conflicts. A retried identical operation returns its prior receipt. Player B cannot read/act on Player A's private actor. GM revokes a grant and Player A loses future reads, writes, event replay and subscription access; cached prior data is acknowledged as a local copy.
6. GM ends/completes the encounter, restarts the host, and verifies character revisions, lifecycle, active context, grants, events, proposals and receipts.
7. GM exports with a visible sensitivity warning. The test validates the manifest/digests, restores into a second empty disposable host, and compares authorized projections plus records/history. Corrupt digest, unsupported backup version, missing module version, and non-empty destination each fail without partial writes.

Run the same campaign creation and generic character create/edit path on a separate clean System B host. This proves both module compatibility and single-system-per-campaign isolation.

### Acceptance criteria (unique IDs)

| ID | Scenario | Pass condition |
| --- | --- | --- |
| C04-01 | Empty host setup/restart | One GM-created campaign persists with exact module pin; no implicit demo bootstrap or duplicate setup |
| C04-02 | Second-system compatibility | Fresh System B campaign uses the same shell/form/host contracts as System A |
| C04-03 | Campaign permissions | GM edits configuration; players receive only approved metadata; crafted player setup/update is rejected |
| C04-04 | Character create/edit | Schema defaults and UI create/edit both systems; invalid/hidden overpost and incompatible version leave state unchanged |
| C04-05 | Ownership and grants | Two members receive only explicitly granted read/act rights; revoked access fails on every read/write/replay/stream path |
| C04-06 | Encounter lifecycle | GM creates, edits, adds existing participants, activates, ends/completes and archives under revision checks |
| C04-07 | Context and bindings | A→B activation updates followers; pinned reference and local layout stay fixed; forged binding gives no added access |
| C04-08 | Non-disclosure | Hidden fields, derived data, secret encounters and inaccessible actor existence are absent from API, events, search and errors |
| C04-09 | Revisions/idempotency | Stale writes conflict; same ID+payload replays result; same ID+different payload rejects; no duplicate event |
| C04-10 | Offline compatibility | Existing 0.3 queue/proposal/draft semantics survive; reconnection revalidates current permission, revision and module pin |
| C04-11 | Legacy migration | Disposable copies of supported 0.1–0.3 DBs upgrade with IDs/history/grants/receipts preserved; failure never resets source |
| C04-12 | Backup round trip | Populated Ashen Road export restores into empty isolated host with records, grants, outcomes, revisions and cursors intact |
| C04-13 | Backup negative paths | Corrupt/unsupported/incompatible backup and non-empty destination fail before commit; destination/source remain unchanged |
| C04-14 | Atomic state/event | Injected failure in multi-record mutation or restore leaves no partial data/event/context |
| C04-15 | Three-party automation | Disposable host + GM + two individually enrolled browser clients execute the journey and both systems; failures return nonzero with actionable diagnostics |

Automation uses only temporary DBs/directories, loopback listeners, fictional fixtures and development credentials. It must never read/write the developer's real DB. `pnpm check` integration is required by #32; exact command and observed outcomes are reported by its implementation PR.

## 10. Compatibility, risks and unresolved implementation details

0.4 adds public host capabilities and changes persistence. Existing 0.3 `/api/state`, `/api/actors`, `/api/context`, action and offline receipt/proposal contracts must either remain backward-compatible through adapters/versioned envelopes or be deliberately versioned with clients/tests upgraded together. Never change meaning of an existing field silently. The exact error envelope and archive container encoding may be selected during implementation, but must satisfy the semantic requirements above and be documented before the first data-model PR merges.

Primary risks are migration ambiguity in old fixture DBs; visibility leaks through search, derived values or events; archived references in active encounters; exact module availability for restore; and accidentally exporting bearer credentials or private client drafts. These require negative acceptance cases, not just happy-path UI checks.

### Issue mapping

| Implementation issue | Requirements |
| --- | --- |
| [#27 Campaign setup and pinning](https://github.com/chrspickens/Potomac/issues/27) | Sections 3, 7; C04-01, C04-02, C04-03, C04-11 |
| [#28 Characters](https://github.com/chrspickens/Potomac/issues/28) | Sections 4, 6; C04-04, C04-05, C04-08, C04-09 |
| [#29 Encounters](https://github.com/chrspickens/Potomac/issues/29) | Sections 5, 6; C04-06, C04-07, C04-08 |
| [#30 Workspace integration](https://github.com/chrspickens/Potomac/issues/30) | Sections 4–6, 9; C04-05 through C04-10 |
| [#31 Backup/restore](https://github.com/chrspickens/Potomac/issues/31) | Sections 7–8; C04-11 through C04-14 |
| [#32 Acceptance automation](https://github.com/chrspickens/Potomac/issues/32) | Section 9; C04-01 through C04-15 |

## 11. Decisions recorded

- [ADR-0004 — One campaign per host and exact system pin](adr/0004-single-campaign-and-system-pin.md)
- [ADR-0005 — Host authorization and entity visibility](adr/0005-host-authorization-and-entity-visibility.md)
- [ADR-0006 — Encounter lifecycle and session activation](adr/0006-encounter-lifecycle.md)
- [ADR-0007 — Legacy migration and backup/restore safety](adr/0007-migration-and-backup-restore.md)

