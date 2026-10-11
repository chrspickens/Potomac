# Potomac Workspace 0.2 — Requirements specification

**Status:** Proposed for review  
**Version:** 0.2.0-draft.1  
**Scope:** First customizable Workspace/dashboard vertical slice  
**Predecessor:** [Foundation experiment v0.1](foundation-experiment.md) (implementation currently proposed separately from `main`)  
**Related:** [Architecture](architecture.md) · [Engineering standards](engineering-standards.md) · [Module contract](module-spec.md) · [Initial requirements](requirements.md)

> This is a **requirements document**, not a claim that any 0.2 features exist. The example JSON/contracts below are illustrative and not yet ratified as a stable public API.

## 1. Outcome and hypothesis

**Outcome:** A GM and player can independently assemble and save dashboards from registered, interactive bricks. Each brick resolves an explicit data binding; bricks set to *follow* shared campaign context respond to GM encounter changes, while pinned bricks and the user's layout stay unchanged. Data access and commands remain subject to host authorization.

**Hypothesis:** A generic Workspace runtime can display, arrange and configure app-provided bricks without embedding game-system rules, view-specific queries, or application-specific business logic in the dashboard engine.

### Success demonstration (the vertical slice)

1. Open two client sessions against one local campaign (GM and player test roles).
2. Arrange different Combat dashboards; each adds/repositions a character brick, an encounter summary brick and an activity brick.
3. Pin one character brick to a stable actor ID; configure the encounter brick to follow `session.activeEncounter`.
4. GM changes active encounter from **A** to **B**; both authorized encounter bricks update without a reload or layout reset. Pinned character remains unchanged.
5. Execute a permitted character action from a brick. Host validates, persists, logs and delivers updated authorized data to the relevant views.
6. Reload each client. Each local dashboard, brick placement, binding and selected dashboard is restored.
7. Prove a player cannot obtain a GM-only field or event by changing a brick binding, editing saved layout JSON, or requesting an unauthorized entity directly.

## 2. Scope, priorities and constraints

**P0:** Required for the Workspace 0.2 acceptance gate. **P1:** Useful, can follow after the gate without blocking it. **Out:** Explicitly excluded from this milestone.

### In scope (P0)

- Reusable Workspace shell with campaign indicator, installed-app navigation and dashboard selection.
- Brick registration and discovery, including modules that contribute generic game-system-aware character views.
- Simple dashboard and dashboard-group management: create, rename, select and delete a dashboard; add it to a group; select an active dashboard; an empty/default state.
- Per-client layout personalization, move/resize/remove/add bricks, save and restore configuration.
- Brick configuration with **follow shared context** and **pinned entity ID** binding modes.
- A minimal context provider/resolver with typed stable encounter references.
- Three exemplar bricks: **Character**, **Encounter Summary** (fixture-backed), **Activity Log**.
- Interactive character actions through existing host command APIs; consistent state in the compact brick and full character view.
- Host-filtered data and basic GM/player differentiation; test with two browser profiles.
- Automated and/or reproducible smoke scenarios including accessibility and persistence.

### In scope as preparatory dependencies, not new full applications

- Two stable fixture encounter IDs with names and small permitted summaries. The host must validate selection and resolve authorized views; there is no full encounter CRUD, combat rules, or map.
- The existing two fictional systems and current character rules.
- The existing host subscription path (currently SSE). A transport rewrite to Socket.IO is **not** necessary to meet the Workspace 0.2 outcome.

### Out of scope

- Full drag-and-drop desktop window docking, arbitrary floating windows, complex multi-monitor layouts or IDE-style nested pane stacks.
- Full Characters creation, Lore, Maps, Encounters or Table apps; campaign-wide VTT/map editing.
- Offline edits/merge proposals, durable offline queue, cross-device layout synchronization, public hosting and production authentication.
- Third-party executable plugins, downloadable app marketplace, visual rules-language editor, user-generated custom bricks.
- Campaign exports/backups beyond the existing platform baseline.

