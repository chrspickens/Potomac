# V2 trusted bundled module authoring contract

**Status:** Normative for repository-bundled V2 modules validated by `scripts/v2-module.mjs`; not a third-party installation API.

This specification describes what a trusted source author must provide to make a V2 module internally coherent and testable. It does not authorize loading arbitrary module source. The validator imports `extensions.mjs`, so it executes that file with the developer's Node privileges. Run it only on source you trust and intend to bundle.

## Directory and files

Required files:

```text
<module>/v2/
  manifest.json       # bootstrap metadata, formatVersion 2
  authoring.json      # validator inputs and digest declaration
  capabilities.json   # complete CapabilityManifest[] for root and dependencies
  extensions.mjs      # trusted resolver/handler source and descriptors
  ui/*.json           # optional declarative contributions
  README.md           # human-readable rules and scope
```

`manifest.json` MUST have `formatVersion: 2`, a namespaced lowercase `id`, display `name`, exact SemVer `version`, `trust: "bundled-trusted"`, and a relative `entry` path. This is the current host bootstrap format; it is distinct from the full typed `CapabilityManifest` contract in `packages/contracts/src/index.ts`.

`authoring.json` MUST contain `digestFiles` (ordered relative file paths, including `manifest.json`, `entry`, `capabilities.json`, and every UI/content file), `contentDigest` (`sha256:` plus 64 lowercase hex characters), `capabilitiesFile` (default `capabilities.json`), and optional `uiFiles`. Do not include `authoring.json`: it stores the digest being verified. File paths are relative, cannot escape the module directory, and are hashed in listed order after CRLF-to-LF normalization, with one LF separator between files. Before hashing, every literal `sha256:` followed by 64 lowercase hex characters in the listed content is replaced by `sha256:<content-digest>`. This makes embedded exact refs and the root digest non-circular while still hashing the rest of the source and metadata. For module-owned capability entries, use the same package digest; external dependencies must be independently validated from their trusted source.

Every `CapabilityManifest` MUST contain: `formatVersion: 2`; namespaced lowercase `id`; `api: {id, apiVersion}` with `api.id === id`; exact three-part `implementationVersion`; `digest`; `kind` (`module`, `library`, `resolver`, `entity`, `command`, `workflow`, or `ui`); `provides[]`; `requires[]`; and `trust`. `trust` is `bundled-trusted`, `declarative-untrusted`, or `reviewed-handler`; this validator permits only bundled trusted module source. `conflicts[]` is optional. IDs follow the registry's lowercase dotted/dashed namespace grammar; versions are `major.minor.patch` without prerelease/build suffix. A dependency supplies `id`, supported `apiRange`, and boolean `optional`, with optional reason/compatibility metadata. Exact refs always bind ID, API version, implementation version and digest.

`capabilities.json` MUST include exactly one root capability whose ID/version match `manifest.json`, `kind` is `module`, and digest equals `contentDigest`. Every module-owned capability ref and manifest MUST agree on ID/API version/implementation version/digest; module-owned capabilities use the same package digest. A catalog entry listed in `authoring.json.externalCapabilities` is accepted as an external trusted capability only when separately validated against its own trusted source. The CLI checks that its exact ref/manifest and closure agree but cannot independently prove external source provenance from the consumer directory. Capability IDs MUST be unique per implementation version. The registry supports exact, `^`, `~`, and `*` API ranges; ranges select only while constructing a proposed lock. Missing required dependencies, cycles, conflicts, and incompatible ranges fail resolution.

The resolved lock is `CapabilityLock {lockVersion: 1, campaignId, rootModule:{id,version,digest}, entries}`. Each entry pins `id`, `apiVersion`, `implementationVersion`, `digest`, source, and `optional`; the resolver sorts entries by capability ID. The validator prints this proposed development lock but never writes it to a campaign.

## Typed module surface

The full declarations are the public TypeScript contracts in `packages/contracts/src/` (`CapabilityManifest`/`CapabilityLock`, `ExtensionEntityDescriptor`, `ExtensionCommandDescriptor`, resolver contracts, `EffectHandlerDescriptor`, reactions/workflows, and UI contributions). The trusted entry MUST export arrays/objects that structurally provide:

