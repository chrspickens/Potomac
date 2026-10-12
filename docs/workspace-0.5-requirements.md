# Potomac Workspace 0.5 — Live Session and Table requirements

**Status:** Proposed for implementation; requirements baseline for review  
**Version:** 0.5.0-draft.1  
**Scope:** Host-owned live session and Table projections/actions for the existing one-campaign host, including GM plus two enrolled players, verified module actions/rolls, durable timeline, Workspace integration and reconnect.  
**Specification issue:** [#35](https://github.com/chrspickens/Potomac/issues/35) · **Milestone:** [#34](https://github.com/chrspickens/Potomac/issues/34)  
**Related:** [Workspace 0.4 requirements](workspace-0.4-requirements.md) · [Architecture](architecture.md) · [Engineering standards](engineering-standards.md) · [Module and rules specification](module-spec.md) · [ADR-0010](adr/0010-durable-table-session.md)

> This is a target contract, not evidence that `main` implements 0.5. The host is local-first, loopback-only and contains at most one campaign. Contracts below are semantic; wire names and exact encoding may be fixed during implementation without weakening these guarantees.

## 1. Outcome and boundaries

Potomac 0.5 gives one GM and individually enrolled players a shared, restart-safe Table session over campaign-owned Characters and Encounters. The host owns session status, authorization, action evaluation, verified randomness, committed results, event history and replay filtering. The full Table app and registered Workspace bricks use the same host contracts and authoritative data.

The milestone remains one campaign per host, one exact pinned module version per campaign, localhost/loopback only and no cloud account or sync requirement. It adds no multi-campaign switching, public hosting, maps, automatic initiative/round/turn engine, universal HP/damage model, executable modules, or independent Table copy of character/encounter state.

## 2. Numbered requirements

### 2.1 Session, encounter and participation

**WS05-001 — Durable session.** The host MUST persist session state as a versioned resource with stable ID, campaign ID, revision, timestamps and lifecycle history as specified in [ADR-0010](adr/0010-durable-table-session.md). A session record MUST survive host restart and backup/restore.

**WS05-002 — Session status.** Session status MUST distinguish `idle`, `active`, `paused` and `ended`. Only the GM may start, pause, resume or end the session. Valid transitions are `idle → active`, `active → paused`, `paused → active`, and `active|paused → ended`; repeated commands with the same operation identity return the original result. An ended session is terminal; starting again creates a new durable session while retaining prior history. Invalid transitions and player attempts leave state unchanged.

**WS05-003 — Encounter remains separate.** Encounter preparation and lifecycle remain on the existing encounter resource. A session may reference a current encounter, but changing session status MUST NOT silently complete, reopen or otherwise rewrite encounter lifecycle. Encounter selection/context is never a permission grant.

**WS05-004 — Participation status.** Each enrolled member's authorized participant projection MUST distinguish at least `not_joined`, `joined` and `disconnected` (connection presence is transient and may be `unknown` after restart). Participation is session-scoped and not a character grant. The GM may inspect the roster; players may see their own participation and only permitted public roster fields. Reconnection does not duplicate participation or confer actor access.

**WS05-005 — Workspace context.** `session.activeEncounter` MUST be a derived, read-only compatibility context reference to the encounter selected by the current durable session. Follow bindings resolve it under the viewer's authorization; pinned/local selections remain personal and unchanged. Layout, binding, selection and brick IDs MUST NOT grant permissions or modify host session state.

**WS05-006 — One-campaign boundary.** Session resources and all referenced entities MUST belong to the host's one configured campaign and its exact pinned `(moduleId, moduleVersion)`. Cross-campaign references, unavailable versions and incompatible schemas fail closed.

### 2.2 Host contracts and atomicity

**WS05-007 — Typed commands and identity.** Session, participant, action and roll writes MUST use typed host commands with authenticated principal, stable `operationId`, expected resource revision (or documented create precondition), and module/action version where relevant. Actor/member identity and role come from authentication, never client-supplied authorization fields.

**WS05-008 — Durable Table snapshot.** `getTableSnapshot` MUST return an authorized, host-readable snapshot with campaign/session IDs, session status/revision, permitted current encounter reference, caller's participation projection, authorized participant summaries, relevant module/action descriptors, timeline high-water cursor and server schema/version metadata. The snapshot MUST be assembled from committed host state and filtered before serialization. It MUST NOT expose database rows, hidden fields, inaccessible entities, raw secrets, another member's private state or client pending operations.

**WS05-009 — Session controls.** `startSession`, `pauseSession`, `resumeSession` and `endSession` MUST be GM-only, revision-checked commands. They MUST atomically commit the status transition, session revision, durable audit/timeline event and operation receipt. Failure at any stage leaves all unchanged.

**WS05-010 — Participant projection.** `listTableParticipants` MUST return only members/actors authorized for the caller and only fields safe for that role. Player selection MUST be limited to explicitly granted actors and eligible current-session participants. A forged actor ID, encounter ID, binding or client-provided role MUST not expand read/action authority. Nonexistent and inaccessible resources MUST have equivalent non-disclosing outcomes where existence itself is sensitive.

**WS05-011 — Module-defined action invocation.** `invokeModuleAction` MUST identify an action declared by the exact campaign-pinned module version and validate parameters against its registered contract. The host loads current authoritative state, checks actor and target grants, session/encounter state, revisions, action availability and declared rule bounds, then evaluates the existing bounded rules engine. Client-supplied effects or computed totals are never trusted. Module definitions remain declarative; no arbitrary module code execution or ambient filesystem/network/Node access.

**WS05-012 — Verified-roll receipt.** When a declared action requests randomness, only the host generates it. A durable receipt MUST bind operation ID, actor, action/module/rules version, generated inputs/results, outcome, event/cursor and committed revision. A retry with the same operation ID and canonical payload returns the original receipt without rerunning randomness; a changed payload with a reused ID is rejected. Unverified/offline dice MUST remain visibly unverified and cannot be presented as accepted session outcomes.

**WS05-013 — Timeline and audit.** `getSessionTimeline` MUST return an ordered cursor-based projection of committed session events, including permitted lifecycle changes, participation changes, accepted actions and verified-roll receipts. Events MUST identify actor, time, entity/action, operation ID, resulting revision, module/rule provenance and visibility classification as appropriate. Corrections append a compensating event; history is not silently rewritten. A timeline event and its corresponding state/receipt commit atomically.

**WS05-014 — Idempotency and conflicts.** For the same operation ID and canonical payload, the host MUST return the recorded outcome without duplicate state change, roll, event or cursor advance. Reuse with a different payload MUST produce a stable mismatch error. Stale revisions MUST produce a conflict and safe current revision metadata without partial commit. Error envelopes MUST distinguish validation, unauthorized/unavailable, conflict, duplicate mismatch and incompatible/unsupported version without echoing secrets.

**WS05-015 — Reconnect cursor.** Timeline subscriptions/notifications MUST provide a monotonic durable cursor. Notifications are hints; after disconnect or cursor gap the client requests an authorized snapshot and replays events after its last acknowledged cursor. Replay is ordered, deduplicated and filtered under current authorization. A revoked member cannot use an old cursor to recover newly forbidden data. Cursor expiry/unknown version triggers a fresh authorized snapshot with an explicit recovery reason.

**WS05-016 — Version mismatch and recovery.** Clients MUST declare supported contract/schema versions. The host MUST reject incompatible writes before mutation and return a stable `unsupported_version` or `incompatible_module` result with safe remediation metadata. Clients encountering unsupported snapshot/event versions MUST stop applying that stream, preserve last committed display, show a recoverable compatibility state, and request a supported snapshot or user-directed upgrade. No silent downgrade, data rewrite or guessed module substitution.

**WS05-017 — Workspace parity.** The full Table application and registered `table.session`, `table.participants` and `table.activity` bricks MUST call the same authorized query/command adapters. Brick visibility, binding and selection MUST NOT alter permissions. App handoff preserves campaign, session and authorized participant context.

### 2.3 Authorization and redaction

**WS05-018 — GM capabilities.** The GM may read complete campaign/session configuration, private encounter preparation and GM-only fields; manage session lifecycle and participant roster; view all campaign participants/entities; invoke actions only when permitted by the module/host rules; and inspect full audit history. GM authority remains application-level and does not claim secrecy from the host machine administrator.

**WS05-019 — Player capabilities.** A player may read their role-filtered session projection, their own participation, explicitly permitted participant summaries and fields, and events/actions authorized for them. They may join/leave only if the host policy exposes that operation. They may invoke only actions allowed by the current module, session state and explicit actor/target grants. Players cannot control session lifecycle, alter campaign/module configuration, grant access, inspect GM-only preparation, or read another player's private drafts/credentials.

**WS05-020 — Filter every read path.** Authorization and redaction MUST apply before serialization to Table snapshots, participant lists, action descriptors/results, timeline pages, event notifications, replay, search, relations and errors. Hidden fields and values derived from hidden data MUST be removed. Raw HTTP/SSE responses MUST never include forbidden material for later client-side hiding.

**WS05-021 — Revocation.** Grant or membership revocation MUST block subsequent queries, commands, subscriptions and replay using current host policy. Previously downloaded/cached data cannot be recalled; clients MUST label it as a local copy and MUST NOT represent it as current host-authorized state.

## 3. Semantic contract shapes

These shapes are illustrative required fields, not a mandated serialization library. Every projection is role-filtered; all writes are host-validated.

```ts
type TableSession = {
  sessionId: string;
  campaignId: string;
  status: "idle" | "active" | "paused" | "ended";
  currentEncounterId: string | null;
  revision: number;
  schemaVersion: string;
  startedAt: string | null;
  endedAt: string | null;
};

type ParticipantProjection = {
  memberId: string;              // stable opaque identity, only if visible
  participation: "not_joined" | "joined" | "disconnected" | "unknown";
  actors: AuthorizedActorSummary[];
};

type TableSnapshot = {
  contractVersion: string;
  session: TableSession;
  participants: ParticipantProjection[]; // filtered per caller
  actions: AuthorizedActionDescriptor[];
  cursor: string;
};

type CommandEnvelope = {
  operationId: string;
  expectedRevision: number;
  contractVersion: string;
};

type VerifiedRollReceipt = {
  receiptId: string;
  operationId: string;
  actorId: string;
  actionId: string;
  moduleId: string;
  moduleVersion: string;
  rulesVersion: string;
  inputs: RecordedRandomInput[];
  result: unknown;               // module-defined, schema-validated result
  committedRevision: number;
  eventCursor: string;
};

type TimelinePage = {
  events: AuthorizedTimelineEvent[];
  nextCursor: string;
  hasMore: boolean;
};
```

`unknown` payloads above are constrained by the pinned module's registered schema and host validation; they are not permission to accept arbitrary effects. Events and receipts expose only fields authorized for the requesting principal.

## 4. Transition and authorization matrix

| Operation | State/precondition | GM | Player | Required atomic result |
| --- | --- | --- | --- | --- |
| Start | idle; valid campaign/module | Allow | Deny | active status, revision, event, receipt |
| Pause | active | Allow | Deny | paused status, revision, event, receipt |
| Resume | paused | Allow | Deny | active status, revision, event, receipt |
| End | active or paused | Allow | Deny | ended status, revision, event, receipt |
| Start after ended | prior session terminal | Allow; creates new session ID | Deny | new durable session; old history retained |
| Join/leave | policy allows; member enrolled | Manage roster | Self only if enabled | participation revision/event |
| Select participant | actor explicitly authorized and eligible | Allow | Own/granted actor only | member-local selection; no shared grant/context write |
| Invoke action | active session; descriptor available; current revision | Per action policy | Explicit actor/action grant | host evaluated effect, optional roll receipt, event, revision |
| Read snapshot/timeline | caller authenticated | GM projection | Filtered projection | no state mutation |
| Replay cursor | valid/retained cursor and current grant | GM projection | filtered as of current policy | ordered authorized events or snapshot recovery |
| Invalid transition / stale version | any | Reject | Reject | no partial state, audit outcome only where safe |

An encounter may be selected while a session is idle or active if GM policy permits; pausing/ending a session does not silently change encounter lifecycle. The exact allowed encounter-selection timing must be made explicit in UI and tests, but it cannot bypass session status or action policy.

## 5. Browser acceptance scenarios

These scenarios are normative and must run against an isolated disposable host/database, real browser clients and loopback transport. Do not rely on pre-seeded campaign entities or hand-edited database rows. The same generic flows run against separate fresh System A and System B campaigns.

### BA05-01 — Fresh campaign and second system

1. Start a genuinely empty host; verify no demo campaign is silently created. GM creates “The Ashen Road”, pins exact System A version, enrolls Player A and Player B independently, creates one character per player through the module schema, and prepares “The Glass Bridge”.
2. Start the session, add/verify authorized participants, and check all three clients show the same committed session ID/status after refresh/restart. Player A and Player B retain distinct dashboard layouts.
3. Repeat creation, participant and declared-action contract checks on a separate fresh host pinned to fictional System B. No app/Workspace branch may depend on system name; module differences come from versioned declarations.

### BA05-02 — GM lifecycle and invalid transitions

1. GM starts (`idle → active`), pauses, resumes and ends the session. Each accepted transition increments revision once and appears in timeline for authorized clients; restart preserves status and history.
2. Player A attempts every session-control command, including a forged GM role. Each is rejected without changing status, revision, event count or cursor.
3. Repeat each accepted operation ID/payload and observe the original result with no duplicate event. Reuse an ID with a changed payload and observe a stable mismatch error. Submit a stale revision and verify conflict with no partial commit.
4. Attempt resume/start from invalid terminal states and verify rejection. Starting a later session creates a new ID and does not overwrite the ended session history.

### BA05-03 — Role-filtered Table and Workspace views

1. GM, Player A and Player B open Table, `table.session`, `table.participants` and `table.activity` views. Each uses the same host-owned state, while layouts and personal selection remain independent.
2. Give Player A access to A's character and not B's private character. Check rendered UI and raw HTTP/SSE payloads, snapshot, participant list, search, timeline and replay: B's actor ID/fields and GM-only encounter notes are absent for A. Attempt direct IDs, forged bindings and guessed context references; results do not disclose inaccessible existence or grant access.
3. Revoke A's grant while connected. Future reads, action submissions, subscriptions and cursor replay deny access under current policy. The UI labels previously cached information as a local copy; it does not claim deletion from the browser.

### BA05-04 — Module action and verified roll

1. Player A invokes a permitted action declared by the pinned module. Verify the host validates parameters/current revisions/grants, evaluates the declarative rule once, and emits one committed result.
2. For a roll action, inspect the durable receipt and timeline; the random input is host-generated and bound to operation, actor, module/rules version and committed revision. Full Character view, Table, activity and bricks converge to the same result.
3. Attempt an undeclared action, incompatible module version, forged computed effect, unauthorized actor/target and unverified client dice. Each fails safely or remains explicitly unverified; no accepted state/event/receipt is created.
4. Retry the successful command after response loss using the same operation ID. The exact receipt/result returns and no reroll, second event or duplicate effect appears.

### BA05-05 — Secret-event filtering and replay

1. GM creates a private event or action detail and Player B disconnects before it occurs. Player B reconnects from an earlier cursor. Snapshot/replay includes only events and fields authorized to B at replay time; raw responses contain no hidden payload, count, derived leak or reliable existence oracle.
2. Verify cursor order and continuity for allowed events. Force a cursor gap/expiry and recover by an explicit authorized snapshot without double-applying actions. Revoke membership before replay and verify old cursor cannot recover new data.

### BA05-06 — Version mismatch and migration

1. Connect a client with unsupported contract/event version. It stops applying incompatible data, preserves its last committed view, displays recovery guidance and performs no write. Host rejects stale/incompatible writes before mutation.
2. Upgrade a copy of legacy data with null `context.activeEncounter`: preserve identities/history and produce idle session with no encounter.
3. Upgrade a copy with a valid active encounter ID: preserve that exact ID as the session reference, preserve encounter lifecycle, and migrate session as idle because legacy data did not prove an active play session.
4. Upgrade copies with dangling, malformed or conflicting references and interrupted migration. Migration fails without changing the source; a retry is idempotent after remediation. No encounter/event/roll is synthesized or discarded.

### BA05-07 — Fictional system neutrality

Run the applicable scenarios in a fresh System B campaign using an intentionally different declared action/result schema from System A. The shared app and contracts render/validate module declarations without introducing universal rounds, initiative, HP, damage or system-name conditionals.

## 6. 0.4 prerequisite debts and gates

The following inherited issues remain independently verifiable; 0.5 tests MUST NOT mask them with fixtures or silently close their original acceptance criteria. Track implementation in [#36](https://github.com/chrspickens/Potomac/issues/36), while preserving the source issue links.

| 0.4 debt | Why it blocks sensitive Table behavior | Required closure before dependent Table release |
| --- | --- | --- |
| [#27 campaign setup and exact module pin](https://github.com/chrspickens/Potomac/issues/27) | Table action interpretation depends on an unambiguous persisted campaign and exact module version. | Fixture-free fresh-host setup, restart persistence, strict pin enforcement, safe legacy adoption and migration tests. |
| [#30 cross-app Workspace integration](https://github.com/chrspickens/Potomac/issues/30) | Duplicate app/brick paths or stale context can show inconsistent session/action state or bypass shared authorization. | Same host adapters across full apps/bricks; authorized selection/context, convergence, member-specific layouts and raw HTTP/SSE privacy coverage. |
| [#32 three-client acceptance and compatibility](https://github.com/chrspickens/Potomac/issues/32) | Sensitive actions/events require repeatable evidence across distinct principals, restart and both systems. | Isolated automated GM + two-player browsers, both fresh system campaigns, permission/replay/retry/migration coverage and CI gate. |
| 0.4 related actor/encounter visibility, archive and lifecycle criteria ([#28](https://github.com/chrspickens/Potomac/issues/28), [#29](https://github.com/chrspickens/Potomac/issues/29)) | Table roster and action targets must not expose hidden/archived entities or treat context as permission. | Verify explicit grants, hidden field/derived-value redaction on every read/event path, archive constraints and lifecycle transitions. |

Until each applicable gate closes, implementation must disable or explicitly mark the dependent sensitive capability unavailable; it may not claim verified private Table play while relying on fixture-only identity, permissive projections or untested replay.

## 7. Compatibility, migration and out of scope

Apply [ADR-0010](adr/0010-durable-table-session.md) for migration semantics. Schema migration is versioned, backed up, interruption-safe, transactional where supported and tested on disposable copies. Preserve stable entity, event, operation, receipt and cursor identity when representable. Invalid ambiguity fails closed and leaves source recoverable. The session/roll timeline and verified receipts are included in the versioned campaign backup; restore remains to an empty isolated host under 0.4 backup rules.

The 0.5 implementation must identify compatibility/versioning behavior for existing snapshot, event and SSE clients before changing public contracts. Keep offline edits pending until host receipt; reconnect revalidates current grants, session state, module version and revisions. No retries reroll or duplicate operations.

Out of scope: maps/grids/tokens, fog of war, universal combat model, automatic initiative/turn/round handling, detailed condition simulator, encounter AI, voice/video, rich-text CRDT, executable third-party modules, public/LAN hosting, production authentication, cloud sync, desktop packaging and multiple campaigns per host.

## 8. Issue mapping and decisions

| Work item | Requirements to implement |
| --- | --- |
| [#37 session lifecycle and GM controls](https://github.com/chrspickens/Potomac/issues/37) | WS05-001–006, 009, 014; BA05-02, BA05-06 |
| [#38 participant panel and selection](https://github.com/chrspickens/Potomac/issues/38) | WS05-004, 008, 010, 018–021; BA05-03 |
| [#39 module actions, rolls and timeline](https://github.com/chrspickens/Potomac/issues/39) | WS05-007, 011–016, 018–021; BA05-04, BA05-05 |
| [#40 registered Table bricks](https://github.com/chrspickens/Potomac/issues/40) | WS05-005, 008, 017–021; BA05-03 |
| [#41 reconnect and idempotent recovery](https://github.com/chrspickens/Potomac/issues/41) | WS05-012–016, 020–021; BA05-05, BA05-06 |
| [#42 acceptance and walkthrough](https://github.com/chrspickens/Potomac/issues/42) | All requirements; all browser scenarios, both systems and inherited 0.4 gates |

Decision record: [ADR-0010 — Durable Table session resource](adr/0010-durable-table-session.md). Contract/schema specifications and implementation records are added by their respective child issues; this document defines the semantic baseline and deliberately does not claim executable schemas or implemented behavior.