**Important limitation:** The foundation uses development GM/player role tokens rather than distinct authenticated player accounts. Workspace 0.2 can demonstrate different local layouts using distinct browser profiles or a **local-only client profile key**, but must not present that key as secure identity or enforce host permissions through it. Proper individual identities belong in later work.

## 3. Terminology and ownership

| Concept | Responsibility / owner |
| --- | --- |
| **Workspace** | Shell, navigation, registration, dashboard management, layout orchestration |
| **Application** | Full workflows and reusable views/actions; registers brick definitions |
| **Brick definition** | Stable type ID, owning app, metadata, configuration and supported binding types |
| **Brick instance** | Stable instance ID, definition reference, saved options, binding and placement |
| **Dashboard** | Saved personal arrangement of brick instances |
| **Dashboard group** | Personal collection/selection of dashboards (e.g., Combat, Planning, Lore) |
| **Context** | Scoped references such as `session.activeEncounter`; **never** a permission grant |
| **Entity** | Host-owned stable ID and data, viewable only through authorized queries |
| **Host** | Authority for campaign context, data access, mechanics and committed actions |
| **Local client** | Owner of display preferences, layout draft and local persistence for this milestone |

**Invariant:** Data, context binding and visual layout must remain separate. A session context update changes the referenced data; it must not rewrite brick instance configuration or personal layout.

## 4. Functional requirements

All acceptance criteria below are intended to be demonstrable in a test or repeatable manual scenario.

### 4.1 Workspace shell and dashboards

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WS-001 | P0 | Render a reusable Workspace shell | A campaign indicator, app navigation, dashboard chooser and connection/role indicator are present; no fictional-system-specific labels are required by the shell. |
| WS-002 | P0 | Provide editable personal dashboards | User can create, rename, switch and delete dashboards; switching preserves both dashboards' distinct contents. |
| WS-003 | P0 | Support dashboard groups | User can create/rename a group, add dashboards, and switch dashboards inside that group; at least Combat and Planning example groupings can be demonstrated. |
| WS-004 | P0 | Compose layouts from brick instances | Add a registered brick, move it, resize it and remove it; changes remain confined to the currently edited dashboard. |
| WS-005 | P0 | Persist local layout and selection | After reload, group membership, dashboard list, brick IDs, positions, sizes, settings, bindings and active selection are restored for that client. |
| WS-006 | P0 | Prevent invalid layout corruption | Missing/unknown brick types, malformed sizes/positions and incompatible saved schema versions produce a recoverable placeholder or default; an invalid layout does not crash the entire Workspace. |
| WS-007 | P0 | Provide a usable layout editing mode | Explicit edit/view state; changes cannot accidentally occur during live play; add/remove/move/resize have visible controls and keyboard-operable alternatives. |
| WS-008 | P1 | Improve organization | Duplicate a dashboard, reorder groups/dashboards and reset a dashboard to a default template. |

### 4.2 Brick registry and app integration

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WS-009 | P0 | Register bricks declaratively | Registry returns stable type IDs, owning app, human-readable name, version, configurable binding types and size defaults; adding a new brick does not require an edit to the Workspace layout engine. |
| WS-010 | P0 | Instantiate multiple bricks of the same type | Two independent instances of `characters.sheet` can bind to different actor IDs and keep distinct placements/settings. |
| WS-011 | P0 | Keep game systems out of Workspace logic | The same Character brick supports System A and System B via module-provided view/rule definitions; no `system-a`/`system-b` conditionals in the Workspace or brick host. |
| WS-012 | P0 | Share action contracts between app and brick | Character brick and full character view invoke the same typed command adapter; accepted actions converge on the same host revision and event history. |
| WS-013 | P0 | Handle unavailable bricks | Missing or disabled definition displays an informative placeholder preserving instance data for later recovery instead of destroying the dashboard. |
| WS-014 | P1 | Full app handoff | “Open in App” from a brick opens its owning app with campaign/entity context preserved; no complete character editor is required for P0. |

