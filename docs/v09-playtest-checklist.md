# Potomac v0.9 playtest checklist

Issue [#110](https://github.com/chrspickens/Potomac/issues/110), under tracker [#109](https://github.com/chrspickens/Potomac/issues/109).

This is a repeatable session script and evidence log. It deliberately separates disposable Chromium automation from observations that require a real GM and two people. A passing browser runner is not a human usability, touch, network-loss, or screen-reader result.

## Status at 2026-10-15

| Evidence class | Status | Evidence |
|---|---|---|
| System A automated browser flow | PASS | `pnpm acceptance:campaign` completed with a fresh host, GM, and two isolated player contexts. It covered campaign setup, character/encounter preparation, grants, Table roster, start/pause/resume, restart persistence, layout reload, backup/restore, and redaction. |
| System B automated smoke | PASS | `pnpm acceptance:system-b-table` completed with a fresh pinned System B host, generic Table start, player action, private-field HTTP/SSE/DOM redaction, and reconnect. |
| One complete paced System A session with a human GM + Player A + Player B | PENDING | No human participants were available in this run. Do not mark complete from Chromium output. |
| Real device, touch, screen reader, and physical network interruption | PENDING | Not exercised. Existing browser automation and request blocking are not substitutes; retain the boundary tracked by #88. |

No product defect was filed from this run: the two automated commands passed and no human observation exists yet from which to derive a reproducible usability defect. When a real session finds a defect, add a follow-up issue using the template below and link it from #110; do not convert an unverified suspicion into a finding.

## Before the session

The GM prepares a disposable loopback host and records date, Potomac commit, browser/version, viewport, OS, and role. Use generated credentials and fictional content only. Never paste bearer tokens, private campaign text, raw databases, or unsanitized network traces into an issue or screenshot.

Create three separate browser profiles or contexts:

- GM: host administration and private preparation.
- Player A: member credential A and only A's granted character/content.
- Player B: member credential B and only B's granted character/content.

Use a simple scenario: one System A campaign, two characters, one encounter, one Lore article, one World Map, one Battle Map, and one private GM note/pin. Agree beforehand which item is shared and which remains GM-only. Keep a timestamped observation log; the facilitator should not rescue a participant without recording the point of confusion.

## Human System A walkthrough

For every row record: outcome (`pass`, `blocked`, or `confusing`), elapsed time if useful, exact UI wording, role/profile, browser/device, repro steps, expected behavior, actual behavior, severity, screenshot/trace filename, and privacy impact. A participant may stop or abandon a task; that is evidence, not a failed test to hide.

| Step | Actor | Action | Expected result | Human-only observation to capture |
|---|---|---|---|---|
| 1 | GM | Open Campaign Home and create/select the System A campaign | The pinned module and campaign state are clear; no unrelated campaign is shown | First-run discoverability, loading/empty/error wording |
| 2 | GM | Create or link Character A and Character B | Stable identities are visible and edits are acknowledged as committed | Whether “create”, “link”, grant, and save concepts are understandable |
| 3 | GM | Enroll Player A and Player B, privately deliver each credential, grant each character | Each player can join without seeing the other member’s credential or private fields | Handoff time, credential mistakes, privacy exposure in copy/screen sharing |
| 4 | GM | Create an encounter, assign both characters, and open the encounter/Table flow | Participant roster and active context are obvious | Preparation-to-live-session handoff and duplicate/unclear controls |
| 5 | GM | Create Lore; publish one article and keep one note private | Shared article is available only where authorized; private note stays GM-only | Publication/revocation language and whether state is visibly committed |
| 6 | GM | Create World and Battle maps; add representative pieces/pin; publish the intended view | Players can find the shared map; private pin/note is absent from player views | Asset upload, map selection, zoom/pan, and map-to-Lore navigation |
| 7 | GM | Activate the encounter and start the table session | GM sees an authoritative active state; players see read-only/current state | Whether the active encounter and session status are easy to locate |
| 8 | Player A/B | Join, find Character, Table, Lore, and shared map from the landing/navigation surfaces | Each player can return to the active session without GM help | Search terms, navigation dead ends, stale loading/error states |
| 9 | GM | Pause, resume, and finish the session | All three clients converge on the committed state; controls are role-appropriate | Latency, wording, duplicate clicks, and whether “paused” is distinguishable from offline |
| 10 | GM | Revoke the Lore or map share; have players refresh/search/reconnect | New reads and search results omit revoked material; cached-copy limitation is understood | Whether stale content or metadata remains visible, and privacy implications |
| 11 | Player A/B | Reload and return to the session; optionally use the offline/cache path | Pending/local state is not presented as committed; reconnect reconciles authoritatively | Recovery instructions, uncertainty, and device/browser storage concerns |
| 12 | GM + players | Finish with a short debrief | All findings have owner, severity, repro, and evidence | What each person expected, not just whether the facilitator completed it |

### Severity rubric

- **S0 / privacy or authority:** unauthorized title, count, content, event, credential, or stale metadata is visible; a player can perform a GM-only action; or UI claims an uncommitted change is committed.
- **S1 / session blocker:** a role cannot complete a required step, loses the active session, or cannot recover without data loss or manual database work.
- **S2 / major friction:** the task is eventually possible but a participant is likely to abandon it, needs facilitator rescue, or repeats an error.
- **S3 / minor friction:** wording, layout, focus, or feedback is confusing but the intended path remains discoverable.

## Representative System B smoke

Run this after the System A setup, preferably on a fresh host pinned to `example.system-b` so System A data cannot mask module assumptions. GM creates one System B character/encounter, enrolls one player, starts the generic Table session, and submits one System B action. Verify the GM-only field is absent from player DOM, HTTP response bytes, SSE/replay data, and refreshed state. Take the player offline using the supported browser test method, reconnect, and verify the authoritative active-session state. Repeat the same human evidence fields as above. This is a smoke test, not a second full campaign walkthrough.

## Automated evidence commands

Run from the repository root with Node 22.5+ and pnpm 11.25.0:

```text
pnpm acceptance:campaign
pnpm acceptance:system-b-table
pnpm check
```

The first two commands use temporary loopback hosts, databases, credentials, and isolated browser contexts. Preserve stdout and sanitized traces only. `pnpm check` is the required integration gate; report the exit code and CI URL, and do not claim CI is green until the GitHub Actions run exists and succeeds.

## Finding / follow-up issue template

Use one issue per defect. Link it to #110 and, if it is a v0.9 fix, to #109. Include:

```markdown
## Observation
- Severity: S0/S1/S2/S3
- Found by: human GM / Player A / Player B / automation (name the runner)
- Date, commit, browser/device, viewport, role/profile:
- Privacy impact: none / describe exactly what was exposed

## Reproduction
1. Start from a fresh disposable host and state the pinned module.
2. ...

## Expected
...

## Actual
...

## Evidence
- Screenshot(s) without credentials: `docs/evidence/...`
- Sanitized trace/log: `docs/evidence/...`
- Automated command and exit code, if applicable:

## Follow-up
- Suggested owning layer: `clients/`, `server/`, `packages/`, `modules/`, or `docs/`
- Regression test required:
- Related issue: #110 / #109 / other
```

## Privacy and evidence rules

Use fictional names/content and generated credentials. Crop screenshots before commit. Inspect traces for bearer tokens, private Lore text, member IDs, request bodies, database paths, and local filesystem details. Player evidence must verify absence from rendered DOM and, for privacy findings, from actual HTTP/SSE/replay bytes; a hidden element alone is not evidence of authorization. Remember that revocation blocks new authorized reads but cannot erase a copy already downloaded to a browser profile.

## Outstanding human signoff

This checklist is ready for a facilitator, but the full System A walkthrough, System B human smoke, physical device checks, and screen-reader checks remain **PENDING**. #109 must remain open until the release owner accepts the outstanding QA debt and the required post-merge CI evidence is green.
