# V2 static trusted module catalog

**Status:** Experimental, host-local trust boundary. This documents `server/host/trusted-v2-catalog.json` and `server/host/v2-catalog.mjs`; it is not an installation or sandbox contract.

## Trust and source selection

Only module IDs explicitly listed in the checked-in catalog are available to the default V2 host. Each source directory must resolve inside this repository, and its entry must remain inside that directory. The host does not search the filesystem, accept a client path, fetch a package, or import uploaded artifacts. Adding a provider requires a reviewed repository change to the allowlist and a matching versioned manifest. This remains executable trusted JavaScript with host-process privileges; validation and digests do not provide isolation or publisher authenticity.

At host initialization, every listed source is validated through the published `pnpm v2:module validate` workflow. Capability manifests and closure, package/root digests, module identity/version, and descriptors are checked before callbacks are registered. Declarative UI contributions are checked against the same entity, command, workflow, and exact capability references used by the UI registry. Initialization fails closed on missing or invalid trusted source, conflicting identity, unsupported schema/UI, or digest mismatch. No fallback provider or automatic lock replacement exists.

The catalog currently contains Starship Systems, Revised 5e, Interruption Example, Dice-pool, and Starter. Legacy examples have authoring sidecars so their closure is validated while their historical host root digests remain unchanged. New providers should use the normal full-content digest recipe in [V2 module authoring](v2-module-authoring.md), not legacy mode.

## Registry composition and policies

The host composes provider entities, commands, workflows, resolvers, and semantic-effect handlers into the shared V2 extension kernel by descriptor shape and exact capability identity. Callbacks always come from the allowlisted entry, never from a request. Commands still pass the shared host's authentication, current-lock, role/grant, schema, revision, transaction, effect-target, receipt, and event checks. Resolvers receive host-owned random inputs and return proposals; handlers cannot choose the caller, transaction, or lock.

Where an existing module needs a command-intent authorizer or reaction-audience resolver, its reviewed catalog row names the exact export. The host derives dispatch keys from the provider's command descriptors; it has no module-ID-specific authorization switch. The callback is still executable trusted code. Authentication, membership, transaction authority, final permission checks, visibility, and persistence remain host-owned.

## Listing, pinning, and locks

An authenticated caller can read `GET /api/v2/modules`, which returns only approved identity/version, verified source digest, capability refs, entity/command descriptors, and validated declarative UI. It is catalog metadata, not a permission grant. A GM pins using `PUT /api/v2/campaign/lock` with exactly `{ "moduleId": "example.starter" }`. The ID must occur in the validated catalog. The host constructs an exact lock from the same refs that the CLI validated and commits it through the existing immutable campaign-lock transaction.

Every subsequent operation still requires the exact lock digest. Already-pinned campaigns cannot switch modules or versions. If a pinned source disappears or fails validation, the host fails closed; it does not substitute another provider. There is no general read-only recovery, migration, archive, or restore workflow in this increment.

## Generic browser surface

`/v2-modules` is one experimental workspace route. It reads the authenticated catalog and campaign lock, lets a GM choose an approved module only before pinning, creates entities from registered schemas, and mounts the pinned module's authorized declarative contributions using the existing `UiContributionRegistry` and `V2UiContributionView`. The host returns authorized entity projections and per-entity allowed command IDs; display bindings do not confer grants. Starter demonstrates entity creation and a granted player command through this shared surface. The renderer contains no Starter rules or module-specific controls. `/v2-combat` and `/v2-dicepool` remain compatibility demos.

UI actions use persisted operation IDs for retries. The generic route sends command identity, entity, revision, operation ID and input with the lock header; principal and campaign identity are host-derived. Clients cannot send trusted callbacks, resolvers, randomness, or effect proposals.

## Development and verification

1. Create a package with `manifest.json`, `authoring.json`, a complete `capabilities.json` closure, an `extensions.mjs` entry, and declarative UI files.
2. Run `pnpm v2:module digest <module-dir>`, apply the digest recipe in the authoring guide, then run `pnpm v2:module validate <module-dir>` and `pnpm v2:module:test`.
3. Add the reviewed module ID/version/source directory to `trusted-v2-catalog.json`; name callback exports only when a validated command contribution needs them. Do not put request-derived paths or package sources in the catalog.
4. Add catalog contract and real-browser coverage for listing, pinning, create/read/action grants, retry conflicts, privacy, and restart persistence.

The host remains default-off and loopback-only. Development bearer tokens are not production identities. Updating the static catalog is a reviewed deployment/code change, not live installation or ruleset switching.

## Explicitly out of scope

No marketplace, network downloads, arbitrary discovery, signatures, sandbox for executable modules, user-uploaded code, general migration/backup/archive support, offline V2, multi-process catalog synchronization, or live campaign switching is provided. Full independent installation and production identity remain gated by #139/#145 and the remaining boundaries in [V2 integration boundaries](v2-module-integration-boundaries.md).