### 4.3 Context and data bindings

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WS-015 | P0 | Represent shared encounter by stable ID | Fixture encounters A and B use stable IDs rather than a mutable display-name string; a GM can activate either ID. |
| WS-016 | P0 | Support `follow` and `pinned` binding modes | Follow resolves a named, typed context key; pinned resolves a specific authorized stable entity ID. Context-free session bricks, such as Activity Log, may use `none`. |
| WS-017 | P0 | Propagate host context changes | Switching A→B updates subscribed authorized bricks in both clients without manual refresh; placement, dimensions and configuration remain unchanged. |
| WS-018 | P0 | Isolate personal selection from session context | Choosing a different character or dashboard locally does not alter `session.activeEncounter` or the other client's selected layout. |
| WS-019 | P0 | Resolve missing, denied, or unsupported context safely | Null/stale reference, wrong entity type or denied access displays a clear empty/unavailable/unauthorized state without revealing forbidden details. |
| WS-020 | P0 | Resubscribe and reconcile safely | After temporary connection loss, the client's context/data catch up from a host snapshot or authorized cursor replay; no stale “connected” indication. |
| WS-021 | P1 | Additional binding modes | `personal` (e.g., `user.selectedCharacter`) and `manual` selection of accessible entities, with explicit behavior and saved configuration. |

### 4.4 Permissions and interactions

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WS-022 | P0 | Authorize all entity reads and subscriptions | Host applies GM/player permissions to entity projections and events; user-supplied binding IDs do not bypass restrictions. |
| WS-023 | P0 | Authorize commands independently of UI | Player cannot invoke a GM-only context update or prohibited action by crafting a request; host returns an explicit denial. |
| WS-024 | P0 | Keep live actions observable | Accepted resource changes/rolls from a brick update relevant views and produce a role-filtered history entry once, even with a retried operation ID. |
| WS-025 | P0 | Represent pending/error states clearly | Brick distinguishes sending, accepted, rejected/conflicted and disconnected states; never displays optimistic state as authoritative without confirmation. |
| WS-026 | P1 | Personal per-user privacy preferences | Save dashboard layout in a user's chosen local profile; only secure multi-user cloud/device sync if identity is later implemented. |

## 5. Nonfunctional requirements

| ID | Priority | Requirement / measurable verification |
| --- | --- | --- |
| WSN-001 | P0 | **Separation:** Layout serialization contains stable brick IDs, layout, options and references; it does **not** copy host-owned character/encounter records or secrets. |
| WSN-002 | P0 | **Security:** No GM-only field, event or disallowed entity payload is transmitted to player clients via query or event transport. Verify with raw API responses, not merely hidden UI. |
| WSN-003 | P0 | **Interoperability:** Both fictional game-system modules remain operable in the same shared Character brick through registered capabilities. |
| WSN-004 | P0 | **Persistence:** Persist dashboard edits locally before they are considered saved; reloads and dashboard switches recover a consistent configuration. |
| WSN-005 | P0 | **Validation:** Runtime validation on saved layout and brick configurations; malformed/crafted content fails safely with actionable diagnostics. |
| WSN-006 | P0 | **Accessibility:** Keyboard navigation, focus visibility, labeled controls, alternative move/resize operations and meaningful empty/error feedback. |
| WSN-007 | P0 | **Resilience:** An individual brick rendering or resolution error is contained, and sibling bricks remain usable. |
| WSN-008 | P0 | **Testability:** Automated unit/component tests for registry, layout serialization, context binding and permission-sensitive paths, plus an end-to-end two-client scenario; preserve the existing agent debug smoke test. |
| WSN-009 | P0 | **Local-first:** Dashboard personalization needs no Potomac-operated cloud service. Existing host and local client work as before. |
| WSN-010 | P1 | **Performance guardrail:** Context updates refresh only relevant subscribed bricks; avoid full app remounts, unbounded subscriptions or listener leaks. Measure before setting strict latency targets. |
| WSN-011 | P1 | **Responsive behavior:** Narrow screens may stack bricks without altering saved desktop placements; no functionality is inaccessible due to layout width. |

