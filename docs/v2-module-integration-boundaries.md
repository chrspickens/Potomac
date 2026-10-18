# V2 module integration boundaries

The V2 authoring contract and CLI validate trusted bundled source. They do not turn modules into independently installable plugins.

Not yet supported:

- **General discovery/installation:** `server/host/v2-host.mjs` explicitly imports trusted examples and builds the campaign lock/provider maps. No directory/package discovery, staged registration, user installation, or marketplace exists.
- **Untrusted executable modules:** resolvers and effect-handler callbacks are imported JavaScript. The validator executes the entry file. There is no sandbox, process isolation guarantee, signature verification, or third-party trust root.
- **Generic browser mounting:** Revised 5e and dice-pool use dedicated routes and request wiring; declarative contribution validation is not a general module-driven workspace/router mount.
- **Archive/migration lifecycle:** V2 entities, effects, receipts and reactions have tested persistence slices, but there is no general module migration runner or complete archive/backup closure for V2 capability content and pending continuations.
- **Offline V2:** V1 offline queues/reconciliation do not provide V2 command/reaction reconciliation.
- **Production authority:** V2 host remains gated/default-off and loopback-only. Development tokens are not production identity.

Authoring validation proves source consistency under the declared contracts. It does not prove host integration, browser usability, data migration, production security, offline operation, or independent installation.
