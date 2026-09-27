// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.stream-idle-timeout.spec.ts

// R5: a stream that goes silent for longer than the API request timeout is treated as failed. The provider
// SDKs only time out the wait for the response headers (or, like @google/genai, the whole response), so a
// connection that dropped mid-answer used to wait until the user pressed Stop.

vi.mock("../../../api/providers/utils/timeout-config", () => ({
	getApiRequestTimeout: () => 50,
	CONTROL_REQUEST_TIMEOUT_MS: 30_000,
}))

import { TaskApiLoop, StreamIdleTimeoutError, raceNextChunkWithAbort } from "../TaskApiLoop"

function silentIterator(): AsyncIterator<string> {
	return { next: () => new Promise(() => {}) }
}

describe("raceNextChunkWithAbort idle timeout (R5)", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("rejects with StreamIdleTimeoutError when no chunk arrives in time", async () => {
		vi.useFakeTimers()
		const result = raceNextChunkWithAbort(silentIterator(), new AbortController().signal, 1_000)
		const assertion = expect(result).rejects.toBeInstanceOf(StreamIdleTimeoutError)

		await vi.advanceTimersByTimeAsync(1_000)
		await assertion
	})

	it("clears its timer when the chunk arrives", async () => {
		vi.useFakeTimers()
		const iterator: AsyncIterator<string> = { next: async () => ({ done: false, value: "chunk" }) }

		await expect(raceNextChunkWithAbort(iterator, new AbortController().signal, 1_000)).resolves.toEqual({
			done: false,
			value: "chunk",
		})
		expect(vi.getTimerCount()).toBe(0)
	})

	it("waits without limit when no idle timeout is given", async () => {
		vi.useFakeTimers()
		let settled = false
		void raceNextChunkWithAbort(silentIterator(), new AbortController().signal).finally(() => {
			settled = true
		})

		await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
		expect(settled).toBe(false)
	})
})

describe("TaskApiLoop.processStream idle timeout (R5)", () => {
	it("closes the request and hands a StreamIdleTimeoutError to the stream-failure path", async () => {
		const controller = new AbortController()
		const access: any = {
			taskId: "task-1",
			instanceId: "inst-1",
			abort: false,
			abandoned: false,
			currentRequestAbortController: controller,
			streamProcessor: { processChunk: vi.fn() },
		}
		const loop = new TaskApiLoop(access)
		const handleStreamError = vi.spyOn(loop as any, "handleStreamError").mockResolvedValue("return_true")

		async function* stalledStream() {
			yield { type: "text" as const, text: "partial" }
			await new Promise(() => {}) // the connection dropped: nothing more ever arrives
		}

		const result = await (loop as any).processStream(
			stalledStream(),
			vi.fn(),
			vi.fn(),
			0,
			{},
			{ userContent: [] },
			[],
			[],
		)

		expect(result).toBe("return_true")
		expect(handleStreamError).toHaveBeenCalledTimes(1)
		expect(handleStreamError.mock.calls[0][0]).toBeInstanceOf(StreamIdleTimeoutError)
		expect(controller.signal.aborted).toBe(true)
	})
})
