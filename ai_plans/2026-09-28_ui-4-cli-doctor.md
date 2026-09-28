# UI plan §4 (CLI), part 2: `tumble doctor`

Source: `ai_plans/2026-09-27_ui-modernization.md` §4, bullet "`tumble doctor`: checks the extension bundle, ripgrep,
Node version, MCP config and cloud reachability". Branch `feat/ui-4-cli-doctor`, stacked on `feat/ui-4-cli-color-crash`.

## What existed

Nothing: `apps/cli/src/main.ts` registers the default run action, `list`, `upgrade` and `auth`. The binary is `tumble`
(`apps/cli/package.json` `bin`). A missing bundle or ripgrep only showed up mid-session.

## Design

`apps/cli/src/commands/cli/doctor.ts`: one pure function per check, each returning `{ name, status, detail }`, a
`runDoctor({ checks, write })` that runs them in order, turns a throwing check into a `fail` line, prints
`formatDoctorReport` and returns the exit code (1 when anything failed).

| Check            | Source of truth                                                                    | pass / warn / fail                   |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| Node.js          | `install.sh` `MIN_NODE_VERSION=22`, tsup `target: node22`                          | fail below 22                        |
| Extension bundle | `--extension` or `getDefaultExtensionPath` (the same lookup `run` uses)            | fail without `extension.js`          |
| ripgrep          | `ROO_RIPGREP_PATH`, then the `@vscode/ripgrep` layouts under the CLI package root  | fail if missing or `--version` fails |
| MCP config       | `resolveMcpSettingsPath(settings.mcpSettingsPath)` (the same file `run` passes on) | pass when absent, fail on bad JSON   |
| Cloud            | `ROO_CODE_API_URL` or `https://app.tumblecode.dev` (`getRooCodeApiUrl` precedence) | warn when unreachable within 3 s     |

- The cloud check is a `warn`, not a `fail`: sessions run without the cloud; only sharing and remote control need it.
  Any HTTP status counts as reachable; `redirect: "manual"`; `AbortSignal.timeout(3000)`. Undici's `fetch failed`
  hides the reason in `cause`, so the detail appends its code (`ENOTFOUND`, `ECONNREFUSED`).
- The ripgrep candidates are the subset of `src/services/ripgrep` `ripgrepCandidatePaths` that can exist under a
  node_modules directory (the asar and VS Code universal layouts cannot in the CLI), with the extension's
  `appRoot` = CLI package root. The package-root walk moved from `extension-host.ts` into
  `lib/utils/cli-root.ts` `getCliPackageRoot` so both use one lookup.
- The production cloud URL is duplicated from `packages/cloud/src/config.ts`: the CLI does not depend on
  `@roo-code/cloud`, whose entry loads VS Code APIs.

## Tests

`doctor.test.ts` (19): each check's pass and fail paths (temp dirs, injected `runVersion` and `fetchImpl`), the timeout
(50 ms, asserted to return in under 2 s), the undici cause, report layout and summary, exit codes, a throwing check.

Real run (worktree, `tsx src/index.ts doctor`): without `-e` the bundle check fails (no build in the worktree),
exit 1; with `-e <live src/dist>` all pass except the cloud warning (`ENOTFOUND` on this host), exit 0; with
`ROO_CODE_API_URL=http://10.255.255.1` the cloud line reads "no answer within 3000 ms".

## Residuals

- The MCP check validates JSON and the `mcpServers` shape only, not each server entry (the extension's zod schema
  lives in `src/services/mcp`, which the CLI does not import).
- A self-hosted cloud configured only through the VS Code setting `tumble-code.cloudApiUrl` is not seen by the CLI at
  all (it never was): set `ROO_CODE_API_URL`.
