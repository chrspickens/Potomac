# ADR-0015: Compose trusted V2 modules through task applications

- Status: Accepted for the experimental local-host integration
- Date: 2026-10-22

## Context

Trusted V2 campaigns had a separate Rules workspace that competed with the existing Characters, Encounters, and Table applications. This split made preparation, character access, and live play feel like parallel workflows. The trusted module contracts already own entity schemas, preparation profiles, declarative contributions, rules evaluation, and host-validated commands.

## Decision

Remove Rules from application navigation and compose three task views over the existing trusted V2 module infrastructure. Module entity descriptors and preparation profiles classify module-owned records; the client does not add system-specific schemas or rules. Characters displays separately declared character records when available, or uses trusted encounter schemas and host-provided ownership paths to display embedded character records. Encounters owns preparation, grants, and recovery. Table owns live module actions and reactions, authorized participant/spatial projections, and host-backed session lifecycle controls. Navigation and app handoffs preserve stable entity IDs.

Every task view continues to fetch the exact pinned lock, trusted catalog, authenticated principal, and host-authorized records. The host remains responsible for authorization, field filtering, revision checks, command validation, idempotency, and committed state. The immutable lock, V1 behavior, session contract, and loopback/default-off V2 boundary are unchanged. The Rules workspace implementation remains available as the shared renderer, but it is no longer a destination in the user-facing application navigation.

## Consequences

Users follow one preparation-to-play path through ordinary apps. Revised 5e and Dice-pool contributions are reused in Table without copying their rules logic. The UI distinguishes records by generic trusted module metadata and uses the host ownership paths for nested records; client rendering is not the authorization boundary. Modules that keep character data embedded in encounter entities show those character records in the read-only Characters roster; preparation and assignment remain in the module flow under Encounters.

The complete route remains experimental, single-campaign, loopback-only, and online-only for V2 commands. Browser acceptance covers navigation, role isolation, current session, module actions, and restart persistence; this is not human usability validation.

## Validation

Focused browser acceptance covers Campaign Home → Characters → Encounters → Table for GM and player roles, plus Revised 5e combat and Dice-pool action/reaction paths. The implementation PR records exact automated check results.
