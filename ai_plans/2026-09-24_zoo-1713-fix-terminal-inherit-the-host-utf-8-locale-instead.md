# Zoo #1713 port: commands keep a UTF-8 host locale instead of a forced en_US.UTF-8

**Status:** ported, one commit on the Zoo port stack.
**Upstream:** Zoo-Code PR #1713 (issue #1084), commit `78b74ec1c` (merged 2026-09-22), author hebulin.
**Touched:** `src/integrations/terminal/localeEnv.ts` (new), `src/integrations/terminal/ExecaTerminalProcess.ts`,
`src/integrations/terminal/__tests__/localeEnv.spec.ts` (new),
`src/integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts`.

## Symptom

Every command run through the execa terminal (the only terminal the CLI uses, and the extension's
terminal when shell integration is off) got `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8`, whatever
the host had. On this host (`LANG=pl_PL.UTF-8`, en_US.utf8 is generated) commands silently ran as
US English: messages, sort order, date and number formats. On hosts without a generated
en_US.UTF-8, every command also printed `setlocale: LC_ALL: cannot change locale (en_US.UTF-8)`.

## Root cause in our code

`src/integrations/terminal/ExecaTerminalProcess.ts:109-110` hardcoded both variables after
spreading `process.env`, so they always overrode the host values. `apps/cli` has no copy of this
logic; it runs the same `ExecaTerminalProcess` from the bundled extension.

## Fix

New `getUtf8LocaleEnv(env)` in `localeEnv.ts`: it resolves the locale that decides the encoding the
POSIX way (first non-empty of `LC_ALL`, `LC_CTYPE`, `LANG`). If it is UTF-8 (`UTF-8` or `utf8`
spelling) it returns no overrides; otherwise it returns `LANG` and `LC_ALL` set to en_US.UTF-8, the
old behavior, so Ruby and CocoaPods still get UTF-8 on a non-UTF-8 host.
`ExecaTerminalProcess` spreads `getUtf8LocaleEnv(process.env)` in place of the two literals.

## Tests

- `ExecaTerminalProcess.spec.ts`: new cases "keeps a UTF-8 host locale such as pl_PL.UTF-8" and
  "keeps a UTF-8 LC_ALL set on the host" failed before the fix (`expected 'en_US.UTF-8' to be
  'pl_PL.UTF-8'` / `'C.UTF-8'`). The existing "sets en_US.UTF-8" case now pins a non-UTF-8 host
  (`LANG=C`) instead of depending on the machine running the tests; the "overrides C/POSIX" case is
  unchanged and still passes.
- New `localeEnv.spec.ts` (6 cases): UTF-8 LANG, `utf8` spelling, LC_CTYPE, LC_ALL=POSIX beating a
  UTF-8 LANG, non-UTF-8 locales, empty environment.
- `src/integrations/terminal`: 179 passed, 23 skipped (pre-existing platform skips). `tsc --noEmit`,
  eslint and prettier clean.

## Not ported

Nothing functional. The module doc comment was rewritten without the Zoo product name.
