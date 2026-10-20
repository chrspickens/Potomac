# Guided preparation for trusted V2 modules

## Supported workflow

The V2 Rules workspace can show a module-neutral guided setup form when a trusted module has a preparation profile. The form uses a bounded list of human-readable labels and paths over a starter entity value. The host validates the complete result against the exact trusted entity schema before committing it through the existing entity creation endpoint. The generic form renderer contains no ruleset-specific branches.

The initial profiles cover the bundled Revised 5e encounter and Dice-pool scene. Their starter values and controls live in each module's `preparation.json`, alongside its declarative module source. The reviewed trusted catalog pins both the module root digest and the preparation metadata digest; each profile also states the exact module ID, version and root digest it describes. This metadata is not part of the executable module digest or campaign capability lock because it does not change rules, commands, schemas or effects. It is declarative trusted setup metadata; it does not execute module code. The catalog refuses to load a profile if either digest, module identity, entity type, field paths, assignment fields or starter value schema validation do not match. Adding a new profile requires review and new pinned digests.

Revised 5e currently models two player characters and an opponent inside one encounter entity. The guided form names the characters and assigns each to a currently enrolled player. Dice-pool likewise keeps two characters inside the scene entity. After the host creates that entity, the UI grants its assigned players read and act access through the existing host grant API. If a grant call fails after entity creation, the UI reports the partial state and leaves the same stable create operation available for retry; grants are upserts. The GM can also refresh and use the existing individual grant controls.

The host's V2 member roster is an authenticated, GM-only projection with member IDs and display names. It never returns credential values or hashes. Players cannot enumerate the roster. Credentials continue to be shown only once when the GM enrolls a player. The current local development host issues loopback-only test credentials; this flow is not a production identity/invitation system.

## Boundaries

- V2 remains default-off and loopback-only under the current experimental host configuration.
- The local V2 host supports one configured V2 campaign. These forms do not provide multi-campaign V2 hosting.
- Exact module locks are immutable. Preparation metadata does not upgrade or replace a pinned module.
- V1 campaign setup and schema-v5 backup/restore are unaffected.
- The guided profile exposes common setup fields; it is not a character builder, encounter editor, map/initiative setup flow or combat rules expansion.
- Entity creation and grants are separate existing host transactions. A failure between them can leave a created entity with incomplete access grants; the UI reports this and supports retrying the same create request and grants. An atomic compound preparation API may be needed if this becomes a demonstrated production reliability issue.
- Browser acceptance is automated Chromium evidence. Human GM/player usability testing remains open under #110/#111.
