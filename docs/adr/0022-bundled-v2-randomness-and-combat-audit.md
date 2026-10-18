# ADR-0022: Host-supplied randomness for bundled V2 actions

- Status: Proposed
- Date: 2026-10-17

## Context

The V2 resolver contract accepts a host-owned randomness transcript, but a playable command can need staged rolls: the attack d20 determines whether and how many weapon damage dice are needed. Accepting client-provided values would let a player choose outcomes; drawing eagerly would consume irrelevant rolls on misses. Combat results also need to survive retries and restarts without rerolling.

## Decision

For the bundled Revised 5e proof, a trusted resolver may request bounded, named dice pools from the V2 host in phases. The host draws each value with its cryptographic random source, includes the draws in the canonical resolver transcript, publishes the bounded roll list and transcript digest in authorized audit events, and persists the complete transcript with the command receipt in the same transaction as effects and state. Exact retries return the persisted receipt; a changed payload reusing the operation ID conflicts. The client command schema does not accept randomness.

This is not a sandbox for untrusted module code. Host randomness phases are available only to trusted registered resolvers whose exact capability references are in the campaign lock. The browser may display authorized roll audit data but cannot select a roll or gain authority from its UI contribution.

## Consequences

The generic host extension kernel owns the draw source and transaction; game-specific rules choose the bounded requests and interpret the transcript in the versioned Revised 5e module. Public events expose only public outcomes and requested random values, while player projections continue to remove GM-only entity fields. Production entropy operations, publisher trust, backup/restore, multi-process behavior and power-loss guarantees remain separate work.

## Validation

The Revised 5e host integration test must verify host-only draws, no draws for unauthorized or illegal actions, public audit projection, exact retry and restart recovery. A real-browser run with independent GM and player contexts is still required before describing the encounter as accepted/playable.
