/**
 * Erase the screen and the scrollback, then home the cursor. Same sequence
 * `ansi-escapes` uses for `clearTerminal`, inlined so the packaged CLI does not
 * have to resolve another dependency at install time.
 *
 * This must only ever be handed to ink's `useStdout().write`, never written to
 * `process.stdout` directly: ink positions every frame relative to the previous
 * one, and a clear behind its back leaves it erasing rows that are no longer
 * there (see the comment in `useTerminalSize.ts`).
 *
 * Two callers share it, and both follow the same order, wipe first and let the
 * re-render print onto the cleared screen: `/clear` (useTaskSubmit) and the
 * ctrl+o transcript toggle (useGlobalInput).
 */
export const CLEAR_TERMINAL = process.platform === "win32" ? "\x1b[2J\x1b[0f" : "\x1b[2J\x1b[3J\x1b[H"
