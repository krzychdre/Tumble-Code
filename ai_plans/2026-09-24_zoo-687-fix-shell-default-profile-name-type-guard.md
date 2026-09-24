# Zoo #687 port: ignore a non-string terminal default profile when detecting the shell

**Status:** ported, one commit on the Zoo port stack.
**Upstream:** Zoo-Code PR #687, commit `515437b45` (merged 2026-06-29), author dw.
**Touched:** `src/utils/shell.ts`, `src/utils/__tests__/shell.spec.ts`.

## Symptom

`getShell()` throws `TypeError: defaultProfileName.toLowerCase is not a function` on Windows when
`terminal.integrated.defaultProfile.windows` in settings.json holds a number, boolean, array or
object. On macOS and Linux it does not throw, but a value such as `1` is used as a key into the
profiles map, so a profile named `"1"` is picked from an invalid setting.

## Root cause in our code

`config.get<string>()` has no runtime type check. The three helpers
`getWindowsTerminalConfig`, `getMacTerminalConfig` and `getLinuxTerminalConfig`
(`src/utils/shell.ts:139-168` before the fix) returned the raw value, and
`getWindowsShellFromVSCode` calls `defaultProfileName.toLowerCase()` at `:205` and `:225`.
`!defaultProfileName` only filters falsy values, so `true`, `1`, `[...]` and `{...}` got through.

## Fix

New helper `getDefaultProfileName(config, platformKey)` reads `defaultProfile.<platform>` as
`unknown` and returns it only when it is a string, otherwise `null` ("not configured"). The three
platform helpers use it. A non-string value on Windows now falls into the existing
"no profile configured" branch (PowerShell auto-detection).

## Tests

New `Non-string defaultProfile values` block in `shell.spec.ts`: Windows with number, boolean,
array and object values (4 cases), plus macOS and Linux with a numeric value that matches a real
profile key `"1"`. Before the fix all 6 failed (4 with the TypeError, 2 by picking the `"1"`
profile). After the fix the file passes 44/44; `tsc --noEmit`, eslint and prettier are clean.

## Not ported

Zoo's refactor of the three helpers into a generic `getTerminalConfig<K>()` with a
`PlatformProfilesMap` type and its extra `getTerminalConfig` behavior tests: a refactor, not part
of the fix, and our existing tests already cover the error and fallback paths.
