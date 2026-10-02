# WP-F3: Process each stream chunk before reading the next one

Status: ready  (decision: the look-ahead is NOT needed; SAFE to process before reading, with the interrupt check
kept at the same point in time. This WP CHANGES the loop; it is not the "document and pin" variant.)
Effort: S      Risk: medium      Depends on: none
Branch name: fix/f3-stream-chunk-one-late      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

`TaskApiLoop.processStream` reads chunk N+1 before it processes chunk N, so every chunk reaches the chat only
when the following chunk (or the end of the stream) arrives. Change the loop to process a chunk first and then
read the next one. Keep everything else exactly as it is today: when the user cancels, a tool is rejected, or a
tool already ran while the loop waited, the loop stops before the chunk that arrived after that, and hands that
unprocessed item to the background usage drain, as now.

## 2. Why it matters (user-visible effect, 2-4 sentences)

When the model pauses (thinking, or before a tool call), the last piece of text or the finished tool call stays
invisible until the next chunk arrives. A complete tool call is also executed one chunk late. When the stream
dies (idle timeout R5, network error), the last chunk that did arrive is never shown at all, because the loop
was waiting for the next one when the error came.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`, `docs/architecture.md` (section "From a provider stream to a chat row" and "Do not touch": the
  abort ordering and `cancelTask` are listed; this WP keeps the abort branch's code unchanged).
- `docs/03-task-agent-loop.md`, sequence diagram "loop each chunk (raced against abort)" and the paragraph that
  starts "The stream loop races every `iterator.next()`".
- `src/core/task/TaskApiLoop.ts`:
  - `processStream` (the loop you change, near line 710)
  - `nextChunkWithAbort` (local closure inside `processStream`)
  - `raceNextChunkWithAbort` and `StreamIdleTimeoutError` (near line 251)
  - `handleBackgroundUsageDrain` (near line 799; receives `iterator` and `item`)
  - `attemptApiRequest` (near line 1440: `yield firstChunk.value` then `this.access.isWaitingForFirstChunk = false`,
    then `yield* iterator`)
- `src/core/task/TaskStreamProcessor.ts`:
  - `processChunk` (near line 233; synchronous, returns `void`)
  - `createBackgroundUsageDrain` (near line 951; the drain loop `let item = currentItem; while (item && !item.done)`)
  - `appendAssistantMessage` (near line 155)
- `src/core/assistant-message/presentAssistantMessage.ts` (sets `didAlreadyUseTool = true` near line 280, always
  after an `await`) and `src/core/assistant-message/toolCallbacks.ts` (sets `didRejectTool = true` near line 220).
- Existing tests that drive the loop: `src/core/task/__tests__/TaskApiLoop.stream-idle-timeout.spec.ts`
  ("TaskApiLoop.processStream idle timeout (R5)"), `TaskStreamProcessor.usage-drain.spec.ts`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/core/task/TaskApiLoop.ts`, `processStream`, the closure (near line 729):

```ts
		const idleTimeoutMs = getApiRequestTimeout()
		const nextChunkWithAbort = async () => {
			const controller = this.access.currentRequestAbortController
			if (!controller) {
				return iterator.next()
			}
			try {
				return await raceNextChunkWithAbort(iterator, controller.signal, idleTimeoutMs)
			} catch (error) {
				if (error instanceof StreamIdleTimeoutError) {
					// Close the HTTP request too; the error then takes the normal stream-failure path.
					controller.abort()
				}
				throw error
			}
		}
```

`src/core/task/TaskApiLoop.ts`, `processStream`, the loop (near line 745); this is the text step 1 replaces:

```ts
		try {
			let item = await nextChunkWithAbort()
			while (!item.done) {
				const chunk = item.value
				item = await nextChunkWithAbort()
				if (!chunk) {
					continue
				}

				this.access.streamProcessor.processChunk(chunk, streamModelInfo)

				if (this.access.abort) {
					console.log(`aborting stream, this.abandoned = ${this.access.abandoned}`)

					if (!this.access.abandoned) {
						await abortStream("user_cancelled")
					}
					break
				}

				if (this.access.didRejectTool) {
					this.access.streamProcessor.appendAssistantMessage("\n\n[Response interrupted by user feedback]")
					break
				}

				if (this.access.didAlreadyUseTool) {
					this.access.streamProcessor.appendAssistantMessage(
						"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]",
					)
					break
				}
			}
```

