# CLI: route extension console.error to the debug log, not the terminal

**Date:** 2026-08-07
**Branch:** `fix/15-cli-console-error-noise` (stacked on `feat/14-cli-claude-style-ui`)
**Status:** implemented

## Problem

With the API endpoint down (e.g. llama-swap returning `503 Loading model`),
the TUI transcript gets flooded with a raw multi-line stack dump:

```text
[OpenAI] API error: {
  message: '503 Loading model',
  ...
  stack: 'Error: 503 Loading model\n    at _APIError.generate (...extension.js:469755:18)\n ...'
}
```

## Root cause

`handleProviderError` in `src/api/providers/utils/error-handler.ts` logs every
provider error with `console.error(...)` including the full stack. In VS Code
that lands in the invisible extension-host log; in the CLI, ink's
`patchConsole` (on by default) prints console output straight into the
transcript. The CLI's `setupQuietMode()` already suppresses
`console.log/warn/debug/info` from extension code but deliberately left
`console.error` untouched — so only error spam leaks through.

## Fix

In `ExtensionHost.setupQuietMode()`, redirect `console.error` to the existing
file-based debug logger (`DebugLogger` → `~/.roo/cli-debug.log`, written when
`--debug` is passed) instead of leaving it bound to the terminal. Error
arguments are serialized via their `stack` so they survive JSON stringify.
`restoreConsole()` puts the original back (used around interactive prompts
and on dispose).

User-facing surfacing is unaffected: API failures still reach the UI through
the task loop's `api_req_failed` ask (retry dialog) and the error state.

Scope notes:

- This applies to print mode too — stderr stack spam is likewise diagnostics;
  JSON events / OutputManager remain the machine-readable error channel.
- Core's `handleProviderError` logging is left as-is (VS Code relies on it).

## Verification

- Updated `extension-host.test.ts` quiet-mode suite: console.error must be
  redirected while suppressed (and not throw on Error args), restored after.
- `pnpm check-types`, `pnpm lint`, `pnpm test` in `apps/cli`.
- Manual: kill the model endpoint, run a prompt — the transcript shows only
  the retry dialog, no stack dump; with `--debug` the dump appears in
  `~/.roo/cli-debug.log`.