- at least one entity descriptor with `descriptorVersion: 1`, namespaced `typeId`, positive `schemaVersion`, exact capability reference, schema, ownership, visibility, creation roles, and migration identity;
- at least one command with namespaced ID, exact capability/entity references, input/result schemas, host permission descriptor, resolver ref and effect-handler refs;
- one or more pure resolver descriptors with exact `ResolverRef`, optional deterministic `randomRequests`, and `resolve` (plus `resume` when a continuation is used);
- one or more handler descriptors with exact handler ref, `atomic: true`, target type, conflict policy `reject-overlap`, target/event visibility, payload/event schemas and a pure `apply({entity,effect})` callback;
- optional workflow descriptors and UI JSON contributions. UI fields and commands must refer to the declared entity and command contracts.

An extension entity's schema describes `data`, while the record carries host-managed campaign/entity IDs, exact capability ref, schema version, migration ID, revision, visibility and owner. Commands bind one entity type, `inputSchema`, `resultSchema`, permission (`roles`, `ownership`, optional effect target/no-pending policy), resolver ref and allowed effect refs. Resolver `randomRequests` use unique request IDs and declare die/pool/draw counts and optional visibility; the host returns the values. UI contributions use `contractVersion: 1`, contribution ID/version/kind, exact UI/entity capability refs, entity schema/version, command/workflow catalogs, slots and declarative nodes. UI declarations are not authorization.

The current host-registered state handlers include `example.revised5e.encounter-state@1.0.0` and `example.dicepool.scene-state@1.0.0`; each has a distinct exact implementation version and digest in its module refs. These are module-defined handlers, not global built-ins. Do not reference an ID merely because it appears here: it must be present, exact-versioned and explicitly registered in the selected trusted host build.

For both named state handlers, the payload schema is an object requiring `state`, where `state` is an object; `state` is then validated against the target entity schema. The event schema requires string `effectId` and integer `revision` in the inclusive range 1–1,000,000. Their event kinds are `revised5e.encounter-updated` and `dicepool.scene-updated`; both are public, target their module's encounter/scene entity type, and declare `atomic: true` plus `conflict: "reject-overlap"`. This is an example of a module-owned whole-state replacement handler, not a built-in resource increment operation.

Resolvers receive committed state and host-generated randomness. They MUST NOT call ambient random APIs, access files/network/database, or trust principal, target, rolls, visibility, or authorization supplied in module state. They return semantic outcomes and proposed effects/continuations. The host authenticates, authorizes, checks lock/revisions/visibility, validates effects, applies a transaction, and records receipts/events. A UI binding never grants permission.

## Effect handlers and authority

There is currently no general catalog of built-in operations such as `resource.delta`. The generic host-provided operation is the **transactional effect protocol**: it checks the handler ref against the trusted handler registry, validates the proposed payload against that handler's schema, verifies target type/revision/visibility and host authorization, calls its registered `apply` function without giving it database access, then validates the returned data/revision/event against host invariants and handler event schema before commit.

The effect handler ID, API version, implementation version, digest, payload schema, event schema, event kind, visibility policy, target type, conflict policy and application function are **module-defined reviewed code** in current examples and must be explicitly registered by trusted host bootstrap. The module cannot self-register at runtime. The `EffectHandlerRef` in commands/proposals must exactly match the registered descriptor. A handler cannot choose its own authority: the host retains identity, permissions, capability lock, target/read checks, revision checks, atomic commit, audit events and player-visible filtering. Never put arbitrary database paths or a client-supplied principal in an effect payload.

