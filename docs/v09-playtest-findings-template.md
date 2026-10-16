# Potomac v0.9 playtest finding template

Copy this template once per distinct, reproducible finding. Keep observations separate from hypotheses. Human findings must identify the participant role and device; automated findings must identify the runner and exact command. Link confirmed v0.9 work to [#109](https://github.com/chrspickens/Potomac/issues/109) and the playtest record [#110](https://github.com/chrspickens/Potomac/issues/110). Do not create a bug issue for a historical note unless it reproduces on the current build.

```markdown
## Finding title
[Short symptom and affected role/task]

## Status
- Result: CONFIRMED | NEEDS REPRODUCTION | BLOCKED | NOT A DEFECT
- Severity: S0 | S1 | S2 | S3
- Source: Human GM | Human Player A | Human Player B | Automation (`<runner>`)
- Date/time and timezone:
- Potomac commit / branch:
- OS + version:
- Device/model:
- Browser + full version:
- Viewport / zoom / input method:
- Screen reader / assistive technology + version, if relevant:
- Network condition:
- Role/profile: GM | Player A | Player B
- Checklist step:

## Expected
[What the participant should be able to see or do]

## Actual
[Exact visible result, wording, status, and whether the task completed. Quote participant words with consent and attribution.]

## Reproduction
1. [Start from a fresh disposable loopback host and identify the pinned module/version.]
2. [Exact action and role/profile.]
3. [Expected observable result and where it diverges.]

## Impact
- Who is affected and how often observed:
- Data loss / authorization / privacy impact: none | describe without repeating sensitive content
- Workaround or facilitator help required:
- Severity rationale:

## Evidence (sanitized)
- Screenshot filename(s), reviewed for credentials/private content:
- Sanitized log or request method/path/status:
- Exact automated command and exit code, if any:
- Do not attach bearer credentials, private campaign content, raw databases, or unsanitized network traces.

## Follow-up
- Confirmed current defect? Yes | No | Not yet
- Suggested owner: `clients/` | `server/` | `packages/` | `modules/` | `docs/`
- Regression coverage to add:
- Related issue / PR:
- Human observation remains pending? Yes | No
```

## Human observation sheet

Use one row per task and participant. Keep **actual** and **severity** empty until observed; do not prefill a pass.

| Date | Step | Role | Device/browser | Outcome (PASS/FAIL/BLOCKED/PENDING) | Expected | Actual / exact wording | Help or retries | Severity | Reviewed evidence filename |
|---|---|---|---|---|---|---|---|---|---|
| | | | | PENDING | | | | | |
