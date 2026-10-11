# Contributing to Potomac

Potomac is experimental, self-hostable TTRPG software. Contributions should preserve modularity, privacy and users' ownership of their campaign data.

Please read [Engineering Standards](docs/engineering-standards.md), [Architecture](docs/architecture.md) and [Module Specification](docs/module-spec.md) before changing core behavior.

## Starting a change

1. Check the target branch. `main` currently holds planning documents; the experimental implementation may be on a separate branch.
2. Keep the change focused: one feature, bug fix, specification, or refactor per PR when practical.
3. For architecture or module-protocol changes, describe the proposed contract and migration/compatibility implications before implementing.
4. Use a branch named `feat/<topic>`, `fix/<topic>`, `refactor/<topic>`, `test/<topic>`, or `docs/<topic>`.

## Editing standards

- Use TypeScript for new platform/client/server packages where possible. Prefer shared typed contracts and validation at boundaries.
- Follow `.editorconfig` and `.prettierrc.json` for supported source files; avoid unrelated format-only changes.
- Keep app/brick display code separate from rules, persistence and network transport.
- Never hardcode D&D-specific assumptions into generic character, encounter or dashboard code.
- Never weaken GM/player data filtering or run untrusted rules/modules with unrestricted privileges.

## How to validate

Run the checks present in your branch and report exact results. For the foundation implementation branch, the smoke diagnostic command is `pnpm debug:smoke` (requires Node 22.5+). The documentation-only branch may not have runnable code. Include a repeatable manual test scenario if no automated check exists.

Any changed rules/module contracts require tests showing success and rejection cases. Changed auth/visibility code needs GM and player tests. Sync logic needs retry, stale revision and reconnect cases.

## Pull requests

Describe:
- What problem the change solves and what it does **not** solve.
- Affected packages, APIs and module contracts.
- Verification performed (commands and results).
- Permission, privacy, data migration and offline behavior implications.
- Documentation updates and unresolved questions.

Reviewers should be able to understand the change without running the whole application. Do not merge with known failing checks without explicitly documenting and resolving the risk.

## Decisions and scope

Architecture proposals are recorded in [docs/decisions.md](docs/decisions.md). For decisions with durable cross-package impact, add an ADR under `docs/adr/`.

**Licensing:** no license has been selected. Public repository visibility does not grant permission to copy or redistribute copyrighted assets, proprietary game text or third-party code.
