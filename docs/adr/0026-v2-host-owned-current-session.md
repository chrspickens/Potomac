# ADR 0026: V2 host-owned current session

- **Status:** Accepted for the experimental single-campaign V2 host
- **Date:** 2026-10-20

## Context

V2 Campaign Home, Rules, and Table navigate a pinned module entity but do not share an authoritative current-session state. V1 has a durable session lifecycle, but routing V2 encounters through V1 would couple V2 to V1 encounter and rules semantics. Copying encounter state into a session would introduce competing authorities.

## Decision

The V2 host stores one current-session record per configured campaign. It references an existing module-owned encounter or scene by stable entity ID and stores only session lifecycle metadata. Start and Finish are GM-authorized commands. Each command validates the authenticated campaign authority, immutable exact module lock, expected session revision, and current entity revision in an immediate SQLite transaction. A stable operation receipt binds retries to the original request and result.

Start is rejected while another session is live. Start and Finish are rejected while a reaction or continuation remains unresolved for the referenced entity. Finish marks the session ended without modifying or copying the encounter. The previous V1 session lifecycle remains unchanged. Pause/Resume, multi-campaign routing, a separate combat engine, and a generalized session framework are out of scope.

The host exposes a filtered current-session projection. A player receives the encounter ID and title only when current entity visibility, ownership, or grants allow them to read it. Otherwise a live-session status may be shown without entity identifiers or names. Campaign Home, Rules, and Table consume this same projection and represent connection state separately from session state.

## Consequences

- Host restart and exact retries preserve session status and transition results.
- Encounter data and combat history remain owned by the pinned module entity.
- Session start/finish participate in host transaction rollback and cannot partially apply.
- The experimental loopback-only and single-configured-campaign restrictions remain in force.
- Browser automation verifies the workflow; human playability assessment remains tracked under #110.
