# Port plan — Zoo PR #645 → `feature/zoo-645-terminalregistry-race-condition-guard`

> **For the executor (read first).** Do the steps in order. Do not improvise or
> refactor beyond what is written (YAGNI). Every code block is already adapted to
> this repo. This repo is **Tumble Code**: never introduce the strings "Roo" or
> "Zoo" in user-facing text or test names.

---

## 0. Context

- **Upstream:** Zoo PR #645 — "fix(TerminalRegistry): updating guard condition to
  address race condition for fast commands" (commit `e80039bb5`, merged
  2026-06-17).
- **What it does:** Fixes a race where a fast command's
  `onDidEndTerminalShellExecution` end event arrives **before**
  `setActiveStream()` has flipped `terminal.running` to `true`. In that window the
  old guard logged an error, set `busy = false`, and returned **without signalling
  completion** — so any `TerminalProcess.run()` awaiting `shell_execution_complete`
  hung forever. The fix: when `running` is still false but a `process` exists,
  deliver `shellExecutionComplete(exitDetails)` (which emits
  `shell_execution_complete`, clears `busy`/`running`, and drains output) instead
  of stranding it; only fall back to `busy = false` when there is no process. Also
  removes the now-redundant trailing `terminal.busy = false` after the normal
  completion path (since `shellExecutionComplete` already clears `busy`).
- **Why we want it:** real correctness fix in shared terminal core; matches our
  weak-model / robustness priorities. Low risk — behavior-preserving for the
  normal (running=true) path; only the previously-broken race path changes.

- **Adaptations vs. the raw upstream diff:**

    1. **Code is identical pre-diff.** Our `TerminalRegistry.ts` guard block
       (lines 105–126) matches Zoo's pre-diff state exactly, except the unrelated
       branding string at line 94 ("Tumble Code-tracked terminal"), which is
       **outside** the hunks. The diff applies cleanly.
    2. **Issue-number comments kept.** The fix's comment references `#489 / #622`
       and the test describe block carries `(#489, #622)`. These are inherited
       upstream issue numbers; our fork already uses this convention (e.g. the
       existing `releaseTerminalsForTask` test `(#245)`). Keep them — they are bare
       issue numbers, **not** "Roo"/"Zoo" branding.
    3. **Test harness is compatible.** Verified our `TerminalRegistry` exposes the
       private `isInitialized` field and static `initialize()`, and `BaseTerminal`
       exposes `running`, `busy`, `process`, and `shellExecutionComplete()` (which
       sets `busy=false`/`running=false`, emits `shell_execution_complete`, and
       clears `process`). The two new tests run unmodified.

- **Original author — credit:**

    ```text
    Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
    ```

## 1. Preconditions

- [x] Branch `feature/zoo-645-terminalregistry-race-condition-guard` off
      `feature/zoo-608-add-glm-5-2-support` (stacked).
- [x] `TerminalRegistry.ts` guard block matches Zoo pre-diff (lines 105–126).
- [x] `releaseTerminalsForTask` describe block present (the test insertion anchor).

## 2. Failing test first (TDD)

Insert the new describe block in
`src/integrations/terminal/__tests__/TerminalRegistry.spec.ts` immediately
**before** `describe("releaseTerminalsForTask", …)` (currently line 208). It
captures the `onDidEndTerminalShellExecution` handler via a spy, then drives the
race:

- Test 1 — "calls shellExecutionComplete when end event fires before running is
  set (race)": process present, `running===false`; firing the end event must emit
  `shell_execution_complete` once with `{ exitCode: 0 }` and leave `busy===false`.
  **This is RED against current code** (current guard never emits — it only sets
  `busy=false`).
- Test 2 — "sets busy=false without calling shellExecutionComplete when no process
  exists": process undefined; end event must set `busy=false` and **not** call
  `shellExecutionComplete`. (Green even pre-fix — it pins the no-process branch.)

Run RED: `cd src && npx vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts`
→ Test 1 fails (`shell_execution_complete` never emitted).

Full block (2-space-then-tab indentation matching the file; verbatim from upstream
— no "Roo"/"Zoo" introduced):

