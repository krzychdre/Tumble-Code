# Rename the workspace packages from @roo-code/_ to @tumble-code/_

Date: 2026-10-02
Branch: `refactor/rename-roo-code-packages` (stacked on `docs/readme-drop-upstream-docs-links`)

Owner, 2026-10-02: rename the `@roo-code/*` packages (and the `ROO_CODE_*` env vars, own branch).

## Change

`@roo-code/` -> `@tumble-code/` in every tracked file except `ai_plans/` and `CHANGELOG.md`
(history): package names, dependencies, imports, `vi.mock` targets, tsconfig / vite / esbuild /
knip / eslint configs, turbo filters, docs. 13 packages; `@tumble-code/cli` already had the
new scope, so there is no clash. `pnpm install` regenerated the lockfile and the workspace links.
`src/services/web/__tests__/WebFetchService.spec.ts` holds binary bytes, so `git grep -I` skips
it; replaced byte-wise.

Not package names, left alone: `roo-code-settings.json` (export file name),
`originator: "roo-code"` (OpenAI Codex), the responses-api User-Agent, issue-template ids.

## Verification

check-types + lint 22/22, extension bundle and webview build pass, full `turbo test` run:
all suites pass except two failures caused by the earlier branches of the same stack (message
registry count, lucide icon golden); fixed in those branches.
