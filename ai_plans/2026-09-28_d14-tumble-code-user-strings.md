# D14: "Tumble Code", not "Roo Code", in user-visible text

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, Priority 2, D14.
Branch: `chore/d14-tumble-code-strings` (off `main` @ `6f1e86c9f`).

## What the roadmap listed, and what was still there

- `WebAuthService` notifications: the information messages already said "Tumble Code Cloud"; the
  thrown errors (surfaced as error notifications by the sign-in flow) and log lines still said
  "Roo Code Cloud". Fixed.
- Custom modes schema title (`schemas/roomodes.json`): already "Tumble Code Custom Modes" on main.
- `packages/core/package.json` description: already "Tumble Code" on main.

## Other leftovers found by grep and fixed

A string-literal scan (`"..."`, `'...'`, `` `...` `` containing `Roo Code`) over the production
TypeScript of `src`, `webview-ui/src`, `apps/cli/src`, `packages/cloud/src` and `packages/core/src`,
plus all JSON values of `src/package.nls*.json` and both translation trees, found:

| Where                                                             | What the user sees                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/activate/CodeActionProvider.ts`                              | quick-fix menu titles ("Explain with Roo Code", ...)                                                                       |
| `src/activate/registerCommands.ts`                                | editor-tab panel title                                                                                                     |
| `src/core/webview/ClineProvider.ts`, `webview-ui/index.html`      | webview `<title>`                                                                                                          |
| `src/integrations/terminal/Terminal.ts`                           | terminal name in the terminal list                                                                                         |
| `src/api/providers/vscode-lm.ts`, `transform/vscode-lm-format.ts` | VS Code consent dialog text, error messages, logs                                                                          |
| `src/api/providers/lm-studio.ts`                                  | context-length error message                                                                                               |
| `src/services/mcp/McpConnectionManager.ts`                        | client name MCP servers see                                                                                                |
| `X-Title` in `constants.ts`, `image-generation.ts`, embedder      | app name on the user's OpenRouter activity page                                                                            |
| 17 translated `package.nls.*.json`                                | stale English copy of the cloud URL settings (old name and `roocode.com` examples); replaced with the current English text |
| `self-hosted-cloudapi` templates and `main.py`                    | sign-in result pages, OpenAPI docs title                                                                                   |

Package descriptions of `packages/cloud`, `telemetry` and `build` were updated for consistency.

## Left alone on purpose

- Internal names: `@roo-code/*` packages, `ROO_*` variables, identifiers (`RooCode*`, `roo-cline`),
  `HTTP-Referer` and `User-Agent: RooCode/...` (identifiers of the app, not display text), the
  `$id` URL of the modes schema.
- `src/utils/migrateFromRooCode.ts`: it imports a previous Roo Code installation and must name it.
- `ShadowCheckpointService` git author: lives in a hidden repository the user never sees, and
  existing repositories already carry it.
- Fork lineage text (README, LICENSE, CONTRIBUTING, the `announcement.handoff` translations).
- Code comments, test fixtures and e2e suite names.

## Regression guard

`src/__tests__/user-visible-brand.spec.ts` runs the scan above on every test run, with the two
allowed files and the lineage translation keys as the only exceptions, and pins the code action
titles and the OpenRouter `X-Title`.

## Verification

- Commit 1 (tests only) fails: the new spec lists 29 files, 5 existing specs fail on the new name
  (X-Title, webview HTML snapshots, terminal name, embedder headers), 13 cloud page assertions fail.
- After the fix: touched specs pass (user-visible-brand, constants, openai, openrouter, vscode-lm,
  lm-studio, vscode-lm-format, ClineProvider, CodeActionProvider, registerCommands,
  TerminalRegistry, embedder openrouter, McpConnectionManager; `packages/cloud` WebAuthService 54
  passed); cloud API full pytest 837 passed, 1 xfailed; `tsc --noEmit` clean in `src` and
  `packages/cloud`; eslint clean on touched files; `pnpm knip` exits 0.
