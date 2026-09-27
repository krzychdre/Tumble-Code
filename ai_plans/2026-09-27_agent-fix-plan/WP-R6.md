# WP-R6: CLI TUI crash and signal handling

Status: ready
Effort: M      Risk: medium      Depends on: none
Branch name: fix/r6-cli-process-guards      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Give the Ink TUI the same protection print mode has: on SIGINT, SIGTERM, SIGHUP, an uncaught exception, an
unhandled rejection or a React render error, unmount Ink (raw mode and cursor restored), print the error, dispose
the extension host (which deletes the `--ephemeral` storage folder) and exit with a proper code. Both modes install
the handlers through one new function, `installProcessGuards(onEvent)`, in
`apps/cli/src/commands/cli/process-guards.ts`. Also fix two small defects in
`apps/cli/src/agent/extension-host.ts`: the `"warning"` listener added on every quiet-mode setup and never removed,
and the unnamed 10 s activation wait with its unreadable timeout message.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Today, closing the terminal window (SIGHUP), `kill` (SIGTERM) or any unhandled error in the TUI ends the process
without calling `ExtensionHost.dispose()`: the extension is never deactivated and the `--ephemeral` temporary
folder is left behind. A component that throws while rendering leaves a dead screen that does not exit, because
nothing waits for Ink's exit promise and the extension host keeps Node running. A failed activation says only
"Promise timed out after 10000 milliseconds".

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md` (test placement) and `docs/architecture.md` "Do not touch": the CLI's Ink render pipeline
  (`streamCommit.ts`, `TailViewport.tsx`, the `useInsertionEffect` ordering, `theme.dimmed`) must not change.
- `docs/07-cli.md` (Boot sequence).
- `apps/cli/src/commands/cli/run.ts`: the TUI branch `if (isTuiEnabled) {` near line 549 (the second one; the first
  at line 237 is onboarding), and in the `else` branch `onSigint`, `onSigterm`, `onUncaughtException`,
  `onUnhandledRejection`, `shutdown`, `parkUntilSignal`, the four `process.on(...)` lines and the three groups of
  four `process.off(...)` lines.
- `apps/cli/src/commands/cli/cancellation.ts`: `isExpectedControlFlowError` (reads `code`, `name` and `message` of
  the raw rejection reason; pass it the raw value, not a normalized Error).
- `apps/cli/src/ui/App.tsx`: `App`, `AppInner`; `apps/cli/src/ui/hooks/useExtensionHost.ts`: `cleanup`, the
  `useEffect` that creates the host and returns `() => { cleanup() }`; `apps/cli/src/ui/hooks/useGlobalInput.ts`:
  Ctrl+C double press (`cleanup().finally(() => { exit(); process.exit(0) })`).
- `apps/cli/src/agent/extension-host.ts`: `setupQuietMode`, `restoreConsole`, `activate` (the `pWaitFor` line),
  `dispose`, `PromptManager` wiring in the constructor (`onBeforePrompt: () => this.restoreConsole()`,
  `onAfterPrompt: () => this.setupQuietMode()`).
- `apps/cli/node_modules/ink/build/components/App.js` near line 550 (`React.createElement(ErrorBoundary, { onError:
  handleExit }, children)`), `.../components/ErrorBoundary.js`, and `.../ink.js` near line 255
  (`signalExit(this.unmount, { alwaysLast: false })`) and `waitUntilExit`.
- `apps/cli/src/commands/cli/__tests__/run.test.ts`: the `vi.mock("ink", ...)` near line 76 (`render` returns
  `{ unmount, waitUntilExit: async () => {} }`) and describe "run clears the screen when the interactive UI starts".
- `apps/cli/src/agent/__tests__/extension-host.test.ts`: helpers `createTestHost`, `getPrivate`, `setPrivate`,
  `callPrivate`; describes "quiet mode" and "dispose".

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

### 4.1 `apps/cli/src/commands/cli/run.ts`, TUI branch (near line 549)

```ts
	if (isTuiEnabled) {
		try {
			const { render } = await import("ink")
			const { App } = await import("../../ui/App.js")
			const { createScrollSafeStdout } = await import("../../ui/utils/scrollSafeStdout.js")

			render(
				createElement(App, {
					...extensionHostOptions,
					initialPrompt: prompt,
					initialTaskId: requestedCreateSessionId,
					initialSessionId: resolvedResumeSessionId,
					continueSession: false,
					version: VERSION,
					createExtensionHost: (opts: ExtensionHostOptions) => new ExtensionHost(opts),
				}),
				{
					// Handle Ctrl+C in App component for double-press exit.
					exitOnCtrlC: false,
					// Diff frames per line instead of erase-all + rewrite <U+2014 em dash>
					// ink's standard log-update repaints the whole dynamic
					// region every frame, which blinks on each spinner tick
					// and stream chunk.
					incrementalRendering: true,
					// ...which skips unchanged rows with a cursor move that
					// does not scroll on the bottom row; see scrollSafeStdout.
					stdout: createScrollSafeStdout(process.stdout),
				},
			)
		} catch (error) {
			console.error("[CLI] Failed to start TUI:", error instanceof Error ? error.message : String(error))

			if (error instanceof Error) {
				console.error(error.stack)
			}

			process.exit(1)
		}
	} else {
```

(`<U+2014 em dash>` stands for the one non-ASCII character in that comment; the find snippets below avoid it.)

### 4.2 `apps/cli/src/commands/cli/run.ts`, print-mode handlers (near line 669)

```ts
		const onSigint = () => {
			void shutdown("SIGINT", 130)
		}

		const onSigterm = () => {
			void shutdown("SIGTERM", 143)
		}

		const onUncaughtException = (error: Error) => {
			if (
				isExpectedControlFlowError(error, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			emitRuntimeError(error, "uncaughtException")

			if (signalOnlyExit) {
				return
			}

			void shutdown("uncaughtException", 1)
		}

		const onUnhandledRejection = (reason: unknown) => {
			if (
				isExpectedControlFlowError(reason, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			const error = normalizeError(reason)
			emitRuntimeError(error, "unhandledRejection")

			if (signalOnlyExit) {
				return
			}

			void shutdown("unhandledRejection", 1)
		}
```

### 4.3 `apps/cli/src/commands/cli/run.ts`, `shutdown` and the listener installation (near line 729)

```ts
		async function shutdown(signal: string, exitCode: number): Promise<void> {
			if (isShuttingDown) {
				return
			}

			isShuttingDown = true
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			clearKeepAliveInterval()

			if (!useJsonOutput) {
				console.log(`\n[CLI] Received ${signal}, shutting down...`)
			}

			await disposeHost()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()
			process.exit(exitCode)
		}

		process.on("SIGINT", onSigint)
		process.on("SIGTERM", onSigterm)
		process.on("uncaughtException", onUncaughtException)
		process.on("unhandledRejection", onUnhandledRejection)

		try {
```

### 4.4 `apps/cli/src/commands/cli/run.ts`, the two normal exits (near lines 795 and 812)

```ts

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop completed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(0)
		} catch (error) {
			emitRuntimeError(normalizeError(error))
			await disposeHost()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop failed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(1)
		}
	}
```

### 4.5 `apps/cli/src/agent/extension-host.ts`, `setupQuietMode` (near line 330)

```ts
	private setupQuietMode(): void {
		// Skip if already set up or if integrationTest mode
		if (this.originalConsole || this.options.integrationTest) {
			return
		}

		// Suppress node warnings.
		this.originalProcessEmitWarning = process.emitWarning
		process.emitWarning = () => {}
		process.on("warning", () => {})

```

### 4.6 `apps/cli/src/agent/extension-host.ts`, `restoreConsole` (near line 369)

```ts
	private restoreConsole(): void {
		if (!this.originalConsole) {
			return
		}

		console.log = this.originalConsole.log
		console.warn = this.originalConsole.warn
		console.error = this.originalConsole.error
		console.debug = this.originalConsole.debug
		console.info = this.originalConsole.info
		this.originalConsole = null

		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}
	}

```

### 4.7 `apps/cli/src/agent/extension-host.ts`, end of `activate` (near line 486) and start of `dispose` (near line 659)

```ts
		this.messageListener = (message: ExtensionMessage) => {
			this.reportMcpFailures(message)
			this.client.handleMessage(message)
		}
		this.on("extensionWebviewMessage", this.messageListener)

		await pWaitFor(() => this.isReady, { interval: 100, timeout: 10_000 })
	}
```

```ts
	// ==========================================================================
	// Cleanup
	// ==========================================================================

	async dispose(): Promise<void> {
		// Clear managers.
		this.outputManager.clear()
		this.askDispatcher.clear()

		// Remove message listener.
		if (this.messageListener) {
			this.off("extensionWebviewMessage", this.messageListener)
			this.messageListener = null
		}
```

## 5. Root cause / analysis

VERIFIED:

- Print mode (4.2-4.4) handles SIGINT (exit 130), SIGTERM (143), uncaught exceptions and unhandled rejections
  (dispose, flush, exit 1; ignored when `isExpectedControlFlowError` says so; with `--signal-only-exit` it reports and
  keeps running). The TUI branch (4.1) installs nothing. `grep -rn "SIGINT\|SIGTERM\|uncaughtException\|
  unhandledRejection" apps/cli/src` finds only `run.ts` print mode and `commands/cli/list.ts` (out of scope).
- The TUI renders with `exitOnCtrlC: false`, so Ctrl+C in raw mode is keyboard input, handled by `useGlobalInput`
  (double press -> `cleanup()` -> `exit()` -> `process.exit(0)`). Signals come only from outside (`kill`, a closed
  terminal sends SIGHUP).
- Without a JS listener, SIGTERM and SIGHUP end Node without running `ExtensionHost.dispose()`. `dispose()` is what
  calls the extension's `deactivate()` and deletes `ephemeralStorageDir` (created by `createEphemeralStorageDir()`
  when `--ephemeral` is set).
- Ink 7.1.1 already has an error boundary: `node_modules/ink/build/components/App.js` wraps the app in its internal
  `ErrorBoundary` whose `onError` is `handleExit`, which disables raw mode and unmounts; Ink then renders its
  `ErrorOverview` (message, source excerpt, stack) and rejects `waitUntilExit()` with the error. Checked with a
  scratch script: a component that throws 50 ms after mount printed Ink's "ERROR render boom" overview and
  `waitUntilExit()` rejected with that error. `run.ts` ignores the instance returned by `render(...)`, so after a
  render error nobody disposes the host or exits; the host keeps the event loop alive (dead screen). Therefore this
  item does NOT add a second React error boundary: it handles the rejection of `waitUntilExit()` (prints the message,
  disposes, exits 1). This deviates from the roadmap wording on purpose; the outcome asked for (print, clean up,
  exit) is the same with less code.
- Ink registers `signal-exit` (`ink.js` near line 255) to unmount on exit. `signal-exit` re-raises a signal only
  when it is the sole listener; once our SIGTERM/SIGHUP listener exists, our handler must call `process.exit`
  itself (it does).
- Node 22 turns an unhandled rejection into a crash (exit 1) when there is no listener; no code in the extension
  (`grep -rn "unhandledRejection" src packages/vscode-shim/src`) installs one. So making it a graceful exit 1 in the
  TUI does not make anything fatal that is not fatal today.
- Double dispose: when the guard unmounts Ink, React runs the `useExtensionHost` effect cleanup, which calls
  `cleanup()` -> `host.dispose()` without awaiting; the guard then calls `dispose()` on the same host. Today two
  concurrent `dispose()` calls both reach `await this.extensionModule.deactivate()` (the field is cleared only after
  the await). The fix makes `dispose()` idempotent (second call returns the first promise).
- Warning listener leak: `setupQuietMode` runs in the constructor and after every interactive prompt
  (`onAfterPrompt`), and each run does `process.on("warning", () => {})` with a new function that `restoreConsole`
  never removes. The new test shows the count growing by one per prompt on the old code.
- `p-wait-for` 5.0.2 rejects with `TimeoutError: Promise timed out after 10000 milliseconds` and accepts
  `timeout: { milliseconds, message }` (see `node_modules/p-wait-for/index.d.ts`).
- Dry run in a scratch copy of `apps/cli` (not in the repo): with the changes below, `tsc --noEmit` passes, eslint
  passes on the changed files, and `vitest run src/commands src/agent src/ui src/lib` passes 1274 tests (the only 3
  failing files, `cli-bundle`, `lockfile` and `release-manifest`, need the real repository layout and pass in the
  repository). With the old `extension-host.ts`, the 5 new extension-host cases fail; the new
  `process-guards.test.ts` (11 cases) cannot load without the new module.

HYPOTHESIS H1: Windows accepts `process.on("SIGHUP", ...)` (Node documents that SIGHUP is emitted on Windows when
the console window closes). Confirm on the Windows CI job of the PR (the `apps/cli` unit tests run there). If
`installProcessGuards` throws on Windows, remove `SIGHUP` from `SIGNAL_EXIT_CODES` only when
`process.platform === "win32"` and report it.

HYPOTHESIS H2: no existing CLI test depends on `process.listenerCount("SIGINT")` staying at its old value after a
print-mode run. Confirm with the full `apps/cli` unit run in section 8. If a test fails on listener counts, stop and
report.

## 6. Step-by-step changes

### Step 1. Create `apps/cli/src/commands/cli/process-guards.ts` with exactly this content

```ts
/**
 * Process-level guards for a CLI run (R6): the termination signals and the two
 * "nothing caught this" events. Print mode and the TUI both install them through
 * `installProcessGuards`; each mode decides what shutting down means for it.
 */

export type ProcessGuardSignal = "SIGINT" | "SIGTERM" | "SIGHUP"
export type ProcessGuardErrorSource = "uncaughtException" | "unhandledRejection"

/** Shell convention: 128 + the signal number. */
export const SIGNAL_EXIT_CODES: Readonly<Record<ProcessGuardSignal, number>> = {
	SIGINT: 130,
	SIGTERM: 143,
	SIGHUP: 129,
}

export type ProcessGuardEvent =
	| { kind: "signal"; reason: ProcessGuardSignal; exitCode: number }
	| { kind: "error"; reason: ProcessGuardErrorSource; exitCode: 1; error: unknown }

/** The part of `process` the guards use. Tests pass an EventEmitter. */
export interface ProcessGuardTarget {
	on(event: string, listener: (...args: unknown[]) => void): unknown
	off(event: string, listener: (...args: unknown[]) => void): unknown
}

/**
 * Calls `onEvent` for SIGINT, SIGTERM, SIGHUP, an uncaught exception and an
 * unhandled rejection. Returns a function that removes every listener again; it
 * is safe to call more than once. While installed, Node no longer exits on these
 * events by itself, so `onEvent` must end the process (or decide to keep running).
 */
export function installProcessGuards(
	onEvent: (event: ProcessGuardEvent) => void,
	target: ProcessGuardTarget = process,
): () => void {
	const listeners: Array<[string, (...args: unknown[]) => void]> = []

	for (const signal of Object.keys(SIGNAL_EXIT_CODES) as ProcessGuardSignal[]) {
		listeners.push([signal, () => onEvent({ kind: "signal", reason: signal, exitCode: SIGNAL_EXIT_CODES[signal] })])
	}

	for (const source of ["uncaughtException", "unhandledRejection"] as const) {
		listeners.push([source, (error: unknown) => onEvent({ kind: "error", reason: source, exitCode: 1, error })])
	}

	for (const [event, listener] of listeners) {
		target.on(event, listener)
	}

	let installed = true

	return () => {
		if (!installed) {
			return
		}

		installed = false

		for (const [event, listener] of listeners) {
			target.off(event, listener)
		}
	}
}

/** How long the TUI waits for the extension host to dispose before it exits anyway. */
export const TUI_SHUTDOWN_TIMEOUT_MS = 5_000

export interface SuperviseTuiOptions {
	/** Ink's `waitUntilExit`. It rejects when a component throws (Ink's own error boundary). */
	waitUntilExit: () => Promise<unknown>
	/** Ink's `unmount`: restores raw mode and the cursor. A no-op when already unmounted. */
	unmount: () => void
	/** Disposes the extension host the TUI created, if any. */
	disposeHost: () => Promise<void>
	writeError: (text: string) => void
	exit: (code: number) => void
	target?: ProcessGuardTarget
	shutdownTimeoutMs?: number
}

/**
 * Keeps the Ink TUI from leaving the terminal in raw mode or the host running
 * after a signal, an uncaught error or a render error: unmount Ink, print the
 * error, dispose the host (which deletes the ephemeral storage folder), exit.
 * A normal exit (Ctrl+C twice, --oneshot) only removes the guards; those paths
 * dispose and exit on their own.
 */
export function superviseTui(options: SuperviseTuiOptions): void {
	const { shutdownTimeoutMs = TUI_SHUTDOWN_TIMEOUT_MS } = options
	let shuttingDown = false

	const shutdown = async (exitCode: number, source: string, error?: unknown) => {
		if (shuttingDown) {
			return
		}

		shuttingDown = true
		removeGuards()

		try {
			options.unmount()
		} catch {
			// Best effort: the terminal may already be gone (SIGHUP).
		}

		if (error !== undefined) {
			// Ink already drew a render error with its stack; repeat only the message.
			const detail =
				error instanceof Error
					? source === "render"
						? error.message
						: (error.stack ?? error.message)
					: String(error)

			try {
				options.writeError(`[CLI] Fatal error (${source}): ${detail}\n`)
			} catch {
				// Best effort: stderr may be closed.
			}
		}

		const forceExit = setTimeout(() => options.exit(exitCode), shutdownTimeoutMs)

		try {
			await options.disposeHost()
		} catch {
			// Exit anyway; there is nothing left to clean up with.
		}

		clearTimeout(forceExit)
		options.exit(exitCode)
	}

	const removeGuards = installProcessGuards((event) => {
		void shutdown(event.exitCode, event.reason, event.kind === "error" ? event.error : undefined)
	}, options.target)

	options.waitUntilExit().then(
		() => removeGuards(),
		(error: unknown) => void shutdown(1, "render", error),
	)
}
```

### Step 2. `apps/cli/src/commands/cli/run.ts`: import

Find:

```ts
import { isExpectedControlFlowError } from "./cancellation.js"
```

Replace with:

```ts
import { isExpectedControlFlowError } from "./cancellation.js"
import { installProcessGuards, superviseTui, type ProcessGuardEvent } from "./process-guards.js"
```

### Step 3. `run.ts` TUI branch: keep the Ink instance and the host, then supervise

3a. Find:

```ts
			const { createScrollSafeStdout } = await import("../../ui/utils/scrollSafeStdout.js")

			render(
```

Replace with:

```ts
			const { createScrollSafeStdout } = await import("../../ui/utils/scrollSafeStdout.js")

			// The host the TUI creates, so a signal or a crash can dispose it (R6).
			let tuiHost: ExtensionHost | null = null

			const instance = render(
```

3b. Find:

```ts
					createExtensionHost: (opts: ExtensionHostOptions) => new ExtensionHost(opts),
```

Replace with:

```ts
					createExtensionHost: (opts: ExtensionHostOptions) => (tuiHost = new ExtensionHost(opts)),
```

3c. Find (end of the `render(...)` call and the start of its `catch`):

```ts
					stdout: createScrollSafeStdout(process.stdout),
				},
			)
		} catch (error) {
```

Replace with:

```ts
					stdout: createScrollSafeStdout(process.stdout),
				},
			)

			superviseTui({
				waitUntilExit: () => instance.waitUntilExit(),
				unmount: () => instance.unmount(),
				disposeHost: async () => {
					await tuiHost?.dispose()
				},
				writeError: (text) => process.stderr.write(text),
				exit: (code) => process.exit(code),
			})
		} catch (error) {
```

Do not change the `render` options (`exitOnCtrlC`, `incrementalRendering`, `stdout`) or anything under `src/ui/`.

### Step 4. `run.ts` print mode: use the shared guards

4a. Replace the four handler constants. Find this whole block (from `const onSigint = () => {` down to the closing
`}` of `onUnhandledRejection`, exactly as in section 4.2) and replace it with:

```ts
		const onProcessEvent = (event: ProcessGuardEvent) => {
			if (event.kind === "error") {
				if (
					isExpectedControlFlowError(event.error, {
						stdinStreamMode: useStdinPromptStream,
						shuttingDown: isShuttingDown,
						operation: "runtime",
					})
				) {
					return
				}

				emitRuntimeError(normalizeError(event.error), event.reason)

				if (signalOnlyExit) {
					return
				}
			}

			void shutdown(event.reason, event.exitCode)
		}
```

`event.error` is the raw value Node passed (an Error for `uncaughtException`, anything for `unhandledRejection`),
exactly what the old handlers gave to `isExpectedControlFlowError`.

4b. In `shutdown`, find:

```ts
			isShuttingDown = true
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			clearKeepAliveInterval()
```

Replace with:

```ts
			isShuttingDown = true
			removeProcessGuards()
			clearKeepAliveInterval()
```

4c. Find:

```ts
		process.on("SIGINT", onSigint)
		process.on("SIGTERM", onSigterm)
		process.on("uncaughtException", onUncaughtException)
		process.on("unhandledRejection", onUnhandledRejection)

		try {
```

Replace with:

```ts
		const removeProcessGuards = installProcessGuards(onProcessEvent)

		try {
```

(`shutdown` is a function declaration that reads `removeProcessGuards` only when it runs, which is always after this
line, so the `const` is initialized in time.)

4d. Find:

```ts
				await parkUntilSignal("Task loop completed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(0)
```

Replace with:

```ts
				await parkUntilSignal("Task loop completed")
			}

			removeProcessGuards()
			process.exit(0)
```

4e. Find:

```ts
				await parkUntilSignal("Task loop failed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(1)
```

Replace with:

```ts
				await parkUntilSignal("Task loop failed")
			}

			removeProcessGuards()
			process.exit(1)
```

After step 4, `grep -n "onSigint\|onSigterm\|onUncaughtException\|onUnhandledRejection" apps/cli/src/commands/cli/run.ts`
prints nothing. The one intended print-mode change: SIGHUP is now handled like SIGTERM (graceful shutdown, exit 129)
instead of killing the process.

### Step 5. `apps/cli/src/agent/extension-host.ts`

5a. Find:

```ts
// Pre-configured logger for CLI message activity debugging.
const cliLogger = new DebugLogger("CLI")
```

Replace with:

```ts
// Pre-configured logger for CLI message activity debugging.
const cliLogger = new DebugLogger("CLI")

/** How long activate() waits for the extension to report its webview ready. */
export const EXTENSION_READY_TIMEOUT_MS = 10_000

/**
 * Resolves once `isReady()` returns true. After `timeoutMs` it rejects with an
 * error that says what did not happen, instead of p-wait-for's bare
 * "Promise timed out after 10000 milliseconds".
 */
export async function waitForExtensionReady(
	isReady: () => boolean,
	timeoutMs: number = EXTENSION_READY_TIMEOUT_MS,
): Promise<void> {
	await pWaitFor(isReady, {
		interval: 100,
		timeout: {
			milliseconds: timeoutMs,
			message: new Error(
				`The extension did not become ready within ${timeoutMs / 1000} s after activation. ` +
					"Run again with --debug and check ~/.roo/cli-debug.log.",
			),
		},
	})
}
```

5b. Find:

```ts
	private originalProcessEmitWarning: typeof process.emitWarning | null = null
```

Replace with:

```ts
	private originalProcessEmitWarning: typeof process.emitWarning | null = null

	// The no-op "warning" listener added by setupQuietMode. Kept so
	// restoreConsole can remove it: quiet mode is set up again after every
	// interactive prompt, and each call used to add one more listener.
	private readonly suppressWarningListener = () => {}

	// Set by the first dispose() call; later calls wait for the same promise.
	private disposePromise: Promise<void> | null = null
```

5c. Find `		process.on("warning", () => {})` and replace with:

```ts
		process.on("warning", this.suppressWarningListener)
```

5d. In `restoreConsole`, find:

```ts
		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}
	}
```

Replace with:

```ts
		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}

		process.off("warning", this.suppressWarningListener)
	}
```

(The `off` sits after `restoreConsole`'s early `return` for the not-suppressed case; the listener is added only in
the same call that sets `originalConsole`, so add and remove stay paired.)

5e. Find:

```ts
		await pWaitFor(() => this.isReady, { interval: 100, timeout: 10_000 })
```

Replace with:

```ts
		await waitForExtensionReady(() => this.isReady)
```

`pWaitFor` stays imported (used by `waitForExtensionReady`).

5f. Find:

```ts
	async dispose(): Promise<void> {
		// Clear managers.
```

Replace with:

```ts
	/**
	 * Idempotent: in the TUI both the React hook and the process guards may call
	 * it; a second call waits for the first instead of deactivating twice.
	 */
	dispose(): Promise<void> {
		this.disposePromise ??= this.disposeOnce()
		return this.disposePromise
	}

	private async disposeOnce(): Promise<void> {
		// Clear managers.
```

The rest of the old `dispose` body stays as it is and is now the body of `disposeOnce`. `ExtensionHostInterface`
(`dispose(): Promise<void>`) is unchanged.

### Step 6. `docs/07-cli.md`

Find the paragraph:

```
The runtime contract (six environment variables and two `globalThis` slots) is defined once in
`packages/types/src/cli-runtime.ts`. See [architecture.md](architecture.md).
```

Replace with:

```
The runtime contract (six environment variables and two `globalThis` slots) is defined once in
`packages/types/src/cli-runtime.ts`. See [architecture.md](architecture.md).

Both modes install the same process guards (`commands/cli/process-guards.ts`): SIGINT, SIGTERM, SIGHUP, an
uncaught exception and an unhandled rejection dispose the extension host (which also deletes the `--ephemeral`
storage folder) before the process exits with 130, 143, 129 or 1. In the TUI, `superviseTui` first unmounts Ink,
which restores raw mode and the cursor, and it also exits after a render error, which Ink's own error boundary
reports through `waitUntilExit()`. The wait for the extension to become ready is `EXTENSION_READY_TIMEOUT_MS`
(10 s) in `agent/extension-host.ts`.
```

## 7. Tests to add or change

### T1 (new): `apps/cli/src/commands/cli/__tests__/process-guards.test.ts`

Unit tests of the guard function (fake `EventEmitter` target, plus one check on the real `process` that it adds and
removes exactly one listener per event) and of `superviseTui` (order unmount -> print -> dispose -> exit, exit codes
143/1/129, render-error path, single shutdown, normal exit removes listeners, forced exit after
`TUI_SHUTDOWN_TIMEOUT_MS` with fake timers, exit even when unmount/dispose throw). Fails without the fix because
`../process-guards.js` does not exist.

```ts
// pnpm --filter @tumble-code/cli test src/commands/cli/__tests__/process-guards.test.ts

import { EventEmitter } from "events"

import {
	installProcessGuards,
	superviseTui,
	TUI_SHUTDOWN_TIMEOUT_MS,
	type ProcessGuardEvent,
	type ProcessGuardTarget,
} from "../process-guards.js"

const GUARDED_EVENTS = ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException", "unhandledRejection"]

function createTarget() {
	return new EventEmitter() as EventEmitter & ProcessGuardTarget
}

function listenerCounts(target: EventEmitter) {
	return GUARDED_EVENTS.map((event) => target.listenerCount(event))
}

describe("installProcessGuards", () => {
	it("reports each signal with its shell exit code", () => {
		const target = createTarget()
		const events: ProcessGuardEvent[] = []
		installProcessGuards((event) => events.push(event), target)

		target.emit("SIGINT")
		target.emit("SIGTERM")
		target.emit("SIGHUP")

		expect(events).toEqual([
			{ kind: "signal", reason: "SIGINT", exitCode: 130 },
			{ kind: "signal", reason: "SIGTERM", exitCode: 143 },
			{ kind: "signal", reason: "SIGHUP", exitCode: 129 },
		])
	})

	it("passes uncaught errors and rejection reasons on unchanged", () => {
		const target = createTarget()
		const events: ProcessGuardEvent[] = []
		installProcessGuards((event) => events.push(event), target)
		const error = new Error("boom")
		const reason = { code: "ECONNRESET", message: "socket hang up" }

		target.emit("uncaughtException", error)
		target.emit("unhandledRejection", reason)

		expect(events).toEqual([
			{ kind: "error", reason: "uncaughtException", exitCode: 1, error },
			{ kind: "error", reason: "unhandledRejection", exitCode: 1, error: reason },
		])
	})

	it("removes every listener it added, once", () => {
		const target = createTarget()
		const remove = installProcessGuards(() => {}, target)
		expect(listenerCounts(target)).toEqual([1, 1, 1, 1, 1])

		remove()
		remove()

		expect(listenerCounts(target)).toEqual([0, 0, 0, 0, 0])
	})

	it("installs on the real process by default and cleans up after itself", () => {
		const before = GUARDED_EVENTS.map((event) => process.listenerCount(event))

		const remove = installProcessGuards(() => {})
		expect(GUARDED_EVENTS.map((event) => process.listenerCount(event))).toEqual(before.map((count) => count + 1))

		remove()
		expect(GUARDED_EVENTS.map((event) => process.listenerCount(event))).toEqual(before)
	})
})

describe("superviseTui", () => {
	function setup(options: { disposeHost?: () => Promise<void> } = {}) {
		const target = createTarget()
		let rejectExit: (error: unknown) => void = () => {}
		let resolveExit: () => void = () => {}
		const exitPromise = new Promise<void>((resolve, reject) => {
			resolveExit = resolve
			rejectExit = reject
		})
		const calls: string[] = []
		const unmount = vi.fn(() => void calls.push("unmount"))
		const disposeHost = vi.fn(
			options.disposeHost ??
				(async () => {
					calls.push("dispose")
				}),
		)
		const writeError = vi.fn((text: string) => void calls.push(`error ${text.split("\n")[0]}`))
		const exit = vi.fn((code: number) => void calls.push(`exit ${code}`))

		superviseTui({ waitUntilExit: () => exitPromise, unmount, disposeHost, writeError, exit, target })

		return { target, resolveExit, rejectExit, calls, unmount, disposeHost, writeError, exit }
	}

	afterEach(() => {
		vi.useRealTimers()
	})

	it("on SIGTERM unmounts Ink, disposes the host, then exits with 143", async () => {
		const { target, calls } = setup()

		target.emit("SIGTERM")
		await vi.waitFor(() => expect(calls).toContain("exit 143"))

		expect(calls).toEqual(["unmount", "dispose", "exit 143"])
	})

	it("on an uncaught exception prints the error and exits with 1 after disposing", async () => {
		const { target, calls, writeError } = setup()

		target.emit("uncaughtException", new Error("kaput"))
		await vi.waitFor(() => expect(calls).toContain("exit 1"))

		expect(calls).toEqual([
			"unmount",
			"error [CLI] Fatal error (uncaughtException): Error: kaput",
			"dispose",
			"exit 1",
		])
		expect(writeError.mock.calls[0]![0]).toContain("process-guards.test.ts")
	})

	it("on a render error (waitUntilExit rejects) prints the message and exits with 1", async () => {
		const { rejectExit, calls } = setup()

		rejectExit(new Error("render boom"))
		await vi.waitFor(() => expect(calls).toContain("exit 1"))

		expect(calls).toEqual(["unmount", "error [CLI] Fatal error (render): render boom", "dispose", "exit 1"])
	})

	it("shuts down only once when several events arrive", async () => {
		const { target, calls, disposeHost, exit } = setup()

		target.emit("SIGTERM")
		target.emit("SIGINT")
		target.emit("uncaughtException", new Error("late"))
		await vi.waitFor(() => expect(exit).toHaveBeenCalled())

		expect(disposeHost).toHaveBeenCalledTimes(1)
		expect(exit).toHaveBeenCalledTimes(1)
		expect(calls).toEqual(["unmount", "dispose", "exit 143"])
	})

	it("removes its listeners when the TUI exits normally", async () => {
		const { target, resolveExit, exit } = setup()
		expect(listenerCounts(target)).toEqual([1, 1, 1, 1, 1])

		resolveExit()
		await vi.waitFor(() => expect(listenerCounts(target)).toEqual([0, 0, 0, 0, 0]))

		expect(exit).not.toHaveBeenCalled()
	})

	it("exits anyway when disposing the host hangs", async () => {
		vi.useFakeTimers()
		const { target, exit } = setup({ disposeHost: () => new Promise<void>(() => {}) })

		target.emit("SIGHUP")
		await vi.advanceTimersByTimeAsync(TUI_SHUTDOWN_TIMEOUT_MS - 1)
		expect(exit).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1)
		expect(exit).toHaveBeenCalledWith(129)
	})

	it("still exits when unmount or disposal throws", async () => {
		const { target, unmount, exit } = setup({
			disposeHost: async () => {
				throw new Error("dispose failed")
			},
		})
		unmount.mockImplementation(() => {
			throw new Error("stdout closed")
		})

		target.emit("SIGHUP")
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(129))
	})
})
```

### T2 (change): `apps/cli/src/agent/__tests__/extension-host.test.ts`

Add these edits. On the old `extension-host.ts` all 5 new cases fail (listener count grows; the two new exports
are missing; `deactivate` is called twice). On the new file they pass.

T2a. Find:

```ts
import { type ExtensionHostOptions, ExtensionHost } from "../extension-host.js"
```

Replace with:

```ts
import {
	type ExtensionHostOptions,
	ExtensionHost,
	EXTENSION_READY_TIMEOUT_MS,
	waitForExtensionReady,
} from "../extension-host.js"
```

T2b. Find the end of the "quiet mode" describe (the `restoreConsole` describe's last test and the two closing
lines):

```ts
			it("should handle case where console was not suppressed", () => {
				const host = createTestHost()

				expect(() => {
					callPrivate(host, "restoreConsole")
				}).not.toThrow()
			})
		})
	})
```

Replace with:

```ts
			it("should handle case where console was not suppressed", () => {
				const host = createTestHost()

				expect(() => {
					callPrivate(host, "restoreConsole")
				}).not.toThrow()
			})
		})

		describe("warning listener (R6)", () => {
			it("keeps at most one warning listener across repeated prompts", () => {
				const before = process.listenerCount("warning")
				const host = createTestHost({ integrationTest: true })
				const options = getPrivate<ExtensionHostOptions>(host, "options")
				options.integrationTest = false

				// PromptManager calls restoreConsole before and setupQuietMode after every prompt.
				for (let prompt = 0; prompt < 5; prompt++) {
					callPrivate(host, "setupQuietMode")
					expect(process.listenerCount("warning")).toBe(before + 1)
					callPrivate(host, "restoreConsole")
					expect(process.listenerCount("warning")).toBe(before)
				}
			})
		})
	})

	describe("waitForExtensionReady (R6)", () => {
		it("waits ten seconds by default", () => {
			expect(EXTENSION_READY_TIMEOUT_MS).toBe(10_000)
		})

		it("resolves once the extension reports ready", async () => {
			let ready = false
			setTimeout(() => {
				ready = true
			}, 20)

			await expect(waitForExtensionReady(() => ready, 2_000)).resolves.toBeUndefined()
		})

		it("rejects with a message that names the problem and the debug log", async () => {
			const error = await waitForExtensionReady(() => false, 50).catch((e: unknown) => e)

			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toBe(
				"The extension did not become ready within 0.05 s after activation. " +
					"Run again with --debug and check ~/.roo/cli-debug.log.",
			)
		})
	})
```

T2c. In describe "dispose", find the test "should call extension deactivate if available":

```ts
		it("should call extension deactivate if available", async () => {
			const deactivateMock = vi.fn()
			setPrivate(host, "extensionModule", {
				deactivate: deactivateMock,
			})

			await host.dispose()

			expect(deactivateMock).toHaveBeenCalled()
		})
```

and add directly after it:

```ts

		it("deactivates once when dispose is called twice at the same time (R6)", async () => {
			let finishDeactivate: () => void = () => {}
			const deactivating = new Promise<void>((resolve) => (finishDeactivate = resolve))
			const deactivateMock = vi.fn(() => deactivating)
			setPrivate(host, "extensionModule", { deactivate: deactivateMock })

			const first = host.dispose()
			const second = host.dispose()
			finishDeactivate()
			await Promise.all([first, second])

			expect(deactivateMock).toHaveBeenCalledTimes(1)
		})
```

### Existing tests that must keep passing unchanged

- `apps/cli/src/commands/cli/__tests__/run.test.ts` (print-mode runs with `process.exit` mocked; the TUI test
  "erases the screen..." uses the mocked `render` whose `waitUntilExit` resolves, so `superviseTui` removes its
  listeners right away).
- `apps/cli/src/commands/cli/__tests__/cancellation.test.ts`, `stdin-stream.test.ts`.
- `apps/cli/src/ui/hooks/__tests__/useExtensionHost.test.tsx` (uses a fake host; `dispose` idempotence does not
  affect it).

No e2e or integration test is added: the behavior is fully represented by unit tests of the guard function, the
supervisor and `ExtensionHost` (AGENTS.md: lowest layer).

## 8. Commands to run (exact, from which directory) and the expected result

1. Prove the tests first: add T1 and T2 before steps 1-5, then
   `cd apps/cli && npx vitest run src/commands/cli/__tests__/process-guards.test.ts src/agent/__tests__/extension-host.test.ts`
   -> process-guards file fails to load; extension-host: 5 failed (the new cases), 66 passed.
2. After steps 1-5, the same command -> 11 + 71 passed.
3. `cd apps/cli && npx vitest run src/commands src/agent src/ui src/lib` -> all pass (about 1281 tests, 5 skipped;
   `cli-bundle.test.ts` builds into an OS temp folder and takes a few seconds).
   Do not run the integration suites here (`pnpm --filter @tumble-code/cli test:integration`); F1 is known flaky.
4. `pnpm --filter @tumble-code/cli check-types` -> no errors.
5. `cd apps/cli && npx eslint src/commands/cli/process-guards.ts src/commands/cli/__tests__/process-guards.test.ts src/commands/cli/run.ts src/agent/extension-host.ts src/agent/__tests__/extension-host.test.ts --max-warnings=0`
   -> no output.
6. Root: `npx prettier --check apps/cli/src/commands/cli/process-guards.ts apps/cli/src/commands/cli/__tests__/process-guards.test.ts apps/cli/src/commands/cli/run.ts apps/cli/src/agent/extension-host.ts apps/cli/src/agent/__tests__/extension-host.test.ts docs/07-cli.md`
   -> `run.ts` is reported even before this change (an unrelated line near 157 is not prettier-formatted on
   `origin/main`); run `npx prettier --write apps/cli/src/commands/cli/run.ts` and accept that one-line reflow of
   `return [`No model given ...`]`. All other files must be clean.
7. Manual smoke (optional, needs a built extension: `pnpm --filter @tumble-code/cli build:extension`):
   `cd apps/cli && pnpm dev -- --ephemeral` in a terminal, then from another terminal `kill -TERM <pid>`; expect the
   shell prompt back, exit status 143 (`echo $?`), a normal cursor and echo, and no leftover folder from
   `createEphemeralStorageDir` in the OS temp dir.

## 9. Do not touch / pitfalls

- Do-not-touch: the CLI's Ink render pipeline (`streamCommit.ts`, `TailViewport.tsx`, the `useInsertionEffect`
  ordering, `theme.dimmed`). Nothing under `apps/cli/src/ui/` changes in this item.
- Do not add a React error boundary component: Ink's internal one already catches render errors and rejects
  `waitUntilExit()` (section 5). A second boundary would swallow the error before Ink restores raw mode.
- Keep passing the raw `event.error` to `isExpectedControlFlowError`; normalizing first loses `code` on non-Error
  rejection reasons.
- Keep `shutdown(...)` exit codes: SIGINT 130, SIGTERM 143, errors 1; SIGHUP 129 is new.
- `--signal-only-exit` semantics stay: errors are reported and the process keeps running; only signals exit.
- `apps/cli/src/commands/cli/list.ts` has its own SIGINT/SIGTERM handling for a short listing; leave it.
- The forced-exit timer (`TUI_SHUTDOWN_TIMEOUT_MS`, 5 s) only applies to the TUI shutdown path.
- Known flaky: F1 (`cli-integration` case `create-with-session-id-resume-loads-correct-session`) and F2 (Windows
  `TaskHistoryStore` lock count). Not related; re-run if they fail.
- Tests that touch the real `process` must remove what they add (T1 does: `remove()` at the end).

## 10. Acceptance checklist (checkboxes)

- [ ] `apps/cli/src/commands/cli/process-guards.ts` exports `installProcessGuards`, `superviseTui`,
      `SIGNAL_EXIT_CODES`, `TUI_SHUTDOWN_TIMEOUT_MS` and the event types.
- [ ] Print mode uses `installProcessGuards`; no `onSigint`/`onSigterm`/`onUncaughtException`/`onUnhandledRejection`
      left in `run.ts`.
- [ ] The TUI branch keeps the Ink instance and the created host and calls `superviseTui`.
- [ ] `ExtensionHost.dispose()` is idempotent; the warning listener is removed in `restoreConsole`;
      `EXTENSION_READY_TIMEOUT_MS` and `waitForExtensionReady` exist and `activate` uses them.
- [ ] T1 (11 cases) and T2 (5 new cases) pass; they failed before the change.
- [ ] Nothing under `apps/cli/src/ui/` changed.
- [ ] check-types, eslint, prettier clean; `docs/07-cli.md` updated.
- [ ] `.changeset/cli-process-guards.md` and `ai_plans/2026-09-27_r6-cli-process-guards.md` added.

## 11. Commit, changeset and PR text

Commit title: `fix(cli): clean up after signals and crashes in the TUI (R6)`

Commit body:

```
The Ink TUI installed no process handlers. SIGTERM or a closed terminal
(SIGHUP) ended the process without ExtensionHost.dispose(), so the
extension was never deactivated and the --ephemeral folder stayed behind;
an uncaught error did the same, and a render error left a dead screen
because nobody waited for Ink's exit promise.

installProcessGuards (commands/cli/process-guards.ts) now installs the
SIGINT, SIGTERM, SIGHUP, uncaughtException and unhandledRejection handlers
for both modes. Print mode keeps its behavior and also handles SIGHUP. The
TUI's superviseTui unmounts Ink, prints the error, disposes the host and
exits (130/143/129/1), also when waitUntilExit rejects after a render error
(Ink's own error boundary), with a 5 s limit on the dispose.

ExtensionHost: dispose() is idempotent, the quiet-mode "warning" listener
is removed again instead of piling up after every prompt, and the 10 s
activation wait is EXTENSION_READY_TIMEOUT_MS with a readable error.

<the commit attribution trailers your harness requires>
```

`.changeset/cli-process-guards.md`:

```md
---
"tumble-code": patch
---

The CLI's interactive mode now cleans up when it is stopped from outside or crashes. Closing the terminal, `kill`, an unexpected error or a failure while drawing the screen now restores the terminal, shuts the agent down (deleting the temporary folder of an `--ephemeral` run) and exits with a proper status, instead of leaving the folder behind or a frozen screen. When the extension does not start within 10 seconds, the error now says so and points to `~/.roo/cli-debug.log`.
```

`ai_plans/2026-09-27_r6-cli-process-guards.md`:

```md
# R6: CLI TUI crash and signal handling

Item R6 of `2026-09-27_simplification-roadmap.md`.

## Problem

- Print mode handled SIGINT, SIGTERM and uncaught errors; the Ink TUI handled none. A signal or an uncaught error
  ended the process without `ExtensionHost.dispose()` (no `deactivate`, `--ephemeral` folder left behind).
- A render error: Ink's internal error boundary unmounted and rejected `waitUntilExit()`, but `run.ts` never waited
  on it, so the host kept the process alive behind a dead screen.
- `setupQuietMode` added a new `"warning"` listener after every prompt and never removed it.
- The activation wait failed with "Promise timed out after 10000 milliseconds".

## Change

- `commands/cli/process-guards.ts`: `installProcessGuards(onEvent)` (SIGINT 130, SIGTERM 143, SIGHUP 129,
  uncaughtException and unhandledRejection 1) used by print mode, and `superviseTui` for the TUI: unmount Ink, print
  the error, dispose the host (5 s limit), exit; also on a `waitUntilExit()` rejection.
- `ExtensionHost`: idempotent `dispose()`, one reusable warning listener removed in `restoreConsole`,
  `EXTENSION_READY_TIMEOUT_MS` and `waitForExtensionReady` with a readable message.

## Not done, on purpose

No custom React error boundary: Ink 7 already has one and reports through `waitUntilExit()`. `list.ts` keeps its own
short-lived SIGINT/SIGTERM handling.

## Tests

- `process-guards.test.ts` (11 cases): event mapping, listener removal, TUI shutdown order and codes, render error,
  single shutdown, forced exit.
- `extension-host.test.ts`: warning listener count stays at one across prompts; ready-wait message and default;
  concurrent `dispose()` deactivates once. All fail without the fix.
```

PR body outline:

- Title = commit title.
- Problem (the four bullets above), with the Ink finding (internal error boundary, `waitUntilExit`).
- Change: the guard module, print-mode refactor (behavior kept, SIGHUP added), TUI supervision, ExtensionHost fixes.
- Why no custom error boundary.
- Tests and commands run; manual `kill -TERM` smoke result if done.
- End with the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If `render(...)` in the installed Ink version does not return an object with `waitUntilExit` and `unmount`, stop
  and report the Ink version and the returned keys; do not wrap `App` in a custom boundary instead.
- If a `run.test.ts` case fails after step 4 because `process.exit` is mocked to throw and a guard fires later, report
  the case name and output; do not change `run.test.ts` expectations.
- If Windows CI fails in `installProcessGuards` on SIGHUP, apply H1's fallback only and report.
- If making `dispose()` idempotent breaks a test that disposes the same host twice and expects two deactivations,
  stop and report the test; do not remove the idempotence.
