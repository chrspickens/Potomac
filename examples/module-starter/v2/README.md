# Starter narrative module

This starter illustrates a tiny trusted bundled V2 module shape. It is included in Potomac's reviewed static trusted catalog, so it can be selected for a fresh experimental campaign and exercised through the generic V2 module workspace. It is not independently installable: adding or changing a catalog entry requires repository review and a host release.

The module has one public scene with progress 0–3. A GM submits `advance`; the pure resolver proposes a semantic outcome and a typed state effect. The host still owns authentication, permission checks, schema/revision validation, transaction and event persistence. The handler is trusted module code, not a built-in host operation.

The starter includes a complete capability closure and declarative scene editor. Its checked-in digest is validated by both `pnpm v2:module validate examples/module-starter/v2` and the trusted catalog loader. When editing it, run `pnpm v2:module digest examples/module-starter/v2`, update the normalized digest references in `capabilities.json`, `extensions.mjs`, and `authoring.json`, then run `pnpm v2:module validate examples/module-starter/v2`. Digest normalization makes this two-step process stable; changing any non-digest source/content requires repeating it.

The catalog executes only explicitly allowlisted local JavaScript. The allowlist is a code-review trust boundary, not a sandbox; do not add user-provided or downloaded code.
