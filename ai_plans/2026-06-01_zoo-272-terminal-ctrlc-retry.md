# Zoo PR #272 — Terminal: retry Ctrl+C for processes needing multiple SIGINT

- **Upstream:** Zoo-Code #272 (refs #266), commit `57d4817de`, merged 2026-05-26 21:29:22Z, authors Armando Vaquera + edelauna. Follow-up to #245 / #261 (we ported #261).
- **Branch:** `feature/zoo-272-terminal-ctrlc-retry` (off `main`).
- **Credit:**
    - `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`
    - `Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>`

## Problem

`TerminalProcess.abort()` sent a single Ctrl+C (SIGINT) then disposed immediately.
Some processes (interactive tools, programs that trap SIGINT and prompt for
confirmation) need more than one Ctrl+C to exit — so the cancel path left them
running and the terminal stuck busy.

## Fix (`src/integrations/terminal/TerminalProcess.ts`)

1. Add private static `CTRL_C_SEND_LIMIT = 3` (total Ctrl+C sends, immediate + retries)
   and `ABORT_RETRY_DELAY_MS = 500`.
2. Add private `aborting = false` guard against overlapping retry loops.
3. Rewrite `abort()`: early-return when not listening; send the immediate Ctrl+C;
   then, if not already `aborting`, set the flag and kick off a fire-and-forget
   `retryAbort()` (`.finally` clears the flag, `.catch` logs). Never blocks the
   synchronous cancel path.
4. New private `async retryAbort()`: loop `sent` from 1 to `CTRL_C_SEND_LIMIT`,
   awaiting `ABORT_RETRY_DELAY_MS` each tick; stop early when `!isListening`, or when
   the terminal is gone / `!terminal.busy` / `terminal.process !== this` (reuse guard
   — don't interrupt an unrelated command that reused the terminal). Re-send `\x03`
   otherwise. Bounded retry window so `dispose()` is never delayed indefinitely.

ExecaTerminal backend is unaffected (it sends SIGKILL directly).

## Tests (`src/integrations/terminal/__tests__/TerminalProcess.spec.ts`)

New `describe("abort")` with fake timers, mirroring the production constants
(`RETRY_DELAY_MS=500`, `MAX_ATTEMPTS=3`) and wiring `mockTerminalInfo.process =
terminalProcess` so the reuse guard passes. Six cases:

- single Ctrl+C when process exits immediately (not busy);
- re-sends up to the bounded max while busy;
- stops mid-retry once `shellExecutionComplete` clears busy;
- stops when terminal reused by a different process;
- does nothing when not listening;
- repeated `abort()` → two immediate sends but one retry loop (guard checked after
  the immediate send).

## Scope / skip

No changeset (fork port workflow omits them). Product + tests only; no naming/brand
changes (internal-only terminal code).

## Verification

- `npx vitest run integrations/terminal/__tests__/TerminalProcess.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