## 6. Reference contracts (illustrative, not final)

### 6.1 Brick definition / instance boundary

```ts
type BrickDefinition = {
  typeId: string;        // e.g. "characters.sheet"
  version: number;
  ownerAppId: string;
  title: string;
  supportedBindings: Array<"follow" | "pinned" | "none">;
  defaultSize: { w: number; h: number };
  // Configuration schema, rendering component and data resolver
  // are supplied through trusted app registration.
};

type BrickInstance = {
  id: string;            // user dashboard instance, distinct from entity ID
  typeId: string;
  definitionVersion: number;
  binding: BrickBinding;
  options: Record<string, unknown>;  // validated against definition schema
  layout: { x: number; y: number; w: number; h: number };
};

type BrickBinding =
  | { mode: "follow"; contextKey: "session.activeEncounter" }
  | { mode: "pinned"; entityId: string }
  | { mode: "none" }; // e.g., campaign-scoped activity feed
```

### 6.2 Dashboard storage (client-owned for v0.2)

```json
{
  "schemaVersion": 1,
  "localProfileId": "gm-demo-profile",
  "campaignId": "foundation-demo",
  "activeGroupId": "session",
  "activeDashboardId": "combat",
  "groups": [{"id": "session", "name": "Session", "dashboardIds": ["combat", "planning"]}],
  "dashboards": [{
    "id": "combat",
    "name": "Combat",
    "bricks": [
      {
        "id": "char-a",
        "typeId": "characters.sheet",
        "definitionVersion": 1,
        "binding": {"mode": "pinned", "entityId": "actor-001"},
        "options": {},
        "layout": {"x": 0, "y": 0, "w": 4, "h": 3}
      },
      {
        "id": "encounter-follow",
        "typeId": "encounters.summary",
        "definitionVersion": 1,
        "binding": {"mode": "follow", "contextKey": "session.activeEncounter"},
        "options": {},
        "layout": {"x": 4, "y": 0, "w": 4, "h": 3}
      }
    ]
  }]
}
```

**Semantics:** The saved layout is **personal presentation state**, not authoritative host state. The `localProfileId` in this example is for separating local demo preferences only—not authentication or a grant of permissions. Resolve bindings through the authorized host/client data adapter; never deserialize saved records as trusted data.

### 6.3 Context model

```text
session.activeEncounter = "encounter-a"  // host-controlled ID
user.selectedCharacter  = "actor-001"    // local selection, future binding mode
brick "char-a"           = pinned("actor-001")
brick "encounter-follow" = follow("session.activeEncounter")
```

When the GM sets `session.activeEncounter = "encounter-b"`, only followers of that key change what they reference. No brick placement or per-user selection changes. Context keys must be typed and must not become arbitrary field-path execution or permission rules.

## 7. End-to-end acceptance scenarios

These scenarios are the required **definition of behavior**, independent of the chosen grid/UI library.

| Test | Setup and action | Required observation |
| --- | --- | --- |
| AT-01 — Different layouts | GM arranges two columns, player arranges one; both reload | Each sees their own restored layout and selected dashboard |
| AT-02 — Multiple instances | Place two `characters.sheet` bricks pinned to different actors | Two independent bindings; same brick implementation |
| AT-03 — Dashboard groups | Create Session group with Combat and Planning; switch repeatedly | Correct brick sets persist; no state bleed across dashboards |
| AT-04 — Follow context | Encounter follower active on both clients; GM switches A→B | Both authorized followers show B; no manual refresh |
| AT-05 — Pinned stability | A character brick is pinned; GM switches active encounter | Character binding and position remain unchanged |
| AT-06 — Shared command | Player uses permitted resource action in brick | Host commits exactly once, GM sees updated value/event |
| AT-07 — Forbidden binding | Player edits saved JSON to point a brick to a GM-only entity | No secret field/existence details in network response or UI |
| AT-08 — Forbidden command | Player crafts GM context command | Host rejects; shared context unchanged |
| AT-09 — Missing module/data | Remove registration, delete fixture or invalidate entity ID | Brick displays recoverable placeholder; dashboard loads |
| AT-10 — Reconnect | Disconnect one client, change active encounter, reconnect | Client reconciles to current authorized state |
| AT-11 — Keyboard interaction | Add/move/resize/remove brick without pointer drag | Layout is operable with keyboard and persists |
| AT-12 — Two rule systems | Render System A and System B character bricks | Distinct fields/actions without system branches in Workspace |
| AT-13 — Unavailable host | Stop host during connected session | Visible disconnected status; cannot misrepresent local edits as committed |
| AT-14 — Corrupt saved layout | Put invalid size/type/schema version in storage | Safe recovery path; intact dashboards not lost |

