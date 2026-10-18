# Third-module authoring quickstart (current V2 status)

This is a status-aware guide, not a promise of a supported third-party plugin API. The V2 contracts and two bundled examples exist, but there is no general loader, installer, or contribution-to-browser mounting path. A third rules proof currently requires reviewed repository changes to trusted host registration and a UI route.

## Public contracts to start with

Read `AGENTS.md`, `docs/engineering-standards.md`, `docs/architecture.md`, `docs/module-plan.md`, and `docs/rules-module-rfc.md`, then the public V2 declarations in `packages/contracts/src/`. They describe capability references, typed entities/commands, resolvers and host-owned randomness, effect proposals, reactions, and declarative UI nodes. These declarations alone are not yet sufficient to author a loadable module.

## Before writing a module

Resolve these gaps with the platform maintainers rather than guessing from a bundled example:

- the concrete effect handler IDs and each handler's payload/event schema;
- the exact supported schema keywords and validation limits;
- which files contribute to the module digest and how capability digests are synchronized;
- how to validate and pin a module lock;
- module registration/discovery and the focused test harness;
- how an authorized declarative UI contribution is mounted and how request lock digests are supplied.

Current implementation facts, useful only for a **bundled repository proof**, are catalogued in `docs/third-module-authoring-report.md`. In particular, `server/host/v2-host.mjs` explicitly wires the two examples and the web app uses dedicated V2 routes; copying these steps is not independent installation.

## Acceptance claims

Do not claim third-party installability, a security sandbox, V2 offline support, or general backup/migration support. For any bundled proof, test module resolver logic, host registry/effect/reaction/host suites, both existing system browser regressions, and a separate authenticated multi-browser host run. Use deterministic host randomness only in tests; never accept client rolls or principals. Preserve exact campaign locks and V1 behavior.
