# ADR-0014: Enter trusted V2 campaigns through normal campaign setup

- Status: Accepted for the experimental local-host integration
- Date: 2026-10-19

## Context

V2 trusted modules and their generic declarative workspace existed behind an experimental route, while ordinary campaign setup exposed only V1 modules. A GM needed a discoverable way to start a V2 campaign and players needed to resume it through normal application navigation. The host still configures one campaign and its V2 API is default-off and loopback-only.

## Decision

Campaign Home may list the host-provided trusted catalog only when the app and configured host are loopback. A GM may choose a catalog entry for a fresh campaign; the host validates and pins the exact module lock, digest, and capability closure. The UI never constructs lock provenance. The existing generic V2 renderer provides Characters, Encounters, and Table task views for both GM and authenticated enrolled players, as described in [ADR-0015](0015-v2-task-applications.md). The lock cannot be replaced by ordinary V1 setup, and V2 setup refuses an existing V1 pin or legacy campaign records.

This increment is deliberately limited to one configured campaign per host. It does not make V2 generally available over a network, add campaign selection, enable offline V2 queues, install third-party modules, or migrate module versions.

## Consequences

GM enrollment and one-time local credentials use the existing membership model. Players authenticate with their original credential and the host filters entities, reactions, and commands. V2 rulesets are labeled experimental, and blocked catalog/lock states remain visible rather than falling back to another module. Existing V1 campaigns keep their current navigation and workflows.

Full multi-campaign integration needs a durable campaign registry, campaign-scoped authentication/membership/authority, campaign selection and API routing, and verified isolation across persistence, events, assets, backups and restore. Remote production support also needs a separately reviewed identity and transport boundary.

## Validation

See the focused normal-flow browser acceptance and V1/V2 regression commands attached to the implementation PR. The host architecture and the remaining #139 backup/offline and #145 production signoff gates are tracked separately; this decision does not close those issues.
