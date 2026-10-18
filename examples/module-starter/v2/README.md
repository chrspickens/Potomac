# Starter narrative module

This starter illustrates a tiny trusted bundled V2 module shape. It is not independently loadable. Read `docs/v2-module-authoring.md` before using it.

The module has one public scene with progress 0–3. A GM submits `advance`; the pure resolver proposes a semantic outcome and a typed state effect. The host still owns authentication, permission checks, schema/revision validation, transaction and event persistence. The handler is trusted module code, not a built-in host operation.

The starter includes a complete capability closure. Its digest placeholders are deliberate. Run `pnpm v2:module digest examples/module-starter/v2`, replace every `sha256:` value in `capabilities.json` and `extensions.mjs` with that output, put the same value in `authoring.json.contentDigest`, then run `pnpm v2:module validate examples/module-starter/v2`. Digest normalization makes this two-step process stable; changing any non-digest source/content requires repeating it.
