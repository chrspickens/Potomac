# Potomac engineering standards

**Status:** v0.1, proposed for review. Applies to all **new or materially modified code** after adoption. It does not declare the existing foundation prototype production-ready or require a cosmetic rewrite of old code.

## Purpose and precedence

These standards exist so that a small project can grow into a modular suite without duplicating business logic, breaking data, or making AI-assisted contributions difficult to review.

Use **MUST** for required invariants, **SHOULD** for preferred defaults with documented exceptions, and **MAY** for optional techniques. When this document conflicts with a versioned module/API specification, record an architectural decision and update one or both before implementation. Security invariants must not be relaxed silently.

Related references: [architecture](architecture.md), [module specification](module-spec.md), [initial requirements](requirements.md), [decision register](decisions.md). See [CONTRIBUTING](../CONTRIBUTING.md) for the working PR process.

## 1. Repository layout and ownership

Prefer the pnpm monorepo structure used by the foundation spike:

```text
clients/                 browser/desktop shells, UI composition
server/                  authoritative host APIs and persistence
packages/contracts/      shared, versioned public API and DTO contracts
packages/module-registry/ module discovery and compatibility
packages/rules-engine/   pure bounded rules evaluation
packages/<capability>/   shared platform libraries / app adapters
modules/<system-id>/     manifests, schema, UI, rules, test fixtures
scripts/                 development-only CLI and diagnostics
docs/                    product architecture, requirements, ADRs
```

- Each package MUST have a clear responsibility and documented public exports.
- `contracts` MUST NOT import server, client, or game-specific implementations.
- Shared rules and module validation MUST live in one reusable implementation, not copies in host and client. Existing prototype duplication is **technical debt to resolve**, not a pattern to follow.
- Clients MAY depend on shared contracts and view components; they MUST NOT import host database internals or modify host data directly.
- Host services MAY depend on contracts, validation, and pure rules evaluation; they MUST NOT depend on React or Electron.
- Modules MUST provide behavior through registered, versioned contracts; the Characters app MUST NOT contain `if (system === "dnd")`-style logic.
- Extract shared code only when there is a real second consumer; avoid premature frameworks and generic abstraction layers.

## 2. Language, files, and formatting

- **TypeScript is the default** for new application, server and platform code. Existing `.mjs` in the experiment may remain until intentionally migrated; do not mix implementation styles within one new package.
- Prefer strict compiler checks for each new TypeScript package. Public boundaries MUST validate runtime input; TypeScript types alone are not a security boundary.
- Use 2 spaces, UTF-8, LF endings and final newline. Follow the checked-in `.editorconfig` and `.prettierrc.json` for supported files.
- `PascalCase`: React components, classes and types. `camelCase`: variables and functions. `UPPER_SNAKE_CASE`: true constants. `kebab-case`: directory/package names, non-component files, module IDs using stable dotted namespaces (e.g., `example.system-a`).
- Choose descriptive names over unexplained abbreviations; keep files focused. Prefer named exports for shared libraries.
- Prefer `unknown` and explicit narrowing over `any`. Avoid non-null assertions or suppression comments unless accompanied by a reason.
- Prefer pure functions and immutable state transformations for domain logic. Keep rendering, I/O, persistence, and rule evaluation separate.
- Do not reformat unrelated legacy files in a feature PR. Where formatting/tooling has not been wired to CI, note this rather than claiming enforced compliance.

## 3. API, schema, and persistence contracts

- Define typed **commands** (intent to change state) and **queries** (authorized reads) independently of the UI. Full apps and bricks MUST use the same contracts for shared actions.
- Client input MUST be runtime-validated at the host boundary. Include stable identifiers and useful, non-sensitive error codes for conflict, unauthorized, invalid, and unsupported cases.
- Use **stable entity IDs**; never use display names, list positions, or dashboard layout position as identity.
- Persist relevant `moduleId`, `moduleVersion`, `schemaVersion`, entity revision, and operation ID. Treat stored data and event history as versioned contracts.
- Declare schemas with a pinned dialect (target: JSON Schema 2020-12); validation must match the dialect actually supported. Never claim full draft support for a partial custom validator.
- Schema or event changes that could affect existing data MUST include an explicit migration/backward-compatibility plan and tests. Create a backup before destructive migration.
- State updates and their audit events MUST be committed atomically. Retryable commands MUST be idempotent using stable operation IDs and payload identity checks.
- No silent last-write-wins on conflict-prone gameplay fields. Offline operations MUST be revalidated against current host state, modules and permissions.

## 4. Modular game systems and rules

- Universal core types MUST NOT assume levels, classes, hit points, spells, action economy, or a particular die mechanic.
- System modules SHOULD keep manifest, schemas, declarative UI definitions and action definitions in separate files; use namespaced module IDs and explicit versions.
- Module-defined UI MUST reference declared fields and actions. Incompatible references MUST fail during module registration or validation.
- Rules evaluation MUST be bounded and deterministic given state, parameters, recorded random inputs and rules version. No ambient `Math.random()` for verified rolls.
- Rules MUST return typed **proposed effects**; only the authoritative host may validate, authorize and commit them. No direct database/file/network access from rule expressions.
- For third-party code, default to **no executable plugin privileges** until an explicit sandbox/capability model exists. Never evaluate untrusted downloaded JavaScript with unrestricted Node APIs.
- Include module fixtures that test mechanically **different** game systems. Adding a second system should not require special-case code in a generic app.

