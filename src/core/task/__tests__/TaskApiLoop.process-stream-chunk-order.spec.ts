// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.process-stream-chunk-order.spec.ts

// F3: processStream used to read the NEXT chunk before processing the current one (a leftover
// from the manual-iterator rewrite in #6122, whose background usage drain wanted the captured
// look-ahead item). Every chunk sat unread in a local variable until the next one arrived, so
// the user saw each piece of text one chunk late — the last piece only when the stream ended
// (or, on a stalled connection, only after the R5 idle timeout fired).

import { TaskApiLoop } from "../TaskApiLoop"
import { logger } from "../../../utils/logging"

/**
 * A stream whose next() calls only resolve when the test pushes a result.
 * Every read and every processed chunk is appended to `log` at the moment it
 * happens, so the spec can assert the exact read/process interleaving.
 */
class ControlledStream {
	readonly log: string[] = []
	private parked: Array<(result: IteratorResult<any>) => void> = []

	next(): Promise<IteratorResult<any>> {
		this.log.push(`read#${this.log.filter((e) => e.startsWith("read#")).length + 1}`)
		return new Promise((resolve) => this.parked.push(resolve))
	}

	/** Resolve the oldest pending read. */
	push(value: any, done = false) {
		this.parked.shift()?.({ done, value })
	}

	[Symbol.asyncIterator]() {
		return this
	}
}

function makeAccess(streamProcessor: any) {
	return {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		streamProcessor,
	} as any
}

async function runProcessStream(stream: AsyncIterable<any>, streamProcessor: any) {
	const access = makeAccess(streamProcessor)
	const loop = new TaskApiLoop(access)
	vi.spyOn(loop as any, "handleBackgroundUsageDrain").mockResolvedValue(undefined)
	vi.spyOn(loop as any, "finalizeStreamAndProcessResults").mockResolvedValue("return_false")
	const result = await (loop as any).processStream(stream, vi.fn(), vi.fn(), 0, {}, { userContent: [] }, [], [])
	return { access, result }
}

describe("TaskApiLoop.processStream chunk order (F3)", () => {
	beforeEach(() => {
		vi.spyOn(logger, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("processes each chunk before reading the next one", async () => {
		const stream = new ControlledStream()
		const streamProcessor = {
			processChunk: (chunk: any) => stream.log.push(`process:${chunk.text}`),
		}

		const promise = runProcessStream(stream as any, streamProcessor)

		// Chunk "a" must be processed while the read that would fetch "b" is
		// still pending. Before F3 the loop was blocked inside read#2 and
		// "a" sat unread in a local variable.
		stream.push({ type: "text", text: "a" })
		await vi.waitFor(() => expect(stream.log).toContain("process:a"))
		expect(stream.log).toEqual(["read#1", "process:a", "read#2"])

		stream.push({ type: "text", text: "b" })
		await vi.waitFor(() => expect(stream.log).toContain("process:b"))
		expect(stream.log).toEqual(["read#1", "process:a", "read#2", "process:b", "read#3"])

		// Before F3 the log was read#1, read#2, process:a, read#3, process:b —
		// each chunk one read late.

		stream.push(undefined, true)
		const { result } = await promise
		expect(result).toBe("return_false")
	})

	it("processes the last chunk immediately, without waiting for the stream to end", async () => {
		const stream = new ControlledStream()
		const processed: any[] = []
		const streamProcessor = {
			processChunk: (chunk: any) => processed.push(chunk),
		}

		const promise = runProcessStream(stream as any, streamProcessor)

		// The stream delivers one text chunk and then goes silent (a stalled
		// connection). The chunk must already be processed while the next read
		// is still pending — before F3 it stayed buffered until the loop read
		// the end-of-stream result, i.e. the user never saw it until the
		// stream ended or the R5 idle timeout fired.
		stream.push({ type: "text", text: "final" })
		await vi.waitFor(() => expect(processed).toEqual([{ type: "text", text: "final" }]))
		expect(stream.log).toEqual(["read#1", "read#2"]) // read#2 still pending

		stream.push(undefined, true)
		const { result } = await promise
		expect(result).toBe("return_false")
	})

	it("does not issue an extra iterator.next() after a break condition fires", async () => {
		// didAlreadyUseTool is set while processing a chunk; the loop must break
		// without paying for one more read whose result it would throw away.
		let reads = 0
		async function* singleChunkStream() {
			reads++
			yield { type: "text" as const, text: "before tool" }
			reads++
			yield { type: "text" as const, text: "never processed" }
			reads++
		}
		const appended: string[] = []
		const streamProcessor = {
			processChunk: vi.fn(),
			appendAssistantMessage: (text: string) => appended.push(text),
		}
		const access = makeAccess(streamProcessor)
		access.didAlreadyUseTool = false
		const loop = new TaskApiLoop(access)
		vi.spyOn(loop as any, "handleBackgroundUsageDrain").mockResolvedValue(undefined)
		vi.spyOn(loop as any, "finalizeStreamAndProcessResults").mockResolvedValue("return_false")

		// Processing the chunk sets the flag, like a tool result does.
		streamProcessor.processChunk.mockImplementation(() => {
			access.didAlreadyUseTool = true
		})

		const result = await (loop as any).processStream(
			singleChunkStream(),
			vi.fn(),
			vi.fn(),
			0,
			{},
			{ userContent: [] },
			[],
			[],
		)

		expect(result).toBe("return_false")
		expect(streamProcessor.processChunk).toHaveBeenCalledTimes(1)
		expect(appended).toContain(
			"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]",
		)
		// Before F3 the loop read ahead (2 reads); now one read per processed chunk.
		expect(reads).toBe(1)
	})
})
