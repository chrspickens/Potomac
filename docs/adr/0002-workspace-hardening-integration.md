# ADR 0002: Integrate Workspace hardening without replaying an older foundation tree

- Status: Accepted for the 0.2 hardening review route
- Date: 2026-10-11

## Context

`main` already contains the Workspace 0.2 implementation from PR #7. The older foundation PR #4 was built against an earlier `main` and still includes agent diagnostics and smoke CI absent from that Workspace merge. Its current diff conflicts with `main`; blindly merging the whole branch would risk replacing newer host and client behavior. The 0.2 hardening issues (#9–#14) require one reviewable route to `main` and preservation of the useful diagnostics.

## Decision

Prepare one hardening branch and integration PR into the current `main`. Bring forward the diagnostic CLI, documentation, and relevant smoke checks from PR #4 as deliberate file-level integrations, alongside the registry, shared evaluator, security, browser acceptance, and CI changes. Verify behavior and compare the resulting files and checks against PR #4 before calling it superseded. Do not force-push, overwrite the local demo SQLite database, or merge/close PR #4 merely because the new PR exists. Keep implementation status and deferred 0.3 capabilities explicit in the README and PR.

## Options considered

- Merge PR #4 directly: conflicts with the newer Workspace merge and risks restoring older host/client code.
- Cherry-pick every PR #4 commit: repeats foundation files already on `main` and makes conflict resolution harder to audit.
- Bring forward only missing diagnostics and checks into a new hardening PR: chosen because it preserves the latest implementation and leaves an explicit parity review.

## Consequences

The new PR will be larger than an isolated hardening issue but is reviewable as a single route to `main`, with the historical PR and branch left intact for parity review. CI and local acceptance results must be reported from actual runs. Remaining conflicts or missing parity must be resolved before the older PR is merged or explicitly superseded.

## Follow-up and validation

Compare the diagnostic command contract and CI coverage against PR #4, run `pnpm check` on the review branch, inspect the PR-to-`main` diff and CI result, then explicitly document whether PR #4 is fully superseded. Its closure is a separate repository action after that evidence exists.

## Parity audit for the review PR

GitHub `main` at `aa61033` contains the Workspace implementation and both concept-art PNGs through PR #7. PR #4 head `caf5052` carries the earlier foundation implementation plus `scripts/potomac-debug.mjs`, its documentation, and foundation smoke CI. The diagnostic CLI brought forward here preserves the `smoke`, `doctor`, and `watch` command contract and structured output; comparison with the old script found only its relocated import/help paths and the current stable fixture encounter ID in the context smoke check. The new `checks.yml` runs the diagnostic smoke as part of `pnpm check` along with the build, rules/host/workspace tests, and isolated browser acceptance. No older host/rules/client implementation files were taken from PR #4 over the newer Workspace code. Local `pnpm check` passed before the integration PR was opened; remote CI results belong in the PR record, not in this ADR.