```ts
describe("onDidEndTerminalShellExecution race condition (#489, #622)", () => {
	let endHandler: (e: any) => Promise<void>

	beforeEach(() => {
		// Reset the initialized flag so we can call initialize() in this block.
		TerminalRegistry["isInitialized"] = false

		// The global vscode mock doesn't define shell execution event
		// methods, so add them before spying.
		;(vscode.window as any).onDidStartTerminalShellExecution ??= () => ({ dispose: () => {} })
		;(vscode.window as any).onDidEndTerminalShellExecution ??= () => ({ dispose: () => {} })

		vi.spyOn(vscode.window, "onDidStartTerminalShellExecution" as any).mockImplementation((_handler: any) => ({
			dispose: vi.fn(),
		}))

		vi.spyOn(vscode.window, "onDidEndTerminalShellExecution" as any).mockImplementation((handler: any) => {
			endHandler = handler
			return { dispose: vi.fn() }
		})

		TerminalRegistry.initialize()
	})

	afterEach(() => {
		// Reset so other test blocks aren't affected.
		TerminalRegistry["isInitialized"] = false
	})

	it("calls shellExecutionComplete when end event fires before running is set (race)", async () => {
		const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
		const mockProcess = {
			command: "echo hello",
			emit: vi.fn(),
			hasUnretrievedOutput: vi.fn().mockReturnValue(false),
		} as any
		terminal.process = mockProcess

		// Simulate the race: running is still false (setActiveStream hasn't
		// been called yet), but the end event fires.
		expect(terminal.running).toBe(false)

		const mockExecution = { commandLine: { value: "echo hello" } }
		await endHandler({
			terminal: terminal.terminal,
			execution: mockExecution,
			exitCode: 0,
		})

		// shellExecutionComplete should have been called exactly once, emitting
		// shell_execution_complete so TerminalProcess.run() unblocks.
		expect(mockProcess.emit).toHaveBeenCalledWith(
			"shell_execution_complete",
			expect.objectContaining({ exitCode: 0 }),
		)
		expect(mockProcess.emit).toHaveBeenCalledTimes(1)

		// Terminal should be back to idle state.
		expect(terminal.busy).toBe(false)
		expect(terminal.running).toBe(false)
	})

	it("sets busy=false without calling shellExecutionComplete when no process exists", async () => {
		const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
		terminal.busy = true
		terminal.process = undefined
		const completeSpy = vi.spyOn(terminal, "shellExecutionComplete")

		expect(terminal.running).toBe(false)

		const mockExecution = { commandLine: { value: "echo hello" } }
		await endHandler({
			terminal: terminal.terminal,
			execution: mockExecution,
			exitCode: 0,
		})

		expect(terminal.busy).toBe(false)
		expect(completeSpy).not.toHaveBeenCalled()
	})
})
```

## 3. Production fix — `src/integrations/terminal/TerminalRegistry.ts`

### Edit A — the `!terminal.running` guard (lines 105–113)

Replace:

```ts
if (!terminal.running) {
	console.error("[TerminalRegistry] Shell execution end event received, but process is not running for terminal:", {
		terminalId: terminal?.id,
		command: process?.command,
		exitCode: e.exitCode,
	})

	terminal.busy = false
	return
}
```

with:

```ts
if (!terminal.running) {
	// The end event can arrive before setActiveStream() has set
	// running=true (race between the global VS Code event and the
	// synchronous call in TerminalProcess.run). If a process is
	// waiting for completion, deliver the signal so it doesn't
	// hang forever. See #489 / #622.
	if (process) {
		console.info("[TerminalRegistry] End event arrived before running=true (race); delivering completion signal", {
			terminalId: terminal.id,
			exitCode: e.exitCode,
		})
		terminal.shellExecutionComplete(exitDetails)
	} else {
		terminal.busy = false
	}

	return
}
```

### Edit B — drop the redundant trailing `busy = false` (lines 124–126)

Replace:

```ts
// Signal completion to any waiting processes.
terminal.shellExecutionComplete(exitDetails)
terminal.busy = false // Mark terminal as not busy when shell execution ends
```

with:

```ts
// Signal completion to any waiting processes.
terminal.shellExecutionComplete(exitDetails)
```

(`shellExecutionComplete` already sets `busy = false`, so the trailing line is
dead.)

## 4. Out of scope

- No change to `BaseTerminal`/`Terminal`/`TerminalProcess`. No "Zoo"/"Roo"
  strings. No rename of inherited issue-number references.

## 5. Verify

- `cd src && npx vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts`
  → all green (both new tests pass, existing suite unaffected).
- `pnpm --filter tumble-code check-types` clean.
- `cd src && npx eslint integrations/terminal/TerminalRegistry.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts` clean.

## 6. Acceptance

- [x] Race path delivers `shellExecutionComplete` when a process exists.
- [x] No-process path still just clears `busy`.
- [x] Redundant trailing `busy = false` removed from the normal path.
- [x] No "Roo"/"Zoo" user-facing strings introduced.

## 7. Record

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record --pr 645 --status ported \
  --branch feature/zoo-645-terminalregistry-race-condition-guard \
  --plan ai_plans/2026-06-17_zoo-645-terminalregistry-race-condition-guard.md
```
