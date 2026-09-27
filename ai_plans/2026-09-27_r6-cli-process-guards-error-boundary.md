# R6 — CLI TUI process guards + error boundary (2026-09-27)

Roadmap item R6 from `ai_plans/2026-09-27_simplification-roadmap.md`:
_"CLI TUI has no crash or signal handling. Print mode handles SIGINT, SIGTERM and
uncaught errors; the Ink mode handles none and has no error boundary, so the terminal
can stay in raw mode and the temp folder leaks. Fix: one `installProcessGuards(cleanup)`
used by both modes, plus an error boundary around `App`."_

Branch: `fix/r6-cli-process-guards-error-boundary`. Scope: guards + boundary only; the
ink rendering pipeline (do-not-touch per `docs/architecture.md`) is unchanged — the
boundary wraps the root component, the guards sit outside `render()`.

## Before — evidence from the code

**Print mode** (`apps/cli/src/commands/cli/run.ts`, the `else` branch of `run()`)
installed four inline handlers: `onSigint`/`onSigterm` → `shutdown(signal, 130|143)`,
`onUncaughtException`/`onUnhandledRejection` → emit + `shutdown(..., 1)`, with
`shutdown` doing `disposeHost()` → `jsonEmitter.flush()` → `flushStdout()` →
`process.exit`. It also had a `--signal-only-exit` park mode and a
cancellation-error classifier (`isExpectedControlFlowError`).

**Ink mode** (the `isTuiEnabled` branch) called `render(createElement(App, ...))` with
`exitOnCtrlC: false` and installed **zero** process handlers:

- No `SIGINT`/`SIGTERM` handler existed anywhere in the TUI path — grep over
  `apps/cli/src` found signal handling only in `run.ts` (print) and `list.ts`
  (its own short-lived SIGINT/SIGTERM pair around a pager).
- No `uncaughtException`/`unhandledRejection` handler: a crash anywhere outside React
  (the agent loop runs in the same process) killed the process with Node's default
  behavior — no `instance.unmount()`, so ink's `signal-exit` teardown raced a hard
  exit; the terminal could stay in raw mode and `--ephemeral` storage
  (`os.tmpdir()/roo-cli-*`, created in `lib/storage/ephemeral.ts`, removed only in
  `ExtensionHost.dispose()`) leaked.
- No error boundary: a render crash inside any component unmounted the whole ink tree
  (React unmounts on uncaught render errors) with only ink's raw error output, if any.

## Changes

| File                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/src/lib/process-guards.ts` (new)              | `installProcessGuards({ onCleanup, onError, onExit, exitTimeoutMs, keepAlive, isExpectedError, target })`: installs SIGINT/SIGTERM/uncaughtException/unhandledRejection, one idempotent async cleanup pass (guards racing each other run it once), signal exit codes 130/143, errors exit 1, `exitTimeoutMs` (default 10s) force-exits if cleanup hangs so a stuck `dispose()` can never strand a raw-mode terminal. `dispose()` removes the handlers and runs the cleanup pass — used by print mode's normal exit paths.                                                                                                                                                                                                                                                                                             |
| `apps/cli/src/ui/components/TuiErrorBoundary.tsx` (new) | Class error boundary around `App`: readable `<Text>` fallback (error + "Press Ctrl+C to exit") + `onError` callback. Minimal by design vs the webview `ErrorBoundary.tsx`: no i18n/telemetry/source maps (the CLI cannot assume they're up).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/cli/src/commands/cli/run.ts`                      | **Ink mode**: wraps `App` in `TuiErrorBoundary`; installs guards whose cleanup unmounts the ink instance (ink's teardown restores the terminal) and yields a tick for React unmount effects (`useExtensionHost` disposes the host there, which also removes `--ephemeral` temp storage). **Print mode**: replaces the four inline handlers + `shutdown()` with the shared module; behavior preserved — signal codes, "Received X, shutting down..." message, JSON error events via `emitRuntimeError`, `isExpectedControlFlowError` classification, and `--signal-only-exit` (`keepAlive`: report but don't exit; `onExit` no-op so a parked stdin harness keeps its process). Normal completion/failure paths now call `disposeGuards()` (cleanup + handler removal) instead of duplicated dispose/flush/off blocks. |

## Decisions

1. **`exitOnCtrlC: false` + own SIGINT handler.** Ink's built-in Ctrl+C handling
   (an exit-on-ctrl-c path in its internal `App`) stays disabled as before; the
   interactive Ctrl+C flow remains the App's double-press handler, which calls
   `cleanup()` (host dispose) → `exit()`. The guards' SIGINT handler only fires when
   ink's input layer is gone (crash mid-render, non-interactive kill from another
   terminal) or on a second signal after the first press. `kill -TERM` reaches the
   guard directly — previously it killed the TUI with the default handler and the
   terminal stayed broken.
2. **10s exit timeout in guards.** Without it, a hung `ExtensionHost.dispose()` would
   hold a crashed process (and the raw-mode terminal) open forever; with it the worst
   case is a force-exit that strands the terminal exactly like before, while every
   non-hung path unmounts cleanly.
3. **Cleanup in the TUI is `unmount()` + one `setImmediate` tick**, not a direct host
   reference: `run.ts` has no host handle in TUI mode (App creates it via
   `createExtensionHost`), and ink's unmount runs React cleanup effects where
   `useExtensionHost` already disposes the host. The tick gives those effects a turn
   before `process.exit` freezes the event loop.
4. **Temp folders**: the only true scratch space is `--ephemeral` storage
   (`/tmp/roo-cli-*`), and its removal lives in `ExtensionHost.dispose()`, which both
   modes' cleanup reaches (print: direct `disposeHost`; TUI: unmount effect). Task
   history under the config dir is durable user data and is deliberately not touched.
   No new deletion logic was added on purpose.
5. **Print mode parity**: the inline handlers were replaced, not wrapped — the guards
   module is now the single implementation (`DRY` per the roadmap). The
   `--signal-only-exit` parking (`parkUntilSignal`) and its keep-alive interval stay
   in `run.ts`; guards interact with it only through `keepAlive`/`onExit` no-ops.

## Tests

- `apps/cli/src/lib/__tests__/process-guards.test.ts` (new, 10 cases): fake
  `ProcessLike` target + injected `onExit`, no real signals/kills — handler
  registration/removal, exit codes (130/143/1), idempotent cleanup under double
  signals, expected-error pass-through, `keepAlive` no-exit, cleanup-throws still
  exits, dispose single pass, hung-cleanup force exit via fake timers.
- `apps/cli/src/ui/components/__tests__/TuiErrorBoundary.test.tsx` (new,
  ink-testing-library, already a devDep): throwing child → fallback frame contains
  the error + exit hint, `onError` called once.
- `run.test.ts` (54 cases, print-mode paths incl. signal-only-exit flags) and the
  full CLI suite pass: 98 files / 1318 tests green (1 pre-existing skip).

## Residuals

- A render crash caught by the boundary keeps the session alive on screen (by design:
  "Press Ctrl+C to exit"); the guards fire only on the process-level events. If a
  boundary crash should auto-exit, that is a product decision, not a guard concern.
- `list.ts` keeps its own short-lived SIGINT/SIGTERM pair around its pager; it is a
  different lifecycle (no extension host, no ink) and was left alone.
- The ink `signal-exit` subscription is always active during a TUI session; our guard
  and it can both run on a signal. Order is unproblematic (both unmount/cleanup
  idempotently), and ink's handler does not preclude ours.
