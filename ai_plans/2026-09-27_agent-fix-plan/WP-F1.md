# WP-F1: CLI stream resume answers a replayed completion ask and the answer is lost

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/f1-cli-resume-waits-for-resume-ask      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

When the CLI runs in `--stdin-prompt-stream` mode with `--session-id` (or `--continue`), the first `message`
command must be delivered to the resumed task's resume ask (`resume_completed_task` / `resume_task`), not to the
old `completion_result` ask that the extension replays from the saved chat. Make the message handler wait for the
resume ask before routing the first message of a resumed session, exactly as it already does after a `cancel`.
This removes the flaky (in practice nearly always failing) CLI integration case
`create-with-session-id-resume-loads-correct-session`.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Any client that resumes a CLI session over the stdin stream protocol and sends a message right away gets
`control done code "responded"` ("message sent to current ask") and then nothing: the message is silently
dropped and the task waits on its resume ask forever. The CI job `cli-integration` fails on most runs (also on
main) because of this. In this sandbox the unfixed case failed 4 of 4 runs; with the fix it passed 10 of 10, and the full integration suite (15 cases) passed.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`, `docs/architecture.md` (section "The CLI runtime contract", "Do not touch without a dedicated item").
- `apps/cli/src/commands/cli/stdin-stream/handlers/message.ts`: `handleMessageCommand`, `isResumableState`,
  `waitForPostCancelRecovery`, `RESUME_ASKS`, `CANCEL_RECOVERY_WAIT_TIMEOUT_MS`.
- `apps/cli/src/commands/cli/stdin-stream/session.ts`: `StdinStreamModeOptions`, `StdinStreamSession`
  (`awaitingPostCancelRecovery`).
- `apps/cli/src/commands/cli/run.ts`: `bootstrapResumeForStdinStream`, the `runStdinStreamMode({ ... })` call
  (near line 774), `isResumeRequested` (near line 191).
- `apps/cli/src/commands/cli/stdin-stream/handlers/cancel.ts`: sets `session.awaitingPostCancelRecovery = true`
  (the existing pattern this fix reuses).
- `apps/cli/src/agent/agent-state.ts`: `detectAgentState` (the CLI derives "waiting for input" and `currentAsk`
  only from the LAST clineMessage).
- `packages/types/src/message.ts`: `idleAsks`, `resumableAsks`, `textResponseAsks` (`completion_result` and
  `resume_completed_task` are both text-response asks).
- `src/core/task/TaskResumption.ts`: `TaskResumption.resumeTaskFromHistory` (steps 1-4).
- `src/core/task/TaskHistory.ts`: `overwriteClineMessages` (posts state BEFORE the resume ask exists).
- `src/core/task/TaskAskSay.ts`: `TaskAskSay.ask` (clears `askResponse` before adding the new ask) and
  `handleWebviewAskResponse`.
- `src/core/webview/messageHandlers/taskLifecycle.ts`: `askResponse` handler (calls
  `provider.getCurrentTask()?.handleWebviewAskResponse(...)`).
- `apps/cli/src/commands/cli/__tests__/stdin-stream.test.ts`: `startHarness`, `FakeClient.setAsk`, the test
  "waits for the reloaded task before routing the next message" (the model for the new tests).
- `apps/cli/scripts/integration/cases/create-with-session-id-resume-loads-correct-session.ts`:
  `resumeSessionAndSendMarker`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

### apps/cli/src/commands/cli/run.ts, `bootstrapResumeForStdinStream` (near line 64)

```ts
const STREAM_RESUME_WAIT_TIMEOUT_MS = 2_000

async function bootstrapResumeForStdinStream(host: ExtensionHost, sessionId: string): Promise<void> {
	host.sendToExtension({ type: "showTaskWithId", text: sessionId })

	// Best-effort wait so early stdin "message" commands can target the resumed task.
	await pWaitFor(() => host.client.hasActiveTask() || host.isWaitingForInput(), {
		interval: 25,
		timeout: STREAM_RESUME_WAIT_TIMEOUT_MS,
	}).catch(() => undefined)
}
```

### apps/cli/src/commands/cli/run.ts, the stream call (near line 770)

```ts
				if (isResumeRequested) {
					await bootstrapResumeForStdinStream(host, resolvedResumeSessionId!)
				}

				await runStdinStreamMode({
					host,
					jsonEmitter,
					setStreamRequestId: (id) => {
						streamRequestId = id
					},
				})