## 5. Authorization and privacy are backend responsibilities

- Treat all players, modules, requests and sync queues as untrusted. Apply access control on **reads, writes, search, relations, subscriptions, exports and events**.
- User-owned dashboard layout and context bindings MUST NOT confer data access. Host authorizations determine what data a brick may render.
- A hidden element in React is not a security control. Filter unauthorized fields and records **before** sending payloads to a client, including derived values and event history.
- Keep the GM role separate from operating the host machine; a local machine administrator is outside application-level secrecy guarantees.
- Only development runs MAY use the foundation's static role tokens. They MUST remain loopback-only, must not appear in committed files or logs, and MUST NOT be described as production authentication.
- Treat local copies as potentially permanent: withdrawing permission cannot reliably erase data already downloaded. Document the implication for sensitive game material.
- Avoid printing authentication credentials, private campaign content, player data, or full request bodies in debugging logs.

## 6. Multiplayer, offline and observable state

- The host is the authority for committed gameplay, accepted roll outcomes and shared context. A local edit is **pending** until acknowledged.
- Treat stream notifications as a hint, not authoritative state: catch up using durable event cursors, revisions, and authorized snapshots.
- Reconnection MUST not apply operations twice; keep queued-operation IDs stable through retries.
- Distinguish automatically permitted edits, review-required proposals, explicit conflicts and private drafts.
- Accepted events SHOULD record actor, time, entity, operation ID, rule/module version and visibility, sufficient to explain what changed. Corrections SHOULD append a compensating event instead of erasing history.
- Shared context such as `session.activeEncounter` is a reference, not a visibility grant. Personal selections and pinned bindings must not overwrite campaign-wide context.
- Keep diagnostics structured and machine-readable when possible; human-friendly messages should accompany, not replace, programmatically distinct error codes.

## 7. React, bricks and dashboard UX

- A **brick** is a focused view and authorized interaction surface, not a separate copy of an application's business logic.
- Brick display, binding, and settings SHOULD be independent of the currently selected entity or encounter. Support following, personal, pinned and manually selected data where appropriate.
- Full app handoffs SHOULD preserve current campaign/entity context.
- All actionable UI MUST be keyboard operable, focus-visible and labeled. Prefer native HTML controls, semantic structure and accessible dialogs.
- Provide explicit pending, loading, error, unavailable, unauthorized and offline states; never imply a local change was committed before host acknowledgement.
- Responsive layouts SHOULD degrade gracefully; avoid requiring drag-and-drop for core actions.
- The GM controls permitted information, while players control their own dashboard presentation.

## 8. Testing expectations and quality gates

A change SHOULD include tests at the **lowest useful level** plus an integration check when a boundary changes.

| Changed area | Minimum expected evidence |
| --- | --- |
| Rule operator/action | Success, invalid types, bounds, exhausted budget, deterministic inputs |
| Module manifest/schema/view | Valid and invalid module; compatibility and missing-reference failure |
| Host command | Permission denied, stale revision, retry idempotency, atomic persistence |
| Secret visibility | GM and player projections, event and subscription redaction |
| Offline/sync | Retry, reconnect/cursor gap, conflict, rejection and pending state |
| Brick or UI | Both app and brick call shared commands, accessible interaction states |
| Data migration | Old fixture upgrades, incompatible versions handled, backup path |

Before merging, run all **available** repository checks and record results in the PR. On the foundation implementation branch, `pnpm debug:smoke` exercises local host invariants; the diagnostic workflow is not yet part of `main` at the time these standards are drafted. As test/lint/typecheck scripts are added, make them required CI checks. Do not claim tests passed unless executed and observed.

## 9. Dependencies, performance and maintenance

- Prefer existing libraries where suitable, but explain new dependency choices, version compatibility and security/maintenance implications in the PR.
- Prefer explicit, bounded work for rules, event replay, module loading and sync. Avoid unbounded loops/recursion, large all-campaign queries and blocking work in hot UI paths.
- Add database indexes for demonstrated query patterns, and measure before optimizing.
- Keep the self-hosted deployment usable without central Potomac-operated infrastructure; a diagnostic convenience must not create a mandatory cloud dependency.
- Avoid committing local DBs, secrets, generated bundles, `node_modules`, build caches or environment files containing credentials.
- Document platform support honestly; localhost-only test networking is not public-hosting guidance.

## 10. Changes, reviews and documentation

- Use a focused branch and a PR rather than pushing feature work directly to `main`.
- Commit messages SHOULD follow `type(scope): imperative summary` where helpful (`feat(rules): validate resource bounds`, `docs: record sync policy`).
- A PR MUST explain its intent, touched boundaries, relevant requirements, test results, security/data migration implications, and any limitations or follow-ups.
- Keep each PR reviewable. Split unrelated features and mechanical reformatting.
- Update `docs/` for contract, behavior or scope changes; use `docs/adr/` for consequential decisions or deviations from these standards.
- If a standard proves impractical, propose a specific change with rationale. Don't silently bypass it.
- **Licensing remains undecided.** Do not add a license, copy proprietary rules content, or import third-party content without verifying permission.

## Definition of done

A foundation feature is done when its public contract is documented, the desired behavior is testable, required authorization and error states are handled, relevant checks pass, and the PR clearly distinguishes implemented behavior from future intentions.
