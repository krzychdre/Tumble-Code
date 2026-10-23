# R4 A4a follow-up: bundle @opentelemetry/api

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section A4a),
`ai_plans/2026-10-23_20-02_r4-a4a-anthropic-sdk.md`.

## Touched files

- `packages/build/src/extension.ts`
- `packages/build/src/__tests__/extension-build-options.spec.mjs`

## Problem

`extensionExternals` kept `@opentelemetry/api` out of the extension bundle because it used to be an optional peer
of `@mistralai/mistralai` 2.x that we did not install. `@anthropic-ai/sdk` 1.x (native tracing since 0.134)
depends on it and requires it at the top of `client.js` and `internal/tracing.js`. The VSIX is packaged with
`vsce package --no-dependencies`, so it has no `node_modules`: a bundle built on main after #982 contains 11
bare `require("@opentelemetry/api")` calls that nothing in the VSIX can satisfy.

## Change

`@opentelemetry/api` is no longer external, so esbuild bundles it (it is installed now, as a dependency of the
Anthropic SDK). `@opentelemetry/semantic-conventions` stays external for the Mistral 2.x tracing module, which
loads it inside a try/catch.

## Tests

- `extension-build-options.spec.mjs`: the release config must not list `@opentelemetry/api` as external
  (replaces the check that it was external). Mutation: putting it back into `extensionExternals` turns it red.
- `pnpm turbo run bundle --filter=tumble-code`: `grep -o 'require("@opentelemetry/[a-z-]*")' src/dist/extension.js`
  prints 11 lines before the change and nothing after.
- `packages/build` vitest (23 tests) and `tsc --noEmit`.
