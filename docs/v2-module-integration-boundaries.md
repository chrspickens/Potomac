# V2 module integration boundaries

The V2 authoring contract and CLI validate trusted bundled source. They do not turn modules into independently installable plugins.

Not yet supported:

- **General discovery/installation:** a checked-in repository-contained static trusted catalog now validates and registers allowlisted examples. No arbitrary directory/package discovery, staged installation, user installation, or marketplace exists.
- **Untrusted executable modules:** resolvers and effect-handler callbacks are imported JavaScript. The validator executes the entry file. There is no sandbox, process isolation guarantee, signature verification, or third-party trust root.
- **Generic browser mounting:** ordinary Campaign Home can open the experimental Rules workspace, which mounts validated bounded declarative contributions for catalog modules using the shared registry/renderer and host-checked command permissions. Starter, Revised 5e and Dice-pool are verified through this path; arbitrary module page routing and arbitrary UI components are unsupported.
- **Archive/migration lifecycle:** the separate #139 recovery increment provides versioned V2 snapshot/restore coverage for one configured campaign; there is still no general module migration runner or offline V2 reconciliation.
- **Offline V2:** V1 offline queues/reconciliation do not provide V2 command/reaction reconciliation.
- **Production authority:** V2 host remains gated/default-off and loopback-only. Development tokens are not production identity.

Authoring validation proves source consistency under the declared contracts. It does not prove host integration, browser usability, data migration, production security, offline operation, or independent installation.

## Static trusted catalog increment

The experimental `trusted-v2-catalog.json` allowlist and ordinary Campaign Home → Rules path let reviewed repository-contained providers be validated at host startup, listed to authenticated callers, pinned to a fresh campaign, and rendered through the shared declarative UI registry. Starter, Revised 5e, and Dice-pool use the same bounded `UiContribution` contract. Revised 5e displays its declared encounter fields/resources and submits initiative/combat actions; Dice-pool displays scene/resources, submits skill/contest actions, and projects an authorized durable reaction. Command identity, exact lock digest, selected entity revision and input are sent to the host. The UI reports success only after a host response, distinguishes authorization and stale-state rejection, and keeps the host projection authoritative.

UI array paths use bounded `*` segments that validate against the declared array item schema and read only arrays present in the already permission-filtered host projection. The renderer does not add a module-specific component system. Catalog startup now rejects an authored UI file that does not match the bounded node/command contract instead of silently omitting it.

The two trusted UI package updates are versioned: Revised 5e `1.2.0` and Dice-pool `1.1.0`. Their exact root digests now include their current declarative UI descriptors. A campaign pinned to a previous exact digest cannot be substituted with these new implementations; because the current allowlist keeps one version of each module ID and has no ruleset migration, such a lock fails closed until an appropriate prior implementation or explicit recovery path is available. This increment does **not** provide independent installation, arbitrary discovery, untrusted execution, or offline V2. Source remains reviewed trusted JavaScript with host process privileges.
