# Product vision and scope (v0.1)

## Problem

TTRPG groups juggle unrelated character sheets, setting notes, encounter planners, maps and live play tools. Context is repeatedly copied between them, and host availability may prevent players from working between sessions.

## Vision

**Potomac is a local-first, self-hostable TTRPG creative and play workspace.** It hosts a modular suite of interoperable apps; users compose their own dashboards from app-provided bricks, and game-system modules adapt apps to different rulesets.

Potomac should remain useful without any Potomac-operated cloud service.

## Product principles

1. **One identity, multiple views.** The same character or encounter may appear in many apps/bricks, without duplicating authoritative records.
2. **User-owned presentation.** GMs and players arrange bricks and grouped dashboards to suit their workflows.
3. **GM-governed disclosure.** A GM controls players' access to campaign information and privileged actions; a dashboard binding never bypasses access checks.
4. **Separate layout, bindings and state.** A combat dashboard can follow the host's active encounter, while other bricks pin permitted content.
5. **Focused bricks; complete apps.** Bricks support useful actions (edit HP, equip an item, prepare spells); full apps handle workflows such as creating characters or designing encounters.
6. **Local-first, server-authoritative.** Players may work with locally available permitted content offline. Accepted shared gameplay state is owned by the campaign host.
7. **Versioned and inspectable.** Accepted changes, dice rolls, approvals and corrections are recorded in an audit history.
8. **System-neutral core.** Do not embed D&D-specific constructs in the platform; modules provide schemas, actions, derived values and UI hints.
9. **Portable data.** Campaign backups and exports must be supported so users can retain access independently of the project's continued operation.

## Intended experiences

- GM prepares lore, actors and encounters offline, then hosts a session.
- Players arrange Combat, Character and Notes dashboards independently.
- GM activates Encounter B. All bricks following `session.activeEncounter` resolve Encounter B, subject to each viewer's permissions.
- Players update routine state and see live updates; the GM can inspect the event history.
- A disconnected player edits allowed equipment and creates a proposed advancement. On reconnect, allowed compatible edits sync; the advancement is reviewed.
- A full Characters app and compact character brick operate on the same shared character state.

## Scope split

### Foundation experiment

Two fictional game systems; one generic Characters view/brick; a constrained rules evaluator; a simple host and two clients; basic access filtering; a live log; a small offline change queue and review/conflict flow.

### Later product

Full Lore, Characters, Encounters, Table and Maps apps; dashboard editor; published module SDK; richer rules and editor; dedicated server packaging; remote connection assistance; content publishing; collaborative rich text.

## Explicit non-goals for the first experiment

Production VTT, complete licensed game rules, a fully fledged programming language, public module marketplace, user account cloud, matchmaking, fully robust PWA offline support, cross-device player identity sync, advanced CRDT rich text, automated internet tunneling.

## Business and distribution posture

A community/passion-project orientation with **no obligatory central hosting bill**. Self-hosted deployments still require security maintenance, versioned migrations, documentation, reliable backups and a clear licensing decision.