```

### apps/cli/src/commands/cli/stdin-stream/handlers/message.ts, `handleMessageCommand` (top part)

```ts
const RESUME_ASKS: ReadonlySet<string> = new Set([...resumableAsks, "resume_completed_task"])
const CANCEL_RECOVERY_WAIT_TIMEOUT_MS = 8_000
const CANCEL_RECOVERY_POLL_INTERVAL_MS = 100
...
async function waitForPostCancelRecovery(host: ExtensionHost): Promise<void> {
	const deadline = Date.now() + CANCEL_RECOVERY_WAIT_TIMEOUT_MS

	while (Date.now() < deadline) {
		if (isResumableState(host)) {
			return
		}

		await new Promise((resolve) => setTimeout(resolve, CANCEL_RECOVERY_POLL_INTERVAL_MS))
	}
}

export async function handleMessageCommand(session: StdinStreamSession, command: RooCliMessageCommand): Promise<void> {
	const { host } = session

	// If cancel was requested, wait briefly for the task to be rehydrated
	// so message prompts don't race into the pre-cancel task instance.
	if (session.awaitingPostCancelRecovery) {
		await waitForPostCancelRecovery(host)
	}

	const wasResumable = isResumableState(host)
	const currentAsk = host.client.getCurrentAsk()
	const shouldSendAsAskResponse = shouldSendMessageAsAskResponse(host.isWaitingForInput(), currentAsk)
	...
	if (shouldSendAsAskResponse) {
		// Match webview behavior: if there is an active ask, route message directly as an ask response.
		host.sendToExtension({
			type: "askResponse",
			askResponse: "messageResponse",
			text: command.prompt,
			images: command.images,
		})
		...
			content: "message sent to current ask",
			code: "responded",
```

### apps/cli/src/commands/cli/stdin-stream/session.ts, `StdinStreamModeOptions` and constructor

```ts
export interface StdinStreamModeOptions {
	host: ExtensionHost
	jsonEmitter: JsonEventEmitter
	setStreamRequestId: (id: string | undefined) => void
}
...
	cancelRequestedForActiveTask = false
	awaitingPostCancelRecovery = false

	constructor({ host, jsonEmitter, setStreamRequestId }: StdinStreamModeOptions) {
		this.host = host
		this.jsonEmitter = jsonEmitter
```

### src/core/task/TaskResumption.ts, `resumeTaskFromHistory` (near line 84)

```ts
			// Step 1: Clean up stale messages
			const modifiedClineMessages = await this.cleanupStaleMessages()

			// Step 2: Save and load updated messages
			await this.access.history.overwriteClineMessages(modifiedClineMessages)
			this.access.clineMessages = await this.access.history.getSavedClineMessages()

			// Step 3: Load API conversation history
			this.access.apiConversationHistory = await this.access.history.getSavedApiConversationHistory()

			// Step 4: Determine resume type and ask user
			const lastClineMessage = this.findLastRelevantMessage()
			const askType = this.determineAskType(lastClineMessage)

			this.access.isInitialized = true

			const { response, text, images } = await this.access.askSay.ask(askType)
```

### src/core/task/TaskHistory.ts, `overwriteClineMessages` (near line 454)

```ts
	async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.access.clineMessages = newMessages
		this.access.restoreTodoListForTask()

		// Push the new message set to the webview *before* persisting. ...
		await this.access.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()

		await this.saveClineMessages()
```

### src/core/task/TaskAskSay.ts, `ask` (non-partial branch, near line 291)

```ts
		} else {
			// This is a new non-partial message, so add it like normal.
			this.access.askResponse = undefined
			this.access.askResponseText = undefined
			this.access.askResponseImages = undefined
			askTs = Date.now()
			this.access.lastMessageTs = askTs
			await this.access.history.addToClineMessages({
```

(Before this branch `ask()` also awaits `provider.getState()` and the auto-approval check.)

### src/core/webview/messageHandlers/taskLifecycle.ts, `askResponse`

```ts
			const target = message.taskId ? provider.getBackgroundTask(message.taskId) : provider.getCurrentTask()
			target?.handleWebviewAskResponse(message.askResponse!, resolved.text, resolved.images)
```

## 5. Root cause / analysis

VERIFIED (code read and reproduced):

1. `--session-id` in stream mode calls `bootstrapResumeForStdinStream`, which sends `showTaskWithId` and waits
   until `host.client.hasActiveTask() || host.isWaitingForInput()` (max 2 s).
2. The extension creates the Task with the history item; `TaskResumption.resumeTaskFromHistory` step 2 calls
   `TaskHistory.overwriteClineMessages`, which posts state with the saved chat BEFORE the resume ask exists. For
   a session that finished, the saved chat ends on the old `completion_result` ask (that is the replayed
   `{"type":"result","done":true,"success":true}` line seen in the CI log).
3. The CLI derives its state from the last clineMessage only (`detectAgentState` in
   `apps/cli/src/agent/agent-state.ts`): `completion_result` is an idle ask, so `isWaitingForInput = true`,
   `currentAsk = "completion_result"`. `isTextResponseAsk("completion_result")` is true, so
   `handleMessageCommand` sends `askResponse` / `messageResponse` right away and emits `done` /
   `"responded"` / "message sent to current ask".
4. In the extension, `handleWebviewAskResponse` sets `task.askResponse` while the resumed task is still between
   step 2 and the `ask()` call (saving the chat file, reading it back, reading the API history,
   `provider.getState()`, auto-approval check). `TaskAskSay.ask("resume_completed_task")` then executes
   `this.access.askResponse = undefined` in its "new non-partial message" branch, wiping the answer, and waits in
   `pWaitFor` forever. Nothing else sends a second answer, so the stream goes silent until the case's 180 s
   timeout. (If the answer arrives before the task is on the provider stack, `getCurrentTask()` returns
   undefined and it is dropped outright; same effect.)
5. Measured in this sandbox: from the `message` command to the resume ask takes about 4 s, while the CLI
   answers within milliseconds of the replayed state. That is why the case fails on most runs; it passes only
   when the timing happens to put the answer after the clearing line.
6. Reproduction: after `pnpm turbo run bundle --filter=tumble-code`, the unfixed case failed 4 of 4 runs with
   exactly the CI message (`pingSent=true, messageSent=true, sawMessageControlDone=true,
   sawUserTurnWithMarker=false`).
7. Fix verified: with the change in section 6 applied to a scratch copy of `apps/cli` (run through
   `ROO_CLI_ROOT`), the case passed 10 of 10 runs (each about 19 s; one of them inside a full-suite run where all 15 cases passed). Log shows the `message` `done` arrives about
   4 s after the ping, followed by the `{"type":"user", "content":"Resume marker token: ..."}` echo for both
   sessions. The new unit test fails on the unfixed source ("expected vi.fn() to not be called at all, but
   actually been called 1 times") and passes with the fix; the whole `stdin-stream.test.ts` file passes
   (39 tests); `tsc --noEmit` in `apps/cli` passes.

Not a factor (checked): the CLI `AskDispatcher` auto-resume (`handleResumeTask`) is disabled in JSON output
mode (`disableOutput = useJsonOutput` in run.ts -> `AskDispatcher({ disabled })`); extension auto-approval
(`checkAutoApproval`) never approves `resume_*` asks.

Why the fix is in the CLI and not in `TaskAskSay.ask()`: the CLI is the one treating a replayed, dead ask as
live. `TaskAskSay.ask()` clearing a stale `askResponse` is deliberate (it keeps an old answer from satisfying a
new ask), is used by every ask in the product, and is listed-adjacent to "Task control" in the do-not-touch
list. The webview never shows answer controls for the replayed ask during resume, so only the CLI hits this.
The fix reuses the existing, tested post-cancel mechanism (`isResumableState` + poll) which already waits for
`resume_task` / `resume_completed_task`.

Why a resume ask seen by the CLI is always fresh: `cleanupStaleMessages` (TaskResumption step 1) removes trailing
`resume_task` / `resume_completed_task` asks before the chat is posted, so any resume ask the CLI sees was added
by this process's `ask()`, which already cleared `askResponse` before adding it. An answer sent after that is
kept and picked up by the `pWaitFor` loop.

HYPOTHESIS (not needed for the fix, not verified): the ~4 s delay before the resume ask comes from
`saveClineMessages` / `TaskHistoryStore` writes in steps 2-3. Do not investigate it in this WP.

## 6. Step-by-step changes

Step 1. File `apps/cli/src/commands/cli/stdin-stream/session.ts`.

Find:
```ts
	setStreamRequestId: (id: string | undefined) => void
}

type ControlEvent = Parameters<JsonEventEmitter["emitControl"]>[0]
```
Replace with:
```ts
	setStreamRequestId: (id: string | undefined) => void
	/**
	 * The stream continues a saved session (--session-id or --continue). The
	 * first message then waits for the resumed task's resume ask; see
	 * handleMessageCommand.
	 */
	resumingSession?: boolean
}

type ControlEvent = Parameters<JsonEventEmitter["emitControl"]>[0]
```

Step 2. Same file.

Find:
```ts
	awaitingPostCancelRecovery = false

	constructor({ host, jsonEmitter, setStreamRequestId }: StdinStreamModeOptions) {
		this.host = host
```
Replace with:
```ts
	awaitingPostCancelRecovery = false
	/** True until the first message of a resumed session has been routed. */
	awaitingResumeAsk: boolean

	constructor({ host, jsonEmitter, setStreamRequestId, resumingSession }: StdinStreamModeOptions) {
		this.host = host
		this.awaitingResumeAsk = resumingSession === true
```

Step 3. File `apps/cli/src/commands/cli/stdin-stream/handlers/message.ts`.

Find:
```ts
const CANCEL_RECOVERY_WAIT_TIMEOUT_MS = 8_000
```
Replace with:
```ts
const CANCEL_RECOVERY_WAIT_TIMEOUT_MS = 8_000
const SESSION_RESUME_WAIT_TIMEOUT_MS = 30_000
```

Step 4. Same file.

Find:
```ts
async function waitForPostCancelRecovery(host: ExtensionHost): Promise<void> {
	const deadline = Date.now() + CANCEL_RECOVERY_WAIT_TIMEOUT_MS
```
Replace with:
```ts
async function waitForResumeAsk(host: ExtensionHost, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
```

Step 5. Same file.

Find:
```ts
	if (session.awaitingPostCancelRecovery) {
		await waitForPostCancelRecovery(host)
	}
```
Replace with:
```ts
	if (session.awaitingPostCancelRecovery) {
		await waitForResumeAsk(host, CANCEL_RECOVERY_WAIT_TIMEOUT_MS)
	}

	// A resumed session (--session-id, --continue) first shows the saved chat,
	// which can end on the old completion_result ask. No task waits on that
	// ask: the resumed task is still on its way to its resume ask, and
	// TaskAskSay.ask() clears any answer that arrives before it asks. Wait
	// for the resume ask, so the answer reaches the ask that reads it.
	if (session.awaitingResumeAsk) {
		session.awaitingResumeAsk = false
		await waitForResumeAsk(host, SESSION_RESUME_WAIT_TIMEOUT_MS)
	}
```

After steps 3-5 grep the file: `waitForPostCancelRecovery` must no longer appear anywhere
(`grep -rn waitForPostCancelRecovery apps/cli/src` -> no output). It is not exported and has no other callers.

Step 6. File `apps/cli/src/commands/cli/run.ts`.

Find:
```ts
				await runStdinStreamMode({
					host,
					jsonEmitter,
					setStreamRequestId: (id) => {
						streamRequestId = id
					},
				})
```
Replace with:
```ts
				await runStdinStreamMode({
					host,
					jsonEmitter,
					setStreamRequestId: (id) => {
						streamRequestId = id
					},
					resumingSession: isResumeRequested,
				})
```

Leave `bootstrapResumeForStdinStream` and `STREAM_RESUME_WAIT_TIMEOUT_MS` unchanged (ping and shutdown must keep
answering immediately; only `message` waits).

Notes on behavior after the change:
- If the resume ask never comes (bad session, extension error), the first message waits up to 30 s, then falls
  through to the old routing (error `no_active_task`, or queue / answer as before). No new failure mode.
- Commands are handled one at a time (`for await` in `runStdinStreamMode`), so a `shutdown` sent while the first
  message waits is handled after the wait. The integration case only sends shutdown after the user echo.
- `start` on a resumed session is already rejected with `task_busy` because a task is active; no change needed.

## 7. Tests to add or change

Layer: CLI package-local unit test (AGENTS.md: routing decision in the CLI, no extension host needed). The
existing harness in `apps/cli/src/commands/cli/__tests__/stdin-stream.test.ts` already fakes the host state; it
only needs a way to pass the new option.

7.1 Edit `startHarness` in `apps/cli/src/commands/cli/__tests__/stdin-stream.test.ts`.

Find:
```ts
function startHarness(): Harness {
```
Replace with:
```ts
function startHarness({ resumingSession = false }: { resumingSession?: boolean } = {}): Harness {
```

Find (inside `startHarness`, occurs once):
```ts
		jsonEmitter: emitter as unknown as JsonEventEmitter,
		setStreamRequestId,
	})
```
Replace with:
```ts
		jsonEmitter: emitter as unknown as JsonEventEmitter,
		setStreamRequestId,
		resumingSession,
	})
```

7.2 Add a new `describe` block. Find (occurs once):
```ts
	describe("cancel", () => {
```
Replace with:
```ts
	describe("resumed session", () => {
		it("waits for the resume ask instead of answering the replayed completion ask", async () => {
			const h = startHarness({ resumingSession: true })
			// The saved chat is shown first and ends on the old completion ask;
			// the resumed task has not asked its resume question yet.
			h.host.client.setAsk("completion_result")
			h.send({ command: "message", requestId: "m1", prompt: "marker" })
			await new Promise((resolve) => setTimeout(resolve, 250))

			// Answering now would be lost: TaskAskSay.ask() clears it.
			expect(h.host.sendToExtension).not.toHaveBeenCalled()
			expect(h.controls().some((c) => c.requestId === "m1")).toBe(false)

			h.host.client.setAsk("resume_completed_task")
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			expect(h.host.sendToExtension).toHaveBeenCalledTimes(1)
			expect(h.host.sendToExtension).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "marker",
				images: undefined,
			})
			expect(h.controls().at(-1)).toMatchObject({ code: "responded" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("waits only for the first message", async () => {
			const h = startHarness({ resumingSession: true })
			h.host.client.setAsk("resume_task")
			h.send({ command: "message", requestId: "m1", prompt: "first" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			// The task finished again: a later message answers its completion ask at once.
			h.host.client.setAsk("completion_result")
			h.send({ command: "message", requestId: "m2", prompt: "second" })
			await h.waitForControl({ subtype: "done", requestId: "m2" })

			expect(h.host.sendToExtension).toHaveBeenLastCalledWith(
				expect.objectContaining({ type: "askResponse", text: "second" }),
			)
			expect(h.controls().at(-1)).toMatchObject({ requestId: "m2", code: "responded" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("answers a replayed completion ask at once when the stream did not resume a session", async () => {
			const h = startHarness()
			h.host.client.setAsk("completion_result")
			h.send({ command: "message", requestId: "m1", prompt: "more" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			expect(h.host.sendToExtension).toHaveBeenCalledWith(
				expect.objectContaining({ type: "askResponse", text: "more" }),
			)
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})
	})

	describe("cancel", () => {
```

Why the first test fails without the fix: without `resumingSession` handling the handler sees
`waitingForInput=true, currentAsk="completion_result"` and sends `askResponse` immediately, so
`expect(h.host.sendToExtension).not.toHaveBeenCalled()` fails (verified: "expected "vi.fn()" to not be called at
all, but actually been called 1 times"). The other two tests pin that the wait is one-shot and that
non-resumed streams keep the old behavior (they pass before and after; they guard against over-fixing).

No e2e / integration test is added: the existing integration case is the end-to-end proof and needs no change.

## 8. Commands to run (exact, from which directory) and the expected result

All from `/home/user/Tumble-Code` unless stated.

1. Prove the test first: apply only section 7 (test edits), then
   `cd apps/cli && npx vitest run src/commands/cli/__tests__/stdin-stream.test.ts`
   Expected: 1 failed ("waits for the resume ask instead of answering the replayed completion ask"), others pass.
2. Apply section 6, rerun the same command. Expected: all tests pass (39 in the file at the time of writing).
3. Type check: `pnpm --filter @tumble-code/cli check-types` -> exit 0.
4. Lint: `cd apps/cli && npx eslint --max-warnings=0 src/commands/cli/stdin-stream/session.ts src/commands/cli/stdin-stream/handlers/message.ts src/commands/cli/run.ts src/commands/cli/__tests__/stdin-stream.test.ts` -> no output.
5. Prettier: `npx prettier --check apps/cli/src/commands/cli/stdin-stream/session.ts apps/cli/src/commands/cli/stdin-stream/handlers/message.ts`
   -> clean. NOTE: `apps/cli/src/commands/cli/run.ts` and `apps/cli/src/commands/cli/__tests__/stdin-stream.test.ts`
   ALREADY fail `prettier --check` on origin/main (unrelated lines near 157 in run.ts, near 719 and 745 in the
   test). Do not reformat them. Check only that your lines add no new hunks:
   `npx prettier apps/cli/src/commands/cli/run.ts | diff apps/cli/src/commands/cli/run.ts -` and the same for the
   test file: the only hunks must be the pre-existing ones (the `No model given for` return in run.ts, the
   `const status = (value: unknown) =>` and `state([` blocks in the test).
6. Wider folder: `pnpm --filter @tumble-code/cli test` -> all pass.
7. Integration proof (needs the extension bundle and a ripgrep binary):
   - `pnpm turbo run bundle --filter=tumble-code`
   - If the case fails with "Could not find ripgrep binary" (the sandbox install used --ignore-scripts), copy a
     system rg into the gitignored package dir:
     `cp "$(which rg)" node_modules/.pnpm/@vscode+ripgrep@1.17.0/node_modules/@vscode/ripgrep/bin/rg`
     (check the version folder name with `ls node_modules/.pnpm | grep ripgrep`).
   - `for i in 1 2 3 4 5; do pnpm --filter @tumble-code/cli test:integration --match create-with-session-id || echo FAILED-$i; done`
     Expected: five `[PASS] create-with-session-id-resume-loads-correct-session`, about 20 s each. Before the fix
     each run hangs 180 s and prints the `[FAIL] timed out resuming session ...` line.
   - Once: `pnpm --filter @tumble-code/cli test:integration` (all cases) -> all `[PASS]`.

## 9. Do not touch / pitfalls

- Do NOT change `TaskAskSay.ask()` (clearing `askResponse`), `TaskResumption`, `TaskHistory.overwriteClineMessages`
  or the `postStateToWebview*` variants: "State delivery to the webview" and "Task control" are on the
  do-not-touch list in `docs/architecture.md`, and the extension behavior is correct for the webview.
- Do NOT change `WebviewMessage` / `ExtensionMessage` shapes (public shapes, additive only; none needed here).
- Do NOT change `bootstrapResumeForStdinStream` or its 2 s timeout: ping/shutdown must stay immediate.
- Do NOT edit the integration case file; its comment about queued messages without a requestId stays valid for
  other timings and the case assertions already accept the fixed flow.
- Keep the post-cancel behavior identical: same 8 s timeout, same flag (`awaitingPostCancelRecovery`). The
  existing test "waits for the reloaded task before routing the next message" must still pass unchanged.
- The unit tests poll real timers (100 ms poll in the handler, `vi.waitFor` default 1 s). Do not switch them to
  fake timers.
- Known flaky elsewhere: F2 (Windows `TaskHistoryStore` lock count test). Unrelated; do not touch.
- `.changeset/config.json` ignores `@tumble-code/cli`; CLI user-facing changesets in this repo name
  `"tumble-code": patch` (see `.changeset/cli-allow-mode-approves-mcp.md`).

## 10. Acceptance checklist (checkboxes)

- [ ] `StdinStreamModeOptions.resumingSession` added; `StdinStreamSession.awaitingResumeAsk` set from it.
- [ ] `handleMessageCommand` waits (max 30 s) for `resume_task` / `resume_completed_task` on the first message of a
      resumed session, then clears the flag; post-cancel wait unchanged (8 s).
- [ ] `run.ts` passes `resumingSession: isResumeRequested`.
- [ ] `waitForPostCancelRecovery` renamed to `waitForResumeAsk(host, timeoutMs)`; no remaining references.
- [ ] Three new tests in `stdin-stream.test.ts`; the first one fails before the change and passes after.
- [ ] `check-types`, eslint, `@tumble-code/cli test` pass; prettier adds no new hunks.
- [ ] Integration case passes 5 of 5 locally; full integration suite passes.
- [ ] Changeset and `ai_plans` note added.

## 11. Commit, changeset and PR text

Commit title:
`fix(cli): wait for the resume ask before answering on a resumed stream session (F1)`

Commit body:
```
A stream session started with --session-id or --continue shows the saved
chat first. For a finished task it ends on the old completion_result ask,
which the CLI took for a live ask: the first message was sent as an
askResponse at once. The resumed task had not asked its resume question yet,
and TaskAskSay.ask() clears any earlier answer when it asks, so the message
was lost and the task waited forever.

The first message of a resumed session now waits (up to 30 s) for the
resume_task / resume_completed_task ask, using the same check as the wait
after a cancel. Fixes the flaky create-with-session-id-resume-loads-correct-session
integration case.
```
End the message with the attribution lines required by the session.

`.changeset/cli-stream-resume-waits-for-resume-ask.md`:
```
---
"tumble-code": patch
---

The CLI stream mode (`--stdin-prompt-stream`) no longer loses the first message after resuming a session with `--session-id` or `--continue`. The message was sent to the finished task's old completion question before the resumed task was ready, so it was dropped and the session hung. The CLI now waits for the resumed task's question first.
```

`ai_plans/2026-09-27_f1-cli-stream-resume-first-message.md` (use the actual date of the work):
```
# F1: first message lost on a resumed CLI stream session

## Problem

`create-with-session-id-resume-loads-correct-session` failed on most CI runs. With `--stdin-prompt-stream
--session-id`, `TaskHistory.overwriteClineMessages` posts the saved chat (ending on the old `completion_result`
ask) before `TaskResumption` asks `resume_completed_task`. The CLI treated the replayed ask as live and sent the
first message as an `askResponse`; `TaskAskSay.ask()` then cleared it when it added the resume ask, and the
task waited forever.

## Change

- `StdinStreamModeOptions.resumingSession` (set from `isResumeRequested` in `run.ts`).
- `handleMessageCommand` waits up to 30 s for `resume_task` / `resume_completed_task` before routing the first
  message of a resumed session (same check as the post-cancel wait, now `waitForResumeAsk(host, timeoutMs)`).

## Tests

- `apps/cli/src/commands/cli/__tests__/stdin-stream.test.ts`, "resumed session": waits instead of answering the
  replayed completion ask; waits only once; non-resumed streams unchanged.
- The integration case passes repeatedly (was failing about every run locally).
```

PR body outline:
- Summary: root cause (steps 2-4 of section 5 in two sentences), the fix, why CLI layer.
- Evidence: failing CI message; local runs before (4/4 fail) and after (N/N pass).
- Tests: the three unit tests; integration case.
- Risk: only resumed stream sessions; first message may wait up to the resume ask (about 4 s locally, max 30 s).
- End with the PR attribution lines required by the session.

## 12. If stuck

- If the new first test still fails after the change: check that `startHarness` passes `resumingSession` into
  `runStdinStreamMode` and that the session constructor destructures it. Report the failing assertion.
- If the integration case still times out after the fix, the hypothesis is wrong for that run. Add TEMPORARY
  logging (do not commit):
  - `apps/cli/src/commands/cli/stdin-stream/handlers/message.ts`, at the top of `handleMessageCommand` and right
    before `host.sendToExtension`: `process.stderr.write(\`[F1] message ask=${host.client.getCurrentAsk()} waiting=${host.isWaitingForInput()} t=${Date.now()}\n\`)`
    (the case forwards the CLI's stderr to its own output).
  - `src/core/task/TaskAskSay.ts`: in `handleWebviewAskResponse` log `askResponse`, `this.access.lastMessageTs`,
    `Date.now()`; in `ask()` just before `await pWaitFor(` log `type`, `askTs`, `this.access.askResponse`.
    Use `console.error("[F1] ...")`. Rebuild the bundle (`pnpm turbo run bundle --filter=tumble-code`) after
    extension edits.
  - Rerun `pnpm --filter @tumble-code/cli test:integration --match create-with-session-id` a few times.
  - Look for: (a) `handleWebviewAskResponse` logged BEFORE the `resume_completed_task` ask logs -> answer still
    early (check that the wait ran and saw `resume_*`); (b) no `handleWebviewAskResponse` at all -> the answer was
    dropped by `getCurrentTask()` returning undefined or a different Task (log `provider.getCurrentTask()?.taskId`
    in the `askResponse` handler in `src/core/webview/messageHandlers/taskLifecycle.ts`); (c) the resume ask never
    appears -> resumption threw (look for `resumeTaskFromHistory failed` in stderr).
  - Remove all `[F1]` logging before committing.
- If a reviewer insists on an extension-side fix instead: stop and report; changing `TaskAskSay.ask()` needs a
  dedicated item (do-not-touch list).
