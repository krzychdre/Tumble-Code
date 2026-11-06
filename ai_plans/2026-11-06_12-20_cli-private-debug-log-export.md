# CLI: owner-only debug log and /export file, debug log rotation (audit C-2, C-14)

**Status:** done on `fix/sec-cli-private-files`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-2, C-14
**Touched:**

- `packages/core/src/debug-log/index.ts`: `setDebugLogEnabled(true)` prepares the file; `debugLog` appends with mode 0600
- `apps/cli/src/ui/hooks/useTaskSubmit.ts`: `/export` writes with mode 0600
- `apps/cli/README.md`: one sentence on the log's mode and rotation
- tests: `packages/core/src/debug-log/__tests__/debugLog.spec.ts` (new), `apps/cli/src/ui/hooks/__tests__/useTaskSubmit.test.tsx`

## Problem

`~/.roo/cli-debug.log` (prompts, paths, provider errors under `--debug`) and the `/export`
Markdown (prompts and command output) were created 0644 under a default umask; the log never
shrank.

## Root cause

- `debugLog` (`packages/core/src/debug-log/index.ts`): `mkdirSync(logDir, { recursive: true })`
  and `appendFileSync(DEBUG_LOG_PATH, entry)` without a mode.
- `exportTranscript` (`apps/cli/src/ui/hooks/useTaskSubmit.ts`): `writeFile(target, …, { flag: "wx" })` without a mode.

Only the CLI enables the debug log (`extension-host.ts`, `options.debug`); in the VS Code
extension host `debugLog` stays a no-op, so nothing changes there.

## Fix

- When logging is enabled: create `~/.roo` 0700 if missing (as `config-dir.ts` does), chmod an
  existing log to 0600 (an older version made it 0644), and move a log over 10 MB to
  `cli-debug.log.1` (one generation, replaced each time). Entries append with mode 0600, which
  applies when the file is created.
- `/export`: `mode: 0o600` with the existing `wx` flag.

`writePrivateFileSync` (vscode-shim) replaces whole files, so it does not fit an append-only log.

## Tests

- Fresh HOME per test, module reloaded: new dir 0700 and log 0600; a pre-existing 0644 log becomes
  0600; a log over 10 MB moves to `.1` and the new log holds only the new entry. Each proven red by
  removing its line.
- `/export` file mode is 0600 (POSIX only). Proven red without the mode.
