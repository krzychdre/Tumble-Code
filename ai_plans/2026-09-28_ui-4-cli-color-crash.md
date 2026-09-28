# UI plan §4 (CLI), part 1: NO_COLOR / FORCE_COLOR and the crash hint

Source: `ai_plans/2026-09-27_ui-modernization.md` §4, bullets "Honour NO_COLOR and FORCE_COLOR" and "After a crash,
print the debug log path and suggest --debug". Branch `feat/ui-4-cli-color-crash`, first of the §4 stack.

## Root cause (verified)

### Colour

Every colour the TUI draws goes through ink, which uses chalk 5.6.2. Chalk's detection
(`chalk/source/vendor/supports-color/index.js`) reads `FORCE_COLOR`, `--no-color`, `TERM`, `COLORTERM`, CI variables,
but never `NO_COLOR`. The CLI itself writes no SGR sequences of its own (grep for `\x1b[` in `apps/cli/src`: only
cursor, clear and key-parsing sequences). So `FORCE_COLOR` already worked and `NO_COLOR` did nothing.

Probe (real chalk, in a pty, `COLORTERM=truecolor`): before the fix `NO_COLOR=1` gave level 3; after it, level 0.
`FORCE_COLOR=2 NO_COLOR=1` keeps FORCE_COLOR (FORCE_COLOR wins, per no-color.org), an empty `NO_COLOR` is ignored.

### Crash

- Interactive mode installed the R6 process guards without `onError`: an uncaught exception unmounted ink and exited
  with code 1, printing nothing at all.
- The error boundary reported render crashes with `console.error`, and print mode's `emitRuntimeError` did too. While
  the extension host is alive its quiet mode (`extension-host.ts` `setupQuietMode`) replaces `console.error` with a
  write into `~/.roo/cli-debug.log`, and that log is only written with `--debug`. So without `--debug` those errors
  went nowhere. (The "extension bundle not found" path looked fine only because `activate()` restores the console
  before throwing.)
- Nothing ever named the debug log or `--debug`.

## Change

- `apps/cli/src/lib/utils/color-env.ts` `applyColorEnv(env)`: non-empty `NO_COLOR` and no `FORCE_COLOR` set means
  `FORCE_COLOR=0`, chalk's own switch. `index.ts` calls it before `loadReactProductionBuilds()` imports ink, because
  chalk reads the environment once at import.
- `packages/core/src/debug-log` exports `getDebugLogPath()`.
- `apps/cli/src/lib/crash-report.ts`: `formatCrashHint({ debug, logPath })` ("the debug log has the details: PATH" or
  "run again with --debug; it writes a debug log to PATH") and `formatCrashReport(error, ...)`.
- `run.ts`:
    - TUI guards get `onError`: remember the first crash and put the stack in the debug log; `onCleanup` prints the
      report to `process.stderr` after `instance.unmount()` (before that ink owns the screen).
    - The error boundary gets a `hint` prop shown under its fallback; its `onError` writes to the debug log directly.
    - TUI start failure and print mode's `emitRuntimeError` write with `process.stderr.write` plus the hint. JSON output
      is unchanged (the error event still goes to stdout).

## Tests

- `color-env.test.ts` (6): NO_COLOR values, empty NO_COLOR, FORCE_COLOR wins, empty FORCE_COLOR kept, no-op.
- `crash-report.test.ts` (4): both hint variants, report layout, non-Error reason.
- `TuiErrorBoundary.test.tsx` (+1): the hint appears under the fallback.
- `run.test.ts` (+1): a failed print run writes the error, `--debug` and `cli-debug.log` with `process.stderr.write`.

## Residuals

- Child processes the agent runs inherit `FORCE_COLOR=0` next to `NO_COLOR`; both ask for no colour, so this matches
  the user's intent.
- The interactive guard exits after cleanup; if cleanup hangs past the 10 s guard timeout the report is not printed
  (the debug log still has it when `--debug` is on).
