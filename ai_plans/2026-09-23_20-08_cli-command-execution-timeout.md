# CLI: configurable command execution timeout

**Status:** implemented on `feat/cli-command-execution-timeout` (from `main` d7237f29d), committed, not pushed
**Related plans:** `2026-09-23_19-45_cli-context-window-per-model.md` (same settings-file pattern), `2026-09-23_cli-per-mode-provider-settings.md` (how settings reach the extension)
**Touched:**

- `apps/cli/src/types/constants.ts` (`DEFAULT_FLAGS.commandExecutionTimeout`, `MAX_COMMAND_EXECUTION_TIMEOUT_SECONDS`)
- `apps/cli/src/types/types.ts` (`FlagOptions.commandExecutionTimeout`, `CliSettings.commandExecutionTimeout`)
- `apps/cli/src/main.ts` (`--command-execution-timeout <seconds>`)
- `apps/cli/src/commands/cli/run.ts` (flag > settings > default, strict validation)
- `apps/cli/src/agent/extension-host.ts` (option replaces the literal 300)
- tests: `run.test.ts`, `extension-host.test.ts`, `flag-defaults.test.ts`
- `apps/cli/README.md` (options table, settings table, note)

## Symptom

User, 2026-09-23, screenshot of the TUI: `Bash(python3 .../fetch_articles.py rp-pl && python3 .../fetch_articles.py wyborcza-pl)`
followed by "Command execution timed out after 300 seconds". Request: "Allow to
run bash commands for longer than 300s".

## Root cause

The limit is a literal in the CLI, with no flag or settings key over it:

1. `apps/cli/src/agent/extension-host.ts:253` put `commandExecutionTimeout: 300`
   into the host's initial settings.
2. `markWebviewReady()` hands those settings to
   `setRuntimeConfigValues("tumble-code", ...)`. The shim's
   `MockWorkspaceConfiguration.get()` checks runtime values first
   (`packages/vscode-shim/src/api/WorkspaceConfiguration.ts:93`), so nothing
   stored on disk can change it.
3. `ExecuteCommandTool` reads `tumble-code.commandExecutionTimeout`
   (`src/core/tools/ExecuteCommandTool.ts:122`) and, when it is above 0, races
   the command against a timer that aborts it (`:467`) and tells the model
   "terminated after exceeding a user-configured 300s timeout. Do not try to
   re-run the command." (`:490`); the UI line is `common:errors.command_timeout`.
4. The model cannot ask for more: `resolveAgentTimeoutMs()` returns 0 under
   `ROO_CLI_RUNTIME=1` (`ExecuteCommandTool.ts:54`), by design, so the
   `timeout` tool parameter is ignored in the CLI.

## Change

- `commandExecutionTimeout` in `cli-settings.json` and
  `--command-execution-timeout <seconds>`, same name and meaning (seconds,
  `0` = no limit) as the extension's VS Code setting, following the
  `consecutiveMistakeLimit` precedent (settings key = extension key, flag =
  kebab-case of it).
- Precedence: flag > settings file > `DEFAULT_FLAGS.commandExecutionTimeout`
  (300, unchanged). The flag is registered without a commander default, so an
  absent flag stays `undefined` and cannot shadow the file
  (`flag-defaults.test.ts`).
- The value reaches the extension through the existing path (initial settings,
  runtime config), so interactive, `--print` and stdin-stream runs all get it.

### Why the validation is strict

Measured with Node (2026-09-23):

- `Number("10m")` is `NaN`, and `NaN * 1000 > 0` is false: the extension would
  run with no limit at all. `Number("")` is `0`: the same.
- `setTimeout(fn, 2147483648)` prints `TimeoutOverflowWarning ... Timeout
duration was set to 1.` and fired after 11 ms: a value above 2147483 seconds
  would stop every command at once.

So `run()` accepts only a whole number from 0 to 2147483 (a number, or a
string of digits for the flag) and otherwise exits 1 before starting, naming
the flag or the settings file. The flag stays a raw string in `FlagOptions` so
the error can quote what the user typed.

### Decisions

- **Default stays 300.** Unattended runs (`--print`, stdin harnesses) rely on
  it to not hang forever on a stuck command; raising it is a one-line setting.
- **No per-mode value, no allowlist.** The extension also has
  `commandTimeoutAllowlist` (command prefixes exempt from the timeout); it
  would work through the same runtime-config path, but nobody asked for it.

## Evidence (live, fake OpenAI-compatible server)

`/tmp/roo-cmd-timeout-e2e/`: `fake_openai.py` answers the first request with
`execute_command {"command": "sleep 4 && echo SLEPT_OK"}` and every later one
with `attempt_completion`, logging the tool result the model receives.
`run.sh` runs the CLI built from this branch (`apps/cli/dist`) in print mode,
isolated `HOME`, installed extension bundle.

| Settings file | Flag       | Tool result the model got                                 | Wall time |
| ------------- | ---------- | --------------------------------------------------------- | --------- |
| none          | `2`        | "terminated after exceeding a user-configured 2s timeout" | 4.4 s     |
| `2`           | none       | same                                                      | 4.3 s     |
| `2`           | `10`       | exit code 0, `SLEPT_OK`                                   | 6.4 s     |
| none          | `0`        | exit code 0, `SLEPT_OK`                                   | 6.6 s     |
| none          | none (300) | exit code 0, `SLEPT_OK`                                   | 6.4 s     |
| none          | `10m`      | none: CLI exits 1 at startup, no request sent             | 0.3 s     |

## Verification

- `apps/cli`: `vitest run` 1004 passed, 1 skipped; `tsc --noEmit` exit 0;
  eslint on the changed files clean; prettier clean.
- The installed CLI (`~/.roo/cli`) is not rebuilt by this branch.

## Out of scope (observed)

- The `execute_command` tool description tells the model that its `timeout`
  parameter moves a command to the background, but the CLI ignores that
  parameter (point 4 above). A model that sets it expecting to be released
  early waits for the command or the user limit instead.
