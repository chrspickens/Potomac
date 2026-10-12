# ADR-0004: Keep one campaign per host and pin one exact system version

- Status: Accepted for the 0.4 requirements baseline
- Date: 2026-10-12

## Context

The 0.3 localhost host has one implicit `foundation-demo` campaign and can register multiple modules, but it does not provide user-facing campaign setup. 0.4 needs a real campaign boundary before persistent character and encounter data can be safely authored. Supporting multiple campaigns would also require campaign selection, isolation, membership scope, and migration semantics beyond the first playable flow.

## Options considered

- One campaign per host with one exact system module version: small, explicit boundary and straightforward migration; users run separate host data directories for separate campaigns.
- Multiple campaigns per host: better convenience but expands authorization, cross-campaign isolation, UI selection, and migration scope.
- Allow mixed system modules per campaign or silently follow latest compatible versions: flexible, but makes entity schema/rules provenance and restore behavior ambiguous.

## Decision

For 0.4, a host contains at most one configured campaign. The GM creates it explicitly, or an unambiguous legacy 0.3 `foundation-demo` is adopted once during migration. Each campaign pins one exact `(moduleId, moduleVersion)` pair. Other systems are verified on separate fresh hosts. Pin changes require a future explicit, backed-up, validated and audited migration; ordinary edits and restore do not upgrade modules.

## Consequences

The first-run and persistence model stays small and avoids cross-campaign permission bugs. Users needing distinct campaigns use isolated host databases. Each campaign record and character retains module/schema provenance. A missing pinned version blocks writes rather than silently substituting rules. Legacy adoption must detect ambiguity and preserve the original database on failure.

## Follow-up / validation

Verify empty setup, restart persistence, duplicate setup rejection, System A and System B on separate hosts, and migration of a copied 0.3 database with no duplicate campaign. See [Workspace 0.4 requirements](../workspace-0.4-requirements.md) and [issue #27](https://github.com/chrspickens/Potomac/issues/27).
