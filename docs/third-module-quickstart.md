# Third-module authoring quickstart (current V2 status)

This is a status-aware guide, not a promise of a supported third-party plugin API. The V2 contracts and two bundled examples exist, but there is no general loader, installer, or contribution-to-browser mounting path. A third rules proof currently requires reviewed repository changes to trusted host registration and a UI route.

## Public contracts to start with

Read `AGENTS.md`, `docs/engineering-standards.md`, `docs/architecture.md`, `docs/module-plan.md`, and `docs/rules-module-rfc.md`, then the public V2 declarations in `packages/contracts/src/`. They describe capability references, typed entities/commands, resolvers and host-owned randomness, effect proposals, reactions, and declarative UI nodes. These declarations alone are not yet sufficient to author a loadable module.

## Write and validate trusted source

Follow [the V2 authoring specification](v2-module-authoring.md) and copy [the starter](../examples/module-starter/v2/README.md). The normative schema subset, effect-handler boundary, digest procedure, exact capability lock construction, and development commands are documented there.

Run `pnpm v2:module digest <module-directory>`, update the module-owned refs/manifests and `authoring.json` using the printed digest, then run `pnpm v2:module validate <module-directory>`. The validator checks the root digest, capability closure, resolver/effect/entity references, and schemas. It imports `extensions.mjs`; use only with source you trust. `pnpm v2:module:test` runs focused contract tests.

This validates a source package; it does not pin or alter a campaign. The campaign lock is exact and immutable after pinning. Existing host bootstrap still imports modules explicitly and uses dedicated browser routes. See [V2 integration boundaries](v2-module-integration-boundaries.md) and the historical findings in [the challenge report](third-module-authoring-report.md).

## Acceptance claims

Do not claim third-party installability, a security sandbox, V2 offline support, or general backup/migration support. For any bundled proof, test module resolver logic, host registry/effect/reaction/host suites, both existing system browser regressions, and a separate authenticated multi-browser host run. Use deterministic host randomness only in tests; never accept client rolls or principals. Preserve exact campaign locks and V1 behavior.
