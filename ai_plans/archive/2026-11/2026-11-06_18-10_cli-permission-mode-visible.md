# CLI: show the permission mode (security audit 2026-11-06, C-3)

**Status:** done on `fix/sec-cli-permission-mode`
**Touched:** `apps/cli/src/lib/utils/permissions.ts`, `src/commands/cli/run.ts`, `src/ui/App.tsx`,
`src/ui/components/input/InputArea.tsx`, `InputFooter.tsx`, `README.md`, tests.

## Problem

The CLI defaults to `allow` (every action approved, bypass tier, `permissions.ts`), which is deliberate, but nothing
on screen said so: the footer showed mode, model and context only, and a `--print` run printed nothing about it.

## Fix (owner decision, behaviour unchanged)

- Footer: `{mode} · permissions: {allow|ask} · {model} · ctx`, dim like its neighbours. It reads App's
  `permissionMode` state, the one `/permissions ask|allow` sets, so it follows the switch at once.
- `--print`: `runPrint` writes `describePermissionMode(getPermissionMode(nonInteractive))` to stderr before the host
  starts, e.g. `[permissions] allow: actions run without approval`. stderr keeps json/stream-json stdout valid.
  `getPermissionMode(nonInteractive)` is the same call the extension host applies the settings with.

## Tests

- `run.test.ts`: one `[permissions]` line first on stderr for the default, `--require-approval` and stream-json runs,
  none on stdout (red when the write is removed).
- `App.characterization.test.tsx`: footer shows `allow`, then `ask` after typing `/permissions ask` (red when the footer
  gets the start value instead of the state); the prompt history module is replaced so no line lands in `~/.roo`.
  Snapshots gain the footer segment.
- `InputFooter.test.tsx`: the segment sits between mode and model.
