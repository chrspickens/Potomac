# ADR 0003 — Local enrollment and offline authority

**Date:** 2026-10-11  
**Status:** Accepted for the 0.3 experiment

## Context

Workspace 0.2 uses a shared development player token and keeps only presentation layouts in the browser. Update 0.3 needs to identify individual players, cache authorized character projections, and reconcile offline work without confusing local intent with committed host state. The user chose GM enrollment over player self-registration for this local-host experiment.

## Options considered

Player self-registration would reduce GM setup but requires a pending-account approval and abuse boundary before an identity exists. A cloud identity provider would simplify multi-device login but contradicts the self-hosted experiment. GM enrollment is narrower and makes membership an explicit host-side act.

## Decision

- The GM enrolls each player locally. The host assigns a stable member ID and issues a distinct credential. The credential is a bearer secret; the member ID and local layout profile are never authentication proof. Only a credential hash belongs in host persistence. This is not public-internet identity or invitation infrastructure.
- A player may remember that credential in this browser profile for offline reopening, as chosen for the experiment. The UI must offer a way to forget the device and must explain that local browser-profile access exposes both the credential and cached data. This is not encryption-at-rest or protection from a local machine administrator.
- Host permissions apply independently to every read, command, event replay, stream, proposal, and receipt. Actor ownership or a grant is a host record, not a dashboard binding.
- Browser caches contain only projections already filtered for that member. Cache and queue are separate, versioned stores partitioned by host, campaign, and member. Cache is potentially stale and does not imply current access. Revocation blocks future host access, but cannot erase previously downloaded copies.
- An offline operation is immutable intent with a stable ID, identity scope, entity and base revision, module/schema versions, and dependency basis. The client may display it as pending but never as accepted. Retries reuse the same canonical request. The host authenticates the submitting member, revalidates current state and permissions, then durably records one result for that operation ID.
- Routine policy may apply a compatible operation automatically. Significant policy yields a persistent GM proposal. Incompatible, unauthorized, or stale-dependent work must not silently overwrite committed data. Rejected and conflicted authored input can remain a private local draft.
- Proposals retain campaign, base revision, and submitted rules-version provenance as well as the canonical request. An approval must revalidate current policy and reject a changed rules version instead of applying a proposal under different rules. Existing experimental proposal rows receive nullable provenance columns on upgrade and continue through the prior revalidation path.
- The existing SSE cursor/snapshot route remains the notification transport for this experiment; stream messages are hints, not authoritative state. WebSockets, public TLS onboarding, cross-device sync, and verified offline dice are deferred.

## Consequences

This introduces credential and local-data recovery responsibilities. Client storage isolation prevents accidental cross-member rendering in one browser, not access by a local machine administrator. A user who loses a credential needs GM-led rotation/re-enrollment; no cloud recovery service is added. Data and event migrations must preserve old history and never silently grant a legacy shared token access to newly private actors.

## Follow-up and validation

Exercise two enrolled players, permission revocation, offline browser restart, lost acknowledgements, host restart, proposal review, and stale-dependency conflict in automated tests. Keep the implementation status in README and requirements accurate until those checks pass.
