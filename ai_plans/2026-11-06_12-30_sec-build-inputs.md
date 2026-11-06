# Build inputs: never cache the agent-interchange bundle; dead runtime dependencies to dev

**Status:** done on `fix/sec-build-inputs`
**Related:** `private_docs/security-audit-2026-11-06/report.md` section 6 (P-6, P-16)
**Touched:** `packages/agent-interchange/turbo.json` (new), `packages/telemetry/package.json`, `packages/core/package.json`, `pnpm-lock.yaml`

## Problems and causes

- **P-6.** The root `build` inputs (`turbo.json`) list `src/**` and four config files. `@tumble-code/agent-interchange`
  builds with `node esbuild.mjs`, which bundles `@tumble-code/core` sources into `dist/mcp-server.mjs`. Measured with
  `turbo run build --dry=json`: the task hash stays the same after editing `esbuild.mjs` and after editing a file in
  `packages/core/src`, so a later turbo run restores an old `dist/` over a fresh one. The other two built packages
  (`types` with tsup, `build` with tsc) are covered by the list. The report's impact is overstated: the extension
  imports agent-interchange from source (`exports: ./src/index.ts`), so the stale `dist/` reaches only a locally
  installed MCP server, not the VSIX.
- **P-16.** `zod` in `packages/telemetry` is imported only by a spec; `openai` in `packages/core` only as
  `import type`.

## Fix

- `packages/agent-interchange/turbo.json` sets `build.cache: false`. Hashing core's sources as inputs would track a
  second package's tree for a build that takes 0.2 s.
- `zod` (telemetry) and `openai` (core) moved to `devDependencies`. The CLI release manifest is built from
  `apps/cli`'s own dependencies, so nothing else reads these lists.

## Tests

`turbo run build --dry=json` reports the agent-interchange build as not cached. `tsc --noEmit` in core, telemetry
and agent-interchange; `pnpm knip` clean.
