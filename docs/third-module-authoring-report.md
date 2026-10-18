# Independent third-module authoring challenge

**Status:** Blocked before module implementation; no rules module was added.
**Baseline:** fresh `main` after merged PR #156, commit `a8891c7a332efdb664b3c063784b450ac96d6889`.
**Branch:** `codex/issue-131-third-module`.

## Result

An independent author received only `AGENTS.md`, public engineering/architecture/module docs, V2 contract declarations, and the root build/test script. They did not inspect host or bundled-module implementation. They stopped before coding because the public surface does not explain enough to author a module that can be validated or loaded without undocumented knowledge.

The first concrete blocker was that `effects.ts` declares effect proposal and descriptor shapes but does not publish the concrete available handler IDs, payload schemas, and accepted event schemas. Further blockers were the digest/pinning recipe, supported schema subset, module registration/discovery, and focused module test workflow. The independent-authoring result and internal integration audit are kept separate: seeing the bundled examples can explain the current code, but cannot retroactively make the initial interface self-documenting.

The separate read-only integration audit found that V2 currently supports **two explicitly bundled examples**, not independent module loading. The host imports module source and composes registries in `server/host/v2-host.mjs`; web entry points are bespoke (`/v2-combat` and `/v2-dicepool`). No module directory discovery or general contribution-to-page mount exists. A third bundled demonstration could be built by editing host imports/registration and adding a page, but that would not pass the independent authoring challenge.

## Evidence classification

| Class | Finding |
| --- | --- |
| A — public documentation gap | Concrete effect handlers and schemas; supported JSON-schema keyword subset; content/digest inputs; pinning flow; module registration and test recipe are not documented as a cohesive author guide. `docs/module-spec.md` is provisional V1 material and the V2 RFC describes proposed interfaces. |
| B — rules-neutral host extension | General discovery/staged registration, manifest-to-registry adapter, UI contribution mounting, digest/provenance workflow, migrations/archive closure, and safe trust/isolation story are absent. These are platform concerns, not game rules. |
| C — module defect | None identified: the attempt made no module and the audit was not a module code review. Module authors still own resolver semantics, schemas, handler declarations, stable IDs, and reference/digest consistency. |
| D — bundled-only limitation | Host imports Revised 5e and dice-pool explicitly, supplies their descriptors/callbacks, and mounts their pages via dedicated routes. Executable module code runs as trusted imported JS. V2 remains default-off, loopback-only, and lacks V1 offline reconciliation and general backup/archive integration. |
| E — rules-neutrality | The registry, generic extension command/entity kernel, typed effect transaction, resolver protocol, and durable reaction protocol are shared by Revised 5e and dice-pool. Their mechanics remain module-owned. This establishes reuse by two bundled providers, not independent installation. |

The host audit specifically points to `packages/module-registry/src/v2.ts`, `server/host/v2-extensions.mjs`, `server/host/v2-effects.mjs`, `server/host/v2-reactions.mjs`, `server/host/v2-host.mjs`, and `clients/web/src/workspace/v2-ui-registry.ts`. Existing implementations/tests are useful examples but are not a stable public authoring API merely because they are in the repository.

## Reusable and non-reusable interfaces

Genuinely reusable today inside the bundled host: exact capability references/locks; generic resolver input/output with host-provided randomness; typed entity and command descriptors; generic host authorization/revision/receipt/event processing; typed effects and atomic application; serializable continuations/reaction windows; and declarative UI descriptor validation/composition.

Still hardcoded or bundled: module discovery and registration; trusted-source and digest construction; composition of resolver/effect callbacks; bespoke UI routes and request wiring; module-specific authorization/audience callbacks; V2 bootstrap and campaign setup; and lifecycle beyond the tested SQLite proof (general migrations, archive/restore, and offline reconciliation). A third-party module cannot currently be installed or safely executed independently.

## Independent third-module blockers

1. Publish a complete author-facing module format, handler catalog/schemas, supported schema dialect, digest algorithm/input list, lock/pin workflow, and validation/test commands.
2. Add rules-neutral discovery and staged registration with exact lock validation and diagnostics, without executing untrusted code.
3. Mount authorized declarative contributions through a general host renderer/router rather than bespoke module pages.
4. Define the reviewed trust boundary for executable modules and close V2 migration, backup/archive, and offline lifecycle gaps before claiming broader deployability.

The source-writing challenge did not proceed past item 1. Items 2–4 are implementation/product boundaries, not something documentation can resolve by inference.

## Follow-up: authoring contract

PR #157 was the evidence-only result of the challenge above. This follow-up publishes the normative contract in [V2 module authoring](v2-module-authoring.md), adds the `pnpm v2:module` validator and starter template, and validates the current Revised 5e, dice-pool, and starter bundles. It also makes the generic host effect kernel reject malformed handler payload/event schemas at registration, with tests. This resolves the documentation-level handler/schema/digest/closure/test recipe blockers for trusted bundled source. The only host change is this rules-neutral validation-timing correction; it does not change the bundled-only loader, bespoke UI routes, trust boundary, or V2 lifecycle gaps listed above. Follow-up validation passed: focused CLI and type-contract tests, `pnpm build`, full `pnpm check` (including V1/V2, generic UI/reaction and both authenticated system browser regressions), and `git diff --check`.

## Follow-up: static catalog and generic UI

The next increment adds a reviewed repository-local allowlist, validates catalog packages and capability closure with the published CLI at host startup, composes provider descriptors/callbacks into the shared V2 kernel, and adds authenticated module listing/pinning plus `/v2-modules`. Revised 5e, Dice-pool, Starter, and legacy bundled examples are catalog providers. Legacy examples have checked sidecars while retaining historical root digests. The real-browser Starter flow covers GM selection/pinning and entity creation, player grant/command, one effect/event/receipt, exact and altered retries, unauthorized selection/commands, and restart recovery. The source remains executable reviewed trusted JS; this is not independent installation or a sandbox. General discovery/install, untrusted execution, migration/archive/offline V2 and production identity remain blockers.

## Validation and scope

`pnpm check` passed on the post-#156 baseline, including build, listed V1/V2 tests, debug smoke, workspace/campaign/offline/Table/Lore/Maps acceptance, generic V2 UI and reaction browser acceptance, and existing Revised 5e and dice-pool real-host browser regressions. `git diff --check` passed for this documentation change. No module tests or browser acceptance for a third system were run because no third module exists; no mocked acceptance was substituted. The challenge did not alter Revised 5e, dice-pool, Core, host behavior, credentials, or existing V1 behavior. It did not validate independent installation, production identities, migrations, offline V2, multi-process behavior, or marketplace distribution.

## Process note

An initial author dispatch accidentally exposed a runtime registry implementation path outside the requested public-contract allowlist. That attempt was stopped and discarded before any files were changed. The actual independent authoring attempt was restarted with the strict public-only allowlist listed above and did not read host, registry implementation, rules-engine implementation, bundled modules, or their tests. The separate internal audit began only after that attempt had stopped.
