# Potomac Core — foundation experiment v0.1

## Hypothesis

One generic Characters app and reusable brick can render two different fictional RPG systems and execute rules through a common engine; a self-hosted campaign can coordinate live state, audit changes and reconcile offline player edits without central cloud infrastructure.

## Deliverable boundary

Localhost development demo: Node host + SQLite; two browser clients (GM and player); one fixed dashboard per role; two fictional module folders; one actor in each; minimal activity history. No distributable product, no production-grade internet-facing hosting.

## Checkpoint 1 — module and rules spike

- Monorepo with shared types, schema/manifest loader and validation.
- Fictional **System A**: Strength/Intelligence, HP/Mana, d20 and spend-mana action.
- Fictional **System B**: Agility/Instinct, Stress/Hope, two dice and spend-hope action.
- Compact generic sheet and full editor read UI definitions, show resources and execute typed actions.
- Test wrong schema, missing capability, divide by zero, out-of-bounds resource, execution-budget exhaust, and inconsistent types.

**Gate:** no checks against `system-a` or `system-b` IDs inside Characters or the core engine.

## Checkpoint 2 — online host

- Host persists campaigns, actors, module versions and events in SQLite.
- Fixed GM/player roles and *server-side* secret filtering, including log/subscription payloads.
- WebSocket updates connected clients on valid HP/resource action and on GM switching `session.activeEncounter`.
- Operation deduplication and durable revision/cursor; reconnect catches up after missed notification.
- Host-supplied dice randomness; log outcome as verified live roll.

**Gate:** independent clients converge, private GM notes never appear in player network responses, and retried commands apply once.

## Checkpoint 3 — offline review and conflicts

- Client stores permitted character snapshot plus queued operations in IndexedDB.
- Offline equip existing item auto-accepts on reconnection when valid.
- Offline ability score change becomes a GM-review proposal and can be accepted/rejected.
- GM removes item while player offline; attempted equip becomes visible conflict, never resurrects item.
- Player can retain rejected change as private draft.

**Gate:** changes remain clearly labeled pending until host confirmation; no silent lost edits or stale overwrites.

## Acceptance checklist

- [ ] Two modules installed/registered from files
- [ ] Two materially different character layouts via same view implementation
- [ ] Rules evaluated with safe structured IR and deterministic validated effects
- [ ] Brick and full view reuse commands and state
- [ ] GM and player see distinct authorized projections
- [ ] Active encounter context updates subscribed bricks without changing layouts
- [ ] Live actions and dice outcomes recorded exactly once with actor and rule version
- [ ] Offline queue resubmits with idempotent operation IDs
- [ ] Policy-approved edits sync automatically
- [ ] Proposals are reviewable, accepted or rejected
- [ ] Conflicts are displayed and do not silently overwrite host changes

## Suggested repository structure (aspirational)

```text
clients/web/
server/host/
packages/contracts/
packages/module-registry/
packages/rules-engine/
packages/characters/
packages/brick-runtime/
packages/sync/
modules/system-a/
modules/system-b/
docs/
```

## Implementation constraints

Prefer TypeScript, React, Vite, Node/Fastify, Socket.IO, SQLite/Drizzle, IndexedDB/Dexie, Ajv and Vitest as starting candidates. Verify actual dependency versions and tooling before writing a lockfile. Electron and wide-area networking are deferred.

## Exit decisions

After the spike, record architecture findings: whether JSON rules IR suffices, necessary app/brick contracts, sync/conflict complexity, threat model, and whether to expand the foundation or revisit assumptions.
