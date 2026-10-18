# V2 module integration boundaries

The V2 authoring contract and CLI validate trusted bundled source. They do not turn modules into independently installable plugins.

Not yet supported:

- **General discovery/installation:** a checked-in repository-contained static trusted catalog now validates and registers allowlisted examples. No arbitrary directory/package discovery, staged installation, user installation, or marketplace exists.
- **Untrusted executable modules:** resolvers and effect-handler callbacks are imported JavaScript. The validator executes the entry file. There is no sandbox, process isolation guarantee, signature verification, or third-party trust root.
- **Generic browser mounting:** `/v2-modules` mounts validated declarative contributions for the Starter through shared registry/rendering and host-checked command permissions. Revised 5e and dice-pool retain dedicated compatibility routes; arbitrary module page routing and arbitrary UI components are unsupported.
- **Archive/migration lifecycle:** V2 entities, effects, receipts and reactions have tested persistence slices, but there is no general module migration runner or complete archive/backup closure for V2 capability content and pending continuations.
- **Offline V2:** V1 offline queues/reconciliation do not provide V2 command/reaction reconciliation.
- **Production authority:** V2 host remains gated/default-off and loopback-only. Development tokens are not production identity.

Authoring validation proves source consistency under the declared contracts. It does not prove host integration, browser usability, data migration, production security, offline operation, or independent installation.

## Static trusted catalog increment

The experimental `trusted-v2-catalog.json` allowlist and `/v2-modules` surface now let reviewed repository-contained providers be validated at host startup, listed to authenticated callers, pinned to a fresh campaign, and rendered through the shared declarative UI registry. Revised 5e, Dice-pool, and Starter are fully validated through the authoring contract. Starter demonstrates a player action and persistent effect/receipt/event through the generic browser surface. This narrows the bundled-composition gap; it does **not** provide independent installation, arbitrary discovery, untrusted execution, archive migration, or offline V2. The source remains reviewed trusted JS with host process privileges.
