# Instructions for coding agents working on Potomac

Read [Engineering Standards](docs/engineering-standards.md) and [Architecture](docs/architecture.md) before modifying code. The former governs new and materially changed files; design specifications are still evolving.

## Non-negotiable guardrails

1. **Do not collapse system modularity.** Keep applications and bricks game-neutral; game-system specifics belong in versioned modules.
2. **Do not duplicate domain logic.** Rules evaluation, schema validation, authorization and persistence should have one authoritative implementation behind shared contracts.
3. **Do not bypass host security.** Validate commands on the host, filter player-visible data/events before transmission, and do not trust dashboard bindings as permissions.
4. **Do not substitute client state for committed state.** Offline edits are pending; the host validates revisions, module compatibility and approvals on reconciliation.
5. **Do not execute untrusted module code.** Use bounded, declarative rules. Never give module rules filesystem, network or privileged Node access.
6. **Do not overwrite data or history silently.** Preserve stable IDs, idempotent operation IDs, migration/backup requirements and audit records.
7. **Do not expose development credentials.** Existing static GM/player bearer tokens are localhost-only fixtures, not a production identity model.
8. **Do not assume the design docs are implemented.** Check the current branch and code before claiming a feature works.

## Work sequence

- Inspect the current branch, relevant package contracts and affected tests. Prefer small, isolated changes.
- Identify which layer owns the change: `clients/`, `server/`, `packages/`, `modules/`, or `docs/`.
- State any assumptions and security/data-migration risks in the PR.
- Add or update tests for changed rules, permissions, sync semantics or schema contracts.
- Run existing checks. The experimental foundation branch provides `pnpm debug:smoke` and an agent CLI in `scripts/potomac-debug.mjs`; these are not present on the documentation-only `main` branch until merged.
- Never invent test results; report commands actually run and their outcomes.
- Record meaningful architectural decisions in `docs/adr/`; keep implementation and documentation synchronized.
- Do not add broad dependencies, rewrite unrelated modules, force-push, or merge without an explicit reason and user approval.

## Useful references

- [Contributing](CONTRIBUTING.md)
- [Module and rules spec](docs/module-spec.md)
- [Foundation experiment](docs/foundation-experiment.md)
- [Open decisions](docs/decisions.md)

The project has no selected software license yet. Do not choose one on the user's behalf.
