import type { ClineMessage } from "@roo-code/types"
import { Writable } from "stream"

import type { TaskCompletedEvent } from "../events.js"
import { JsonEventEmitter } from "../json-event-emitter.js"
import { AgentLoopState, type AgentStateInfo } from "../agent-state.js"

function createMockStdout(): { stdout: NodeJS.WriteStream; lines: () => Record<string, unknown>[] } {
	const chunks: string[] = []

	const writable = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString())
			callback()
		},
	}) as unknown as NodeJS.WriteStream

	const lines = () =>
		chunks
			.join("")
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>)

	return { stdout: writable, lines }
}

function emitMessage(emitter: JsonEventEmitter, message: ClineMessage): void {
	;(emitter as unknown as { handleMessage: (msg: ClineMessage, isUpdate: boolean) => void }).handleMessage(
		message,
		false,
	)
}

function emitTaskCompleted(emitter: JsonEventEmitter, event: TaskCompletedEvent): void {
	;(emitter as unknown as { handleTaskCompleted: (taskCompleted: TaskCompletedEvent) => void }).handleTaskCompleted(
		event,
	)
}

function createAskCompletionMessage(ts: number, text = ""): ClineMessage {
	return {
		ts,
		type: "ask",
		ask: "completion_result",
		partial: false,
		text,
	} as ClineMessage
}

function createCompletedStateInfo(message: ClineMessage): AgentStateInfo {
	return {
		state: AgentLoopState.IDLE,
		isWaitingForInput: true,
		isRunning: false,
		isStreaming: false,
		currentAsk: "completion_result",
		requiredAction: "start_task",
		lastMessageTs: message.ts,
		lastMessage: message,
		description: "Task completed successfully. You can provide feedback or start a new task.",
	}
}

describe("JsonEventEmitter result emission", () => {
	it("prefers current completion message content over stale cached completion text", () => {
		const { stdout, lines } = createMockStdout()
		const emitter = new JsonEventEmitter({ mode: "stream-json", stdout })

		emitMessage(emitter, {
			ts: 100,
			type: "say",
			say: "completion_result",
			partial: false,
			text: "FIRST",
		} as ClineMessage)

		const firstCompletionMessage = createAskCompletionMessage(101, "")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(firstCompletionMessage),
			message: firstCompletionMessage,
		})

		const secondCompletionMessage = createAskCompletionMessage(102, "SECOND")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(secondCompletionMessage),
			message: secondCompletionMessage,
		})

		const output = lines().filter((line) => line.type === "result")
		expect(output).toHaveLength(2)
		expect(output[0]?.content).toBe("FIRST")
		expect(output[1]?.content).toBe("SECOND")
	})

	it("clears cached completion text after each result emission", () => {
		const { stdout, lines } = createMockStdout()
		const emitter = new JsonEventEmitter({ mode: "stream-json", stdout })

		emitMessage(emitter, {
			ts: 200,
			type: "say",
			say: "completion_result",
			partial: false,
			text: "FIRST",
		} as ClineMessage)

		const firstCompletionMessage = createAskCompletionMessage(201, "")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(firstCompletionMessage),
			message: firstCompletionMessage,
		})

		const secondCompletionMessage = createAskCompletionMessage(202, "")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(secondCompletionMessage),
			message: secondCompletionMessage,
		})

		const output = lines().filter((line) => line.type === "result")
		expect(output).toHaveLength(2)
		expect(output[0]?.content).toBe("FIRST")
		expect(output[1]).not.toHaveProperty("content")
	})

	// DEF-C28: `cost` was the last api_req_started only, so a task of several
	// requests reported the price of its final one.
	it("reports the cost of every request of the task, not the last one", () => {
		const { stdout, lines } = createMockStdout()
		const emitter = new JsonEventEmitter({ mode: "stream-json", stdout })

		const apiReq = (ts: number, cost: number, tokensIn: number, tokensOut: number) =>
			({
				ts,
				type: "say",
				say: "api_req_started",
				partial: false,
				text: JSON.stringify({ cost, tokensIn, tokensOut, cacheWrites: 0, cacheReads: 0 }),
			}) as ClineMessage

		emitMessage(emitter, apiReq(300, 0.25, 100, 10))
		emitMessage(emitter, apiReq(301, 0.5, 200, 20))
		// The same request updated in place must not be counted twice.
		emitMessage(emitter, apiReq(301, 0.5, 200, 20))

		const completion = createAskCompletionMessage(302, "DONE")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(completion),
			message: completion,
		})

		const result = lines().find((line) => line.type === "result")
		expect(result?.cost).toMatchObject({ totalCost: 0.75, inputTokens: 300, outputTokens: 30 })
	})

	// The extension sends api_req_started complete without a price, then writes
	// the price into the same message (same ts) when the request ends; the
	// duplicate filter used to drop that update.
	it("counts a price written into an already-seen request", () => {
		const { stdout, lines } = createMockStdout()
		const emitter = new JsonEventEmitter({ mode: "stream-json", stdout })

		const started = { ts: 400, type: "say", say: "api_req_started", partial: false } as const
		emitMessage(emitter, { ...started, text: JSON.stringify({ apiProtocol: "openai" }) } as ClineMessage)
		emitMessage(emitter, {
			...started,
			text: JSON.stringify({ apiProtocol: "openai", cost: 0.125, tokensIn: 50, tokensOut: 5 }),
		} as ClineMessage)

		const completion = createAskCompletionMessage(401, "DONE")
		emitTaskCompleted(emitter, {
			success: true,
			stateInfo: createCompletedStateInfo(completion),
			message: completion,
		})

		const result = lines().find((line) => line.type === "result")
		expect(result?.cost).toMatchObject({ totalCost: 0.125, inputTokens: 50, outputTokens: 5 })
	})
})
