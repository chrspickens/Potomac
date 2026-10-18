# Third-module authoring challenge: Tides & Omens

**Result: BLOCKED at generic browser setup.** A fresh author completed a public-contract-only module and the CLI validated it. A separate integrator verified that the static catalog could validate and construct its exact lock, but the existing generic browser workflow could not set up the authored two-player scene. No platform/Core workaround was made, and no three-browser playable acceptance is claimed.

## Independent authoring phase

The primary author was a fresh Codex subagent with instructions to use only `AGENTS.md`, public engineering/architecture guidance, `docs/v2-module-authoring.md`, `docs/v2-trusted-catalog.md`, `docs/v2-module-integration-boundaries.md`, `docs/third-module-quickstart.md`, `packages/contracts/src`, and `examples/module-starter/v2`. It was explicitly prohibited from inspecting Revised 5e, Dice-pool, internal host/registry code, or previous third-module reports. Its contemporaneous account is in [`examples/tides-omens/AUTHOR-LOG.md`](../examples/tides-omens/AUTHOR-LOG.md).

The author created `example.tides-omens` version `1.0.0`, with five capabilities, one entity, one command, one deterministic resolver, one typed effect handler, a declarative panel, bounded symbolic fate-token state, and a one-scene sample for Navigator and Keeper roles. `calm`, `storm`, and `omen` are finite resources; two distinct approaches persist progress, danger, resource and choice changes. No HP, AC, initiative, d20, dice-pool counting, or random draw is used.

Evidence from the authoring phase:

- `pnpm v2:module digest examples/tides-omens/v2` — passed; digest `sha256:62ba14cf92848e6111c77ef8e2b2936fe5545542ca5cb4d4e89dd796a56bf5da`.
- `pnpm v2:module validate examples/tides-omens/v2` — passed: 5 capabilities, 1 entity, 1 command, 1 resolver, 1 effect handler.
- `pnpm v2:module:test` — passed (6 contract tests and the documented typecheck).
- `node --test examples/tides-omens/v2/tests/resolver.test.mjs` — passed (7 tests covering deterministic choices, progress/danger/token bounds, exhaustion, invalid input, and stable proposals).

The author also attempted `pnpm v2:module build examples/tides-omens/v2`; it failed because the CLI only accepts `digest` and `validate`. The author did not inspect implementation to infer a build command. The authoring specification/quickstart does not document an independent module build step.

One documentation contradiction affected the challenge: `docs/third-module-quickstart.md` still says there is no catalog or generic browser mounting path, while `docs/v2-trusted-catalog.md` documents the static catalog and `/v2-modules`. The author recorded this contradiction rather than resolving it using internal code.

## Separate catalog integration and browser blocker

A separate integrator was then authorized to inspect host internals. A temporary trusted-catalog file containing only the standard Tides & Omens entry was loaded by `loadTrustedV2Catalog`; `lockForTrustedModule` produced a five-entry lock whose root digest and entries matched `pnpm v2:module validate`. The trial catalog row was removed after inspection showed that a real generic browser setup is not possible for the independently authored shape. The integrator changed no committed platform files and did not add a fixture-only acceptance.

The exact blockers in the current `/v2-modules` workflow are:

1. Generic entity creation generates `role: ""`, but this module’s documented schema requires `navigator` or `keeper`; the host correctly rejects the invalid entity.
2. The generic creation UI does not offer `ownerPrincipalId`; a GM-created principal-owned record therefore remains GM-owned instead of being assigned to the intended player.
3. The generic UI only offers entity creation while the entity list is empty, so the GM cannot create both records required by this module’s two distinct player roles.

The host API can accept an explicit owner and separate grants, but the generic surface does not expose the necessary setup. The integrator stopped as required; it did not add a module-specific route, host import, resolver switch, authorization exception, or renderer behavior. No isolated GM/Player A/Player B browser acceptance was run, because these setup blockers prevent reaching the requested playable flow.

## Changed files and architecture

Phase 1 added only module-owned files under `examples/tides-omens/` (including the author log). Phase 2’s temporary catalog-row experiment left no net catalog change. This report is the only other file added. **Core, host execution, registries, generic UI, renderer, existing modules, and existing tests have no net changes.** The authored mechanics are module-contained, but independent authoring-to-playable-browser acceptance has not passed.

## Remaining limitations

Even after generic setup is addressed, this is a trusted bundled JavaScript module, not an untrusted-code sandbox or independently installable package. Marketplace/discovery, production identity, V2 migrations and archive/restore closure, offline V2, and general third-party installation remain unsupported. No existing campaign lock is changed. Tracker #131 and production gates #139 and #145 remain open.