The resolver-facing `ProposedEffect` intentionally carries a handler ID string and target ID without an expected revision. It is not the persisted/host `SemanticEffectProposal`. The extension adapter resolves the string only among the command's declared exact handler refs, binds the target's current authorized revision/visibility, and constructs the host proposal. A missing target revision is stale; a handler not declared by that command is unsupported. Targets are applied in stable effect-ID order, and overlapping targets within one proposal are rejected. `apply` receives only frozen `{entity,effect}` JSON (no DB or transaction handle) and MUST return `{data, revision: entity.revision + 1, event:{kind,visibility,payload}}`. The host validates entity data with its entity descriptor, requires the declared event kind/visibility, rejects nested visibility fields, validates the event payload schema, then commits target revision, event and receipt atomically. Hidden event data is excluded from public projections.

## Schema dialect and limits

The current host validator is a deliberately small subset, not JSON Schema 2020-12. Allowed keywords: `type`, `properties`, `required`, `additionalProperties` (boolean only), `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, and `const`. Types are `object`, `array`, `string`, `integer`, `number`, and `boolean`; a null value can be allowed with `const: null` or an `enum` containing null, not by a union type. `required` checks presence, not truthiness. Numeric bounds are inclusive. String lengths use JavaScript string length (UTF-16 code units). With `additionalProperties` omitted, extra object properties are allowed and are not recursively checked; use `false` for closed inputs.

Object schemas require `properties`; `required` entries must name declared properties. Arrays require `items`. Schema definitions are limited to nesting depth 32. String/array bounds are non-negative integers and min cannot exceed max; numeric bounds must be finite and ordered; enum must be a non-empty array. Objects reject `__proto__`, `prototype`, and `constructor` property/required names. The validator does not implement `$schema`, `$ref`, `oneOf`, `anyOf`, `allOf`, `pattern`, formats, tuple items, numeric multipleOf, or schema-valued `additionalProperties`; unsupported keywords fail closed. The host effect kernel validates payload/event schema definitions when trusted handlers are registered, then validates each submitted payload and returned event against those schemas. Resolver execution defaults are max 128 random values, 64 outcomes, 64 effects, 128 decisions, 1,000,000 bytes state, 256,000 bytes input/resume, JSON depth 32, and 2,000,000 bytes transcript. Extension JSON records/commands have a separate 128 KiB serialized size bound in the extension kernel. These are implementation limits, not a promise that all V2 surfaces currently share identical bounds.

## Content digest and immutable locks

Run the validator after every source/content change. It recomputes the listed-file SHA-256 and rejects a mismatch. A capability lock is proposed from the full capability manifest set using the registry's deterministic dependency resolver; it records root and transitive capabilities with exact API version, implementation version, digest and source. A campaign pin is immutable: **never recompute or replace a lock for a campaign that already has one**. Lock construction here is a development preview, not a campaign pin operation.

For compatibility, the currently bundled Revised 5e and dice-pool bootstrap root digests predate this format and are computed by `server/host/v2-host.mjs` with historical file selections. Their `authoring.json` sidecars record both a complete authoring content digest and the historical host digest. Revised 5e's historical digest covers manifest, entry, and combat UI; dice-pool's historical host digest covers manifest and entry but omits `ui/scene.json`. The validator checks that UI file in the complete authoring digest and reports the historical host digest separately. This omission is a known integrity boundary; changing the existing root digest would invalidate exact campaign pins, so this PR does not change it. Future bootstrap integrations should use the canonical complete content digest and require an explicit compatibility/migration plan.

## Versioning, tests and trust

Use SemVer implementation versions and exact API versions. Bump the module implementation version when behavior/content changes; bump entity `schemaVersion` and provide an explicit migration identity when persisted shape changes. Update `authoring.json` digest and root capability digest after edits. Do not mutate a campaign's existing exact lock.

These modules are trusted bundled JavaScript, not sandboxed plugins. Do not represent `declarative-untrusted` metadata as making a JavaScript entry safe. There is no independent installation, signature/trust root, untrusted execution isolation, general migration runner, archive migration, offline V2, or generic browser mounting. See [V2 integration boundaries](v2-module-integration-boundaries.md).

Run `pnpm v2:module -- validate examples/example.dicepool/v2` (or Revised 5e). Contract tests run under `pnpm check`; focused command is `pnpm v2:module:test`.
