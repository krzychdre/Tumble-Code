import type { ExtensionMessage } from "@roo-code/types"

import { ExtensionClient } from "../extension-client.js"
import { TranscriptReader, type TranscriptSink } from "../transcript-reader.js"
import type { TranscriptEffect, TranscriptView } from "../transcript-reducer.js"

const say = (ts: number, text: string): ExtensionMessage =>
	({ type: "messageUpdated", clineMessage: { ts, type: "say", say: "text", text, partial: false } }) as ExtensionMessage

function recordingSink(view: Partial<TranscriptView> = {}) {
	const batches: TranscriptEffect[][] = []
	const sink: TranscriptSink = {
		view: () => ({ messages: [], isLoading: false, isResumingTask: false, currentTodos: [], ...view }),
		nonInteractive: () => false,
		apply: (effects) => batches.push([...effects]),
	}
	return { sink, batches }
}

describe("TranscriptReader", () => {
	it("does nothing without a sink, and keeps no bookkeeping for those messages", () => {
		const reader = new TranscriptReader()
		reader.handleMessage(say(1, "prompt echo"))

		const { sink, batches } = recordingSink()
		reader.attach(sink)
		// Still the first text of the task: skipped as the prompt echo.
		reader.handleMessage(say(2, "prompt echo"))
		reader.handleMessage(say(3, "Hi"))

		expect(batches).toEqual([[{ type: "addMessage", message: expect.objectContaining({ id: "3", content: "Hi" }) }]])
	})

	it("sends one batch per message that changes something, and none for the rest", () => {
		const reader = new TranscriptReader()
		const { sink, batches } = recordingSink()
		reader.attach(sink)

		reader.handleMessage(say(1, "prompt echo"))
		reader.handleMessage({ type: "modes", modes: [] } as unknown as ExtensionMessage)

		expect(batches).toEqual([[{ type: "setAvailableModes", modes: [] }]])
	})

	it("stops sending after detach, and a stale detach leaves the new sink attached", () => {
		const reader = new TranscriptReader()
		const first = recordingSink()
		const second = recordingSink()

		const detachFirst = reader.attach(first.sink)
		reader.attach(second.sink)
		detachFirst()
		reader.handleMessage({ type: "modes", modes: [] } as unknown as ExtensionMessage)

		expect(first.batches).toEqual([])
		expect(second.batches).toHaveLength(1)
	})

	it("reset starts the next task from scratch", () => {
		const reader = new TranscriptReader()
		const { sink, batches } = recordingSink()
		reader.attach(sink)

		reader.handleMessage(say(1, "prompt echo"))
		reader.reset()
		// The first text after the reset is the new task's prompt echo.
		reader.handleMessage(say(2, "second prompt echo"))

		expect(batches).toEqual([])
	})

	it("is owned by the client and reset with it", () => {
		const client = new ExtensionClient({ sendMessage: () => {} })
		const { sink, batches } = recordingSink()
		client.transcript.attach(sink)

		client.transcript.handleMessage(say(1, "prompt echo"))
		client.reset()
		client.transcript.handleMessage(say(2, "second prompt echo"))

		expect(batches).toEqual([])
	})
})
