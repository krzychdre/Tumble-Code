# Windows CI red since the security audit fixes

**Status:** fixed on `fix/protect-windows-forward-slash-markers` and `test/windows-path-expectations`
**Related:** security audit 2026-10-28 (#1176-#1232), Code QA run 40851111900
**Touched:** `src/core/protect/RooProtectedController.ts`, and the specs listed below

## Symptom

`platform-unit-test (windows-latest)` failed on every `main` commit from ba3e88fec (#1176) on; Ubuntu and the other
jobs were green. Seven tests in six `src` spec files failed, all on Windows path forms.

## What was happening

One product defect, five test expectations written for POSIX paths only.

- `RooProtectedController`: the markers that find a protected directory inside interpreter code (`node -e`,
  `python -c`) came from `path.resolve` and `path.relative`, so on Windows they were `C:\Users\x\...\Code\User` and
  `AppData\Roaming\Code\User`. Code that spells the path with `/`, which Node and Python accept on Windows, matched no
  marker, and the auto-approved command ran without asking.
- `RooIgnoreController.validateCommand("cat sec*/key.txt")` reports the glob match built with `path.join`, so
  `secrets\key.txt` on Windows. The file is blocked either way.
- `executeCommand` and `executeCommandTool`: since #1216 the working directory always goes through `path.resolve`, which
  gives `/custom/absolute/path` the current drive on Windows (`D:\custom\absolute\path`).
- `ShellIntegrationManager.zshInitTmpDir` joins VS Code's `appRoot` with `path.join`, so the `.zshrc` sources a
  backslash path on Windows.
- `McpHub`: on Windows every stdio server is launched as `cmd.exe /c <command> <args>`.

## Fix

- Every protected-directory marker is also matched in its `/` form (`toPosix()`); on POSIX both forms are the same.
- The five specs expect the platform's own form: `path.resolve(...)`, `path.join(...)`, and for McpHub the server's
  argument `a.js` instead of the exact command.

## Tests

No new cases: the existing Windows run of `RooProtectedController.spec.ts` ("node code naming VS Code's user settings")
is the regression test for the marker defect. Checked by replaying the marker logic with `path.win32`: no marker
matched before, `.config/Code/User` matches after.

## Not fixed

- A path written in JavaScript or Python source with escaped backslashes (`'C:\\Users\\...'`) matches neither form.