followed (unchanged) by:

```ts

			// Handle background usage drain
			await this.handleBackgroundUsageDrain(lastApiReqIndex, streamModelInfo, iterator, item, updateApiReqMsg)

			// Check for abort after stream
			if (this.access.abort || this.access.abandoned) {
				throw new Error(
					`[RooCode#recursivelyMakeRooRequests] task ${this.access.taskId}.${this.access.instanceId} aborted`,
				)
			}

			// Finalize stream and process results
			return await this.finalizeStreamAndProcessResults(currentItem, currentUserContent, stack, abortStream)
		} catch (error) {
			// Handle stream errors
			return this.handleStreamError(error, abortStream, currentItem, currentUserContent, stack)
		}
```

`src/core/task/TaskStreamProcessor.ts`, `createBackgroundUsageDrain`, the drain loop (near line 1073):

```ts
				// Use the same iterator that the main loop was using
				// Start from the current item state captured when the main loop ended
				let item = currentItem
				while (item && !item.done) {
					...timeout check...
					const chunk = item.value
					item = await iterator.next()
					chunkCount++

					if (chunk && chunk.type === "usage") {
						usageFound = true
						bgInputTokens += chunk.inputTokens
						...
```

## 5. Root cause / analysis

VERIFIED (read and ran):

1. History: the clone is shallow (50 commits, `git rev-parse --is-shallow-repository` prints `true`).
   `git log -S "item = await nextChunkWithAbort" -- src/core/task` only finds the grafted boundary commit
   `f9b2635` (zod 4, where every file appears as added), so git cannot say why the look-ahead was written. The
   repo's plans (`ai_plans/refactor-task-ts-04-task-api-loop.md`) say the loop was extracted from `Task.ts`
   "as-is"; `ai_plans/2026-07-11_codebase-review-findings-register.md` AP-5 only touched the abort listener. No
   plan or comment states that the look-ahead is intentional.
2. What the look-ahead is actually used for: only the hand-off to the usage drain. On a `break`, `item` is the
   already-read NEXT item, not yet processed; the drain starts from it (`let item = currentItem`), counts it if it
   is a `usage` chunk, and keeps reading the same iterator. On a normal end `item` is `{ done: true }` and the drain
   does nothing. Nothing else reads `item`. `processChunk` is synchronous and does not need to know whether a
   chunk is the last one (finish handling happens in `finalizeStreamAndProcessResults`).
3. When the flags change: `didAlreadyUseTool`, `didRejectTool` and `abort` are set only after an `await` in
   other async code (tool execution, approval asks, `abortTask`), never synchronously inside `processChunk`. So
   they can only change while the loop awaits the next chunk. In the old loop the check runs right after that
   await (with the synchronous `processChunk` of the older chunk in between). The new loop runs the same check
   at the same moment: right after the await, BEFORE processing the newly arrived chunk. Result: the set of
   processed chunks and the item handed to the drain are identical in every interrupt case; only the moment a
   chunk is processed moves earlier (before the read instead of after it).
4. The new loop checks the flags only after a non-empty chunk was processed (`checkInterrupts`), exactly like the
   old loop (which ran the check once per processed chunk, and `continue`d past empty chunks without a check).
   A flag that becomes true during the FINAL read (the one that returns `done`) is still acted on (the old loop
   processed the last chunk and then checked); the new loop checks at the top of the next pass before looking at
   `item.done`.
5. Break paths and the drain: abort (with and without `abandoned`), `didRejectTool`, `didAlreadyUseTool` all
   break with `item` = the unprocessed next item; natural end gives `{ done: true }`. The call to
   `handleBackgroundUsageDrain(..., iterator, item, ...)` is unchanged.
6. `isWaitingForFirstChunk`: `attemptApiRequest` sets it to `false` when the consumer asks for the second item.
   In the new loop that request happens synchronously right after `processChunk` of the first chunk (no `await`
   in between), so `cancelTask` (which polls this flag on a timer) sees the same value as before. Do not move that
   line.
7. Existing tests: nothing pins the one-chunk-late order. `grep -rn "processStream\|nextChunk\|one chunk"
   src/core/task/__tests__` finds only `TaskApiLoop.stream-idle-timeout.spec.ts` (passes with the new loop; it
   does not assert on `processChunk`), `TaskApiLoop.abort-listener.spec.ts` (tests `raceNextChunkWithAbort`
   only) and comments in `TaskApiLoop.no-auto-retry-auth-errors.spec.ts`.
8. I applied the exact new loop from step 1 to a copy of `TaskApiLoop.ts` (loaded through a vitest plugin, no
   tracked file changed) and ran: the new spec (9 passed; on the current code 3 of the 9 fail, see section 7),
   `core/task core/assistant-message core/webview` (130 files, 1781 tests passed, same as the current code), and
   the whole `src` suite (609 files passed, 4 skipped; 9788 tests passed, 37 skipped). tsc, eslint and prettier
   were clean on the new spec and on the patched file.

HYPOTHESIS (low risk, cannot be unit-tested): the visible streaming in the real extension and CLI looks the same
except that text appears one chunk earlier. Confirm by hand if you can (section 8, step 8). If a streaming UI test
outside `src/` (webview-ui, apps/cli) fails after the change, that is unexpected: stop and report (section 12).

Behavior differences that remain (intended):
- A chunk is processed before the loop waits for the next one (the fix).
- If the read after chunk N throws (user cancel race "Request cancelled by user", idle timeout, network error),
  chunk N has now been processed before the error goes to `handleStreamError`. Before, chunk N was dropped. This
  is the "last text before a stall is never shown" bug; it also means a tool call completed by chunk N is
  presented instead of silently lost. The abort check itself is unchanged.

## 6. Step-by-step changes

Step 1. File `src/core/task/TaskApiLoop.ts`, method `processStream`. Find this exact text (unique; it starts with
`try {` directly followed by `let item = await nextChunkWithAbort()` and ends with the closing brace of the
`while` loop, right before the blank line and `// Handle background usage drain`):

```ts
		try {
			let item = await nextChunkWithAbort()
			while (!item.done) {
				const chunk = item.value
				item = await nextChunkWithAbort()
				if (!chunk) {
					continue
				}

				this.access.streamProcessor.processChunk(chunk, streamModelInfo)

				if (this.access.abort) {
					console.log(`aborting stream, this.abandoned = ${this.access.abandoned}`)

					if (!this.access.abandoned) {
						await abortStream("user_cancelled")
					}
					break
				}

				if (this.access.didRejectTool) {
					this.access.streamProcessor.appendAssistantMessage("\n\n[Response interrupted by user feedback]")
					break
				}

				if (this.access.didAlreadyUseTool) {
					this.access.streamProcessor.appendAssistantMessage(
						"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]",
					)
					break
				}
			}
```

Replace it with exactly:

```ts
		try {
			// F3: each chunk is processed BEFORE the next one is read, so it is shown as soon as it arrives. (The
			// loop used to read ahead, which showed every chunk only when the following one arrived.)
			// `checkInterrupts` is true after a chunk was processed. The next pass then checks, before it
			// processes anything else, whether the user cancelled, rejected a tool or a tool already ran while
			// the next chunk was awaited. On a break, `item` is that next item, not yet processed, and goes to
			// the background usage drain below, exactly as with the read-ahead loop.
			let item = await nextChunkWithAbort()
			let checkInterrupts = false
			while (true) {
				if (checkInterrupts) {
					checkInterrupts = false

					if (this.access.abort) {
						console.log(`aborting stream, this.abandoned = ${this.access.abandoned}`)

						if (!this.access.abandoned) {
							await abortStream("user_cancelled")
						}
						break
					}

					if (this.access.didRejectTool) {
						this.access.streamProcessor.appendAssistantMessage(
							"\n\n[Response interrupted by user feedback]",
						)
						break
					}

					if (this.access.didAlreadyUseTool) {
						this.access.streamProcessor.appendAssistantMessage(
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]",
						)
						break
					}
				}

				if (item.done) {
					break
				}

				const chunk = item.value
				if (chunk) {
					this.access.streamProcessor.processChunk(chunk, streamModelInfo)
					checkInterrupts = true
				}

				item = await nextChunkWithAbort()
			}
```

Do not change anything else in `processStream`: the `nextChunkWithAbort` closure, the
`await this.handleBackgroundUsageDrain(lastApiReqIndex, streamModelInfo, iterator, item, updateApiReqMsg)` call,
the abort check after it, `finalizeStreamAndProcessResults` and the `catch` stay as they are. The three message
strings must stay byte-for-byte identical (other code and tests look for them).

Step 2. File `docs/03-task-agent-loop.md`. Find these two lines (unique):

```
The stream loop races every `iterator.next()` against the abort signal (`raceNextChunkWithAbort`), so a stalled
provider does not block a cancel. After the stream, the wait for the tool results
```

Replace them with these three lines (keep the rest of the paragraph as it is):

```
The stream loop processes each chunk before it reads the next one, so a chunk is on screen as soon as it
arrives. It races every `iterator.next()` against the abort signal (`raceNextChunkWithAbort`), so a stalled
provider does not block a cancel. After the stream, the wait for the tool results
```

`docs/architecture.md` needs no change (no boundary moves).

Step 3. Create the new spec file from section 7.

Step 4. Create the `ai_plans` note from section 11.

## 7. Tests to add or change

New file: `src/core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts` (package-local unit test of
`processStream` with a hand-driven iterator; the lowest layer that shows the order; no webview or e2e test).
Full content:

```ts
// cd src && npx vitest run core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts

// F3: processStream used to read the next chunk before it processed the current one, so every chunk (and the
// last piece of text before a pause) was shown only when the following chunk arrived. These tests pin the new
// order (process, then read) and the unchanged interrupt semantics: a cancel, a rejected tool or a finished
// tool that happens while the loop waits for a chunk stops the stream BEFORE that chunk is processed, and the
// unprocessed item goes to the background usage drain.

vi.mock("../../../api/providers/utils/timeout-config", () => ({
	getApiRequestTimeout: () => 0,
	CONTROL_REQUEST_TIMEOUT_MS: 30_000,
}))

import { TaskApiLoop } from "../TaskApiLoop"

type Chunk = { type: "text"; text: string }

const text = (value: string): Chunk => ({ type: "text", text: value })

/**
 * An iterator whose next() calls are answered by the test. `requests` counts the calls; each call waits for
 * the test to call `respond` (or `fail`) for it.
 */
function controlledIterator() {
	const pending: Array<{ resolve: (r: IteratorResult<Chunk>) => void; reject: (e: unknown) => void }> = []
	let requests = 0
	const iterator = {
		next: () => {
			requests++
			return new Promise<IteratorResult<Chunk>>((resolve, reject) => pending.push({ resolve, reject }))
		},
		return: async () => ({ done: true, value: undefined }),
		throw: async (e: unknown) => {
			throw e
		},
		[Symbol.asyncIterator]() {
			return this
		},
	} as unknown as AsyncGenerator<Chunk>
	return {
		iterator,
		requests: () => requests,
		respond: (result: IteratorResult<Chunk>) => pending.shift()!.resolve(result),
		fail: (error: unknown) => pending.shift()!.reject(error),
	}
}

function makeLoop(overrides: Record<string, unknown> = {}) {
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		currentRequestAbortController: undefined,
		streamProcessor: { processChunk: vi.fn(), appendAssistantMessage: vi.fn() },
		...overrides,
	}
	const loop = new TaskApiLoop(access)
	const drain = vi.spyOn(loop as any, "handleBackgroundUsageDrain").mockResolvedValue(undefined)
	const finalize = vi.spyOn(loop as any, "finalizeStreamAndProcessResults").mockResolvedValue("continue")
	const handleStreamError = vi.spyOn(loop as any, "handleStreamError").mockResolvedValue("return_true")
	const abortStream = vi.fn().mockResolvedValue(undefined)
	return { access, loop, drain, finalize, handleStreamError, abortStream }
}

function runProcessStream(loop: TaskApiLoop, stream: AsyncGenerator<Chunk>, abortStream: unknown) {
	return (loop as any).processStream(stream, abortStream, vi.fn(), 0, {}, { userContent: [] }, [], []) as Promise<
		"continue" | "return_true" | "return_false"
	>
}

const INTERRUPTED_BY_FEEDBACK = "\n\n[Response interrupted by user feedback]"
const INTERRUPTED_BY_TOOL =
	"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"

describe("TaskApiLoop.processStream chunk order (F3)", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("processes a chunk before it asks the stream for the next one", async () => {
		const { loop, access, abortStream } = makeLoop()
		const source = controlledIterator()
		const result = runProcessStream(loop, source.iterator, abortStream)

		source.respond({ done: false, value: text("first") })
		await vi.waitFor(() => expect(source.requests()).toBe(2))
		// The second chunk has not arrived yet, but the first is already shown.
		expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
		expect(access.streamProcessor.processChunk).toHaveBeenCalledWith(text("first"), {})

		source.respond({ done: false, value: text("second") })
		await vi.waitFor(() => expect(source.requests()).toBe(3))
		expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(2)
		expect(access.streamProcessor.processChunk).toHaveBeenLastCalledWith(text("second"), {})

		source.respond({ done: true, value: undefined })
		await expect(result).resolves.toBe("continue")
		expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(2)
	})

	it("shows the last chunk even when the read after it fails", async () => {
		const { loop, access, abortStream, handleStreamError } = makeLoop()
		const source = controlledIterator()
		const result = runProcessStream(loop, source.iterator, abortStream)

		source.respond({ done: false, value: text("partial") })
		await vi.waitFor(() => expect(source.requests()).toBe(2))
		const failure = new Error("connection dropped")
		source.fail(failure)

		await expect(result).resolves.toBe("return_true")
		expect(access.streamProcessor.processChunk).toHaveBeenCalledWith(text("partial"), {})
		expect(handleStreamError).toHaveBeenCalledTimes(1)
		expect(handleStreamError.mock.calls[0][0]).toBe(failure)
	})

	it("hands the usage drain a done item when the stream ends normally", async () => {
		const { loop, access, abortStream, drain } = makeLoop()
		const source = controlledIterator()
		const result = runProcessStream(loop, source.iterator, abortStream)

		source.respond({ done: false, value: text("only") })
		await vi.waitFor(() => expect(source.requests()).toBe(2))
		source.respond({ done: true, value: undefined })

		await expect(result).resolves.toBe("continue")
		expect(drain).toHaveBeenCalledTimes(1)
		expect(drain.mock.calls[0][2]).toBe(source.iterator)
		expect(drain.mock.calls[0][3]).toEqual({ done: true, value: undefined })
		expect(access.streamProcessor.appendAssistantMessage).not.toHaveBeenCalled()
	})

	describe("an interrupt that happens while the next chunk is awaited", () => {
		it("didRejectTool: stops before that chunk and hands it to the usage drain unprocessed", async () => {
			const { loop, access, abortStream, drain, finalize } = makeLoop()
			const source = controlledIterator()
			const result = runProcessStream(loop, source.iterator, abortStream)

			source.respond({ done: false, value: text("A") })
			await vi.waitFor(() => expect(source.requests()).toBe(2))
			access.didRejectTool = true
			source.respond({ done: false, value: text("B") })

			await expect(result).resolves.toBe("continue")
			expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
			expect(access.streamProcessor.processChunk).toHaveBeenCalledWith(text("A"), {})
			expect(access.streamProcessor.appendAssistantMessage).toHaveBeenCalledWith(INTERRUPTED_BY_FEEDBACK)
			expect(source.requests()).toBe(2)
			expect(drain).toHaveBeenCalledTimes(1)
			expect(drain.mock.calls[0][2]).toBe(source.iterator)
			expect(drain.mock.calls[0][3]).toEqual({ done: false, value: text("B") })
			expect(finalize).toHaveBeenCalledTimes(1)
		})

		it("didAlreadyUseTool: stops before that chunk and hands it to the usage drain unprocessed", async () => {
			const { loop, access, abortStream, drain } = makeLoop()
			const source = controlledIterator()
			const result = runProcessStream(loop, source.iterator, abortStream)

			source.respond({ done: false, value: text("A") })
			await vi.waitFor(() => expect(source.requests()).toBe(2))
			access.didAlreadyUseTool = true
			source.respond({ done: false, value: text("B") })

			await expect(result).resolves.toBe("continue")
			expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
			expect(access.streamProcessor.appendAssistantMessage).toHaveBeenCalledWith(INTERRUPTED_BY_TOOL)
			expect(source.requests()).toBe(2)
			expect(drain.mock.calls[0][3]).toEqual({ done: false, value: text("B") })
		})

		it("didAlreadyUseTool set during the final read: still appends the note, drain gets the done item", async () => {
			const { loop, access, abortStream, drain } = makeLoop()
			const source = controlledIterator()
			const result = runProcessStream(loop, source.iterator, abortStream)

			source.respond({ done: false, value: text("A") })
			await vi.waitFor(() => expect(source.requests()).toBe(2))
			access.didAlreadyUseTool = true
			source.respond({ done: true, value: undefined })

			await expect(result).resolves.toBe("continue")
			expect(access.streamProcessor.appendAssistantMessage).toHaveBeenCalledTimes(1)
			expect(access.streamProcessor.appendAssistantMessage).toHaveBeenCalledWith(INTERRUPTED_BY_TOOL)
			expect(drain.mock.calls[0][3]).toEqual({ done: true, value: undefined })
		})

		it("abort: calls abortStream, does not process that chunk and hands it to the usage drain", async () => {
			const { loop, access, abortStream, drain, handleStreamError } = makeLoop()
			const source = controlledIterator()
			const result = runProcessStream(loop, source.iterator, abortStream)

			source.respond({ done: false, value: text("A") })
			await vi.waitFor(() => expect(source.requests()).toBe(2))
			access.abort = true
			source.respond({ done: false, value: text("B") })

			await expect(result).resolves.toBe("return_true")
			expect(abortStream).toHaveBeenCalledWith("user_cancelled")
			expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
			expect(source.requests()).toBe(2)
			expect(drain.mock.calls[0][3]).toEqual({ done: false, value: text("B") })
			// The loop throws "... aborted" after the drain; the stream-error path handles it.
			expect(handleStreamError).toHaveBeenCalledTimes(1)
			expect(String((handleStreamError.mock.calls[0][0] as Error).message)).toContain("aborted")
		})

		it("abort of an abandoned task: does not call abortStream", async () => {
			const { loop, access, abortStream } = makeLoop()
			const source = controlledIterator()
			const result = runProcessStream(loop, source.iterator, abortStream)

			source.respond({ done: false, value: text("A") })
			await vi.waitFor(() => expect(source.requests()).toBe(2))
			access.abort = true
			access.abandoned = true
			source.respond({ done: false, value: text("B") })

			await expect(result).resolves.toBe("return_true")
			expect(abortStream).not.toHaveBeenCalled()
			expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
		})
	})

	it("does not check interrupts before the first chunk was processed", async () => {
		// Same as the old loop: a flag that is already set when the stream starts is only acted on after the
		// first chunk was shown.
		const { loop, access, abortStream, drain } = makeLoop({ didAlreadyUseTool: true })
		const source = controlledIterator()
		const result = runProcessStream(loop, source.iterator, abortStream)

		source.respond({ done: false, value: text("A") })
		await vi.waitFor(() => expect(source.requests()).toBe(2))
		expect(access.streamProcessor.processChunk).toHaveBeenCalledWith(text("A"), {})
		source.respond({ done: false, value: text("B") })

		await expect(result).resolves.toBe("continue")
		expect(access.streamProcessor.processChunk).toHaveBeenCalledTimes(1)
		expect(drain.mock.calls[0][3]).toEqual({ done: false, value: text("B") })
	})
})
```

What each test proves, and whether it fails on the current code (verified by running it against both):

- "processes a chunk before it asks the stream for the next one": FAILS on the current code (after the first
  chunk, `processChunk` has not been called while the second `next()` is pending). This is proof (a).
- "shows the last chunk even when the read after it fails": FAILS on the current code (`processChunk` is never
  called with "partial"). User-visible part of the bug (stalled stream).
- "does not check interrupts before the first chunk was processed": FAILS on the current code only because of the
  order assertion in the middle (`processChunk` with "A" before "B" arrives); the end state (one chunk
  processed, drain gets "B") matches the old loop.
- "hands the usage drain a done item when the stream ends normally", and the five tests under
  "an interrupt that happens while the next chunk is awaited" (didRejectTool, didAlreadyUseTool, didAlreadyUseTool
  during the final read, abort, abort of an abandoned task): PASS on both the current and the new code. They pin
  that the break paths still process the same chunks, append the same note, call `abortStream("user_cancelled")`
  only when not abandoned, do not read further from the iterator, and hand the drain the unprocessed next item
  (or the done item). This is proof (b).

The existing `TaskApiLoop.stream-idle-timeout.spec.ts` stays unchanged and keeps passing.

## 8. Commands to run (exact, from which directory) and the expected result

All from the repository's `src/` folder (`/home/user/Tumble-Code/src`):

1. Create only the spec (step 3) first, before step 1:
   `npx vitest run core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts`
   Expected: `Tests  3 failed | 6 passed (9)`; the failing ones are "processes a chunk before it asks the stream
   for the next one", "shows the last chunk even when the read after it fails", "does not check interrupts before
   the first chunk was processed".
2. Apply step 1, rerun the same command. Expected: `Tests  9 passed (9)`.
3. `npx vitest run core/task/__tests__/TaskApiLoop.stream-idle-timeout.spec.ts core/task/__tests__/TaskStreamProcessor.usage-drain.spec.ts`
   Expected: all pass.
4. Wider folders: `npx vitest run core/task core/assistant-message core/webview`
   Expected: `Test Files  131 passed (131)` (130 today plus the new file), no failures.
5. Whole extension suite: `npx vitest run` Expected: all files pass (about 610 passed, 4 skipped).
6. Type check: `npx tsc --noEmit -p .` Expected: no output, exit 0.
7. Lint and format:
   `npx eslint --max-warnings=0 core/task/TaskApiLoop.ts core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts`
   Expected: no output.
   `npx prettier --check core/task/TaskApiLoop.ts core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts ../docs/03-task-agent-loop.md`
   Expected: "All matched files use Prettier code style!" (the "Ignored unknown option" warning is normal).
8. Optional manual check (only if you can run the extension or the CLI): ask a model for a long answer with a
   tool call; the text before the tool call appears without waiting for the tool call, and Stop still stops the
   answer immediately.

## 9. Do not touch / pitfalls

- "Task control: `cancelTask` and the abort ordering" is on the do-not-touch list in `docs/architecture.md`.
  Keep the abort branch's body exactly as it is (log line, `if (!this.access.abandoned) await
  abortStream("user_cancelled")`, `break`), keep `nextChunkWithAbort` / `raceNextChunkWithAbort` unchanged, and
  keep the abort check after the drain.
- Do NOT check the interrupt flags only after `processChunk` (the obvious rewrite
  `process; check; item = await next()`): that processes one extra chunk that arrived AFTER a cancel / rejection
  / finished tool, and the "didRejectTool", "didAlreadyUseTool" and "abort" tests in the new spec fail. The check
  must run after the await and before processing the new chunk, as in step 1.
- Do NOT pass a placeholder or `undefined` to `handleBackgroundUsageDrain`; `item` must be the real unprocessed
  item on a break and the done item at the end. The drain counts a `usage` chunk in that item; processing it in
  the loop and ALSO passing it would double-count tokens.
- Do not change `createBackgroundUsageDrain` or the `handleBackgroundUsageDrain` signature
  (`TaskStreamProcessor.usage-drain.spec.ts` pins that it gets `updateApiReqMsg`, not `abortStream`).
- Do not move `this.access.isWaitingForFirstChunk = false` in `attemptApiRequest` (see section 5, point 6).
- The three message strings are matched elsewhere; copy them exactly.
- `console.log` of the abort branch is silenced in the new spec with `vi.spyOn(console, "log")`; keep
  `vi.restoreAllMocks()` in `afterEach` so the spies do not leak.
- Known flaky tests you may see and must not fix here: F1 (`cli-integration` case
  `create-with-session-id-resume-loads-correct-session`) and F2 (Windows `TaskHistoryStore` "releases per-ID lock
  tails for many unique IDs").

## 10. Acceptance checklist (checkboxes)

- [ ] `processStream` processes a chunk before calling `nextChunkWithAbort()` again; the interrupt checks run after
      the await and before processing the new chunk; `handleBackgroundUsageDrain` call unchanged.
- [ ] New spec `core/task/__tests__/TaskApiLoop.stream-chunk-order.spec.ts`: 3 of 9 fail before step 1, 9 of 9
      pass after.
- [ ] `core/task`, `core/assistant-message`, `core/webview` and the whole `src` suite pass.
- [ ] tsc, eslint, prettier clean on the changed files.
- [ ] `docs/03-task-agent-loop.md` updated (step 2).
- [ ] Changeset added (user-visible).
- [ ] `ai_plans` note added.

## 11. Commit, changeset and PR text

- Commit title: `fix(task): show each stream chunk as soon as it arrives (F3)`
- Commit body:

```
processStream read the next chunk before it processed the current one,
so every chunk reached the chat only when the following chunk arrived,
and the last chunk before a stalled or failed stream was never shown.

The loop now processes a chunk and then reads the next one. The checks
for a cancel, a rejected tool and an already used tool still run right
after each read and before the new chunk is processed, so the same
chunks are processed as before on every interrupt, and the unprocessed
item still goes to the background usage drain.
```

  End the body with the attribution lines required by the session, if any.
- `.changeset/stream-chunk-shown-on-arrival.md`:

```
---
"tumble-code": patch
---

Streamed answers no longer lag one piece behind: each piece of text or tool call appears as soon as the model sends it, and the last text before a stalled or dropped connection is still shown.
```

- `ai_plans/2026-09-27_f3-stream-chunk-one-late.md` (use the date of the commit):

```
# F3: each stream chunk was shown one chunk late

Item F3 of `2026-09-27_simplification-roadmap.md`.

## Problem

`TaskApiLoop.processStream` read chunk N+1 before it processed chunk N. Each chunk reached the chat only when the
next one arrived; a complete tool call ran one chunk late; the last chunk before an idle timeout or network error
was dropped.

## Analysis

The look-ahead was only used to hand the unprocessed next item to the background usage drain after a break. The
interrupt flags (`abort`, `didRejectTool`, `didAlreadyUseTool`) change only while the loop awaits a chunk, never
inside the synchronous `processChunk`. Git history is shallow, no plan states the look-ahead was intended.

## Change

Process, then read. The interrupt check runs after each read and before the new chunk is processed (only once a
chunk was processed, as before), so the processed chunks and the item given to the drain are the same as before
on every interrupt path.

## Tests

`TaskApiLoop.stream-chunk-order.spec.ts` (hand-driven iterator): a chunk is processed before the next `next()`
resolves; the last chunk is shown when the next read fails; didRejectTool, didAlreadyUseTool (also during the
final read) and abort (with and without abandoned) stop before the late chunk and hand it to the drain.
```

- PR body outline: Problem (one-chunk lag, dropped last chunk on stall); Analysis (look-ahead used only for the
  drain hand-off; flags only change across awaits; shallow history); Change (loop code, docs sentence); Tests (new
  spec, 3 of 9 fail before; full `src` suite green); Risk (abort ordering untouched, same processed chunks on every
  interrupt path). End with the PR attribution footer required by the session.

## 12. If stuck

- If the step 1 "find" text does not match (the loop was edited since this WP), stop and report the current loop
  code; do not merge by hand.
- If any of the six "PASS on both" tests fails after step 1, the interrupt check is in the wrong place: compare
  with step 1 exactly. If it still fails, stop and report the test name and output.
- If any existing test outside the new spec fails after step 1 (for example a webview-ui or apps/cli streaming
  test, or a Task spec asserting on `processChunk` call order), stop and report which test and its assertion;
  do not change that test to make it pass without checking with the planner, because it may encode a UI contract
  (`useScrollLifecycle`, the ChatRow height contract and the CLI Ink pipeline are on the do-not-touch list).