Automated tests should cover core contracts and important negative cases; use two real browser profiles/contexts for the user-visible cross-client flow. Existing development bearer tokens do not prove per-player identity.

## 8. Implementation checkpoints and exit gates

### Checkpoint A — Workspace skeleton and registry

- Extract existing Character brick usage behind a registered brick definition.
- Add reusable shell/dashboard model, fixed starter dashboards and two minimal new bricks.
- **Gate:** one renderer can instantiate 3 brick types, and two independent Character instances, without game-specific layout-engine code.

### Checkpoint B — Personal editing and persistence

- Dashboard/group CRUD, editing mode, brick picker, move/resize/remove, configuration.
- Persist versioned local layouts in browser-managed storage; provide a safe recovery/reset path.
- **Gate:** GM and player layouts independently persist across reload and do not leak between dashboards.

### Checkpoint C — Context and host integration

- Introduce minimal stable encounter fixtures/authorized lookup; adapt current name-based context to an ID.
- Wire follow/pinned bindings to authorized queries and subscribe to existing host events.
- Ensure actions, permission-filtered activity and reconnection work.
- **Gate:** AT-01 through AT-14 are reproducible; automation covers the most consequential paths.

### Technical cleanup prerequisite

The foundation currently has a duplicated host/shared rules evaluator and development-only role identities. The **new Workspace work must not deepen this duplication**. Consolidating the evaluator and adding targeted tests may happen in a small preparatory PR. Complete production identity is explicitly out of 0.2, but code must not assume the local preference key is an authenticated user ID.

## 9. Diagnostics and verification

Keep `pnpm debug:smoke` passing on the foundation implementation branch (or equivalent when merged). Extend it with read-only checks for context and permission projections where useful. Component/e2e tests should verify physical layout state and correct brick binding; a working backend smoke test alone does not prove dashboard behavior.

PRs implementing this milestone must identify the WS/WSN/AT IDs they satisfy and report exact test commands/outcomes. Never claim tests or UI behavior passed without execution.

## 10. Decisions intentionally left open

1. Layout library: adopt a small grid library or build a minimal layout manager; support keyboard operations either way.
2. Local storage technology: `localStorage` may suffice for simple layouts; IndexedDB provides versioned storage and future offline integration. Choose with test evidence.
3. Profile keying: how demo GM/player browsers get separate local layout keys without promising real account security.
4. Visual handling of unauthorized vs nonexistent entities without leaking information.
5. How much of full-app handoff is necessary before building the complete Characters app.
6. Grid breakpoints and minimum brick sizes, to validate through UI prototypes rather than hardcode prematurely.

Record consequential decisions in [ADRs](adr/README.md) before establishing public package contracts.

## 11. Definition of done

Workspace 0.2 is complete when **all P0 requirements and AT-01–AT-14 behaviors are demonstrably satisfied**, tests and diagnostics are repeatable, both fictional systems work through the generic brick, unauthorized responses contain no forbidden data, distinct layouts survive reload, and A→B encounter switching changes data but not personal presentation.

No full VTT, production auth, cloud hosting, advanced docking, or offline change merging is implied by this milestone.
