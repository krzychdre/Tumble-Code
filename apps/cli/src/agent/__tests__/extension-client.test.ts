import type { ClineAsk, ClineMessage, ClineSay, ExtensionMessage } from "@tumble-code/types"

import { AgentLoopState, detectAgentState } from "../agent-state.js"
import { createMockClient } from "./helpers.js"

function createMessage(overrides: Partial<ClineMessage>): ClineMessage {
	return { ts: 1, type: "say", ...overrides }
}

function createStateMessage(messages: ClineMessage[], mode?: string): ExtensionMessage {
	return { type: "state", state: { clineMessages: messages, mode } } as ExtensionMessage
}

const ask = (kind: string, partial = false) => createMessage({ type: "ask", ask: kind as ClineAsk, partial })
const say = (kind: string, text?: string, partial?: boolean) =>
	createMessage({ type: "say", say: kind as ClineSay, text, partial })
const request = (data: object | string | undefined) =>
	say("api_req_started", typeof data === "object" ? JSON.stringify(data) : data)

describe("detectAgentState", () => {
	it.each<[string, ClineMessage[], AgentLoopState, string | undefined]>([
		["no messages", [], AgentLoopState.NO_TASK, undefined],
		["a partial ask", [ask("tool", true)], AgentLoopState.STREAMING, "tool"],
		["a partial say", [say("text", "Typing...", true)], AgentLoopState.STREAMING, undefined],
		["a request without a cost yet", [request({ tokensIn: 100 })], AgentLoopState.STREAMING, undefined],
		["a request without text yet", [request("")], AgentLoopState.STREAMING, undefined],
		[
			"an open request before the last say",
			[request({ tokensIn: 1 }), say("text", "x")],
			AgentLoopState.STREAMING,
			undefined,
		],
		[
			"a priced request, even at cost 0 or null",
			[request({ cost: 0 }), request({ cost: null })],
			AgentLoopState.RUNNING,
			undefined,
		],
		["an unreadable request", [request("not valid json")], AgentLoopState.RUNNING, undefined],
		[
			"a say after a priced request",
			[request({ cost: 0.001 }), say("text", "Working")],
			AgentLoopState.RUNNING,
			undefined,
		],
		["command output (non-blocking)", [ask("command_output")], AgentLoopState.RUNNING, "command_output"],
		["an unknown ask", [ask("unknown_type")], AgentLoopState.RUNNING, undefined],
		...["tool", "command", "followup", "use_mcp_server"].map(
			(kind): [string, ClineMessage[], AgentLoopState, string] => [
				`the ${kind} ask`,
				[ask(kind)],
				AgentLoopState.WAITING_FOR_INPUT,
				kind,
			],
		),
		...[
			"completion_result",
			"api_req_failed",
			"mistake_limit_reached",
			"auto_approval_max_req_reached",
			"resume_completed_task",
		].map((kind): [string, ClineMessage[], AgentLoopState, string] => [
			`the ${kind} ask`,
			[ask(kind)],
			AgentLoopState.IDLE,
			kind,
		]),
		["the resume_task ask", [ask("resume_task")], AgentLoopState.RESUMABLE, "resume_task"],
		[
			"the last message only",
			[ask("tool"), say("text", "done"), ask("completion_result")],
			AgentLoopState.IDLE,
			"completion_result",
		],
	])("reads %s", (_name, messages, state, currentAsk) => {
		const info = detectAgentState(messages)

		expect(info.state).toBe(state)
		expect(info.currentAsk).toBe(currentAsk)
		expect(info.lastMessage).toBe(messages.at(-1))
	})

	it.each([
		[AgentLoopState.NO_TASK, [], { isWaitingForInput: false, isRunning: false, isStreaming: false }],
		[
			AgentLoopState.STREAMING,
			[ask("tool", true)],
			{ isWaitingForInput: false, isRunning: true, isStreaming: true },
		],
		[AgentLoopState.RUNNING, [say("text")], { isWaitingForInput: false, isRunning: true, isStreaming: false }],
		[
			AgentLoopState.WAITING_FOR_INPUT,
			[ask("followup")],
			{ isWaitingForInput: true, isRunning: false, isStreaming: false },
		],
		[
			AgentLoopState.IDLE,
			[ask("completion_result")],
			{ isWaitingForInput: true, isRunning: false, isStreaming: false },
		],
		[
			AgentLoopState.RESUMABLE,
			[ask("resume_task")],
			{ isWaitingForInput: true, isRunning: false, isStreaming: false },
		],
	])("derives the flags of %s", (_state, messages, flags) => {
		expect(detectAgentState(messages)).toMatchObject(flags)
	})
})

describe("ExtensionClient", () => {
	it("has no task until a transcript arrives, even an empty one", () => {
		const { client } = createMockClient()
		expect(client.isInitialized()).toBe(false)

		client.handleMessage(createStateMessage([]))

		expect(client.isInitialized()).toBe(true)
		expect(client.getAgentState().state).toBe(AgentLoopState.NO_TASK)
	})

	it("reports a new wait for input once, and stops reporting after unsubscribing", () => {
		const { client } = createMockClient()
		const waiting: string[] = []
		const unsubscribe = client.on("waitingForInput", (event) => waiting.push(event.ask))

		client.handleMessage(createStateMessage([createMessage({ ts: 1, type: "ask", ask: "followup" })]))
		client.handleMessage(createStateMessage([createMessage({ ts: 1, type: "ask", ask: "followup" })]))
		unsubscribe()
		client.handleMessage(createStateMessage([say("text"), createMessage({ ts: 2, type: "ask", ask: "tool" })]))

		expect(waiting).toEqual(["followup"])
	})

	// Opening a finished task again ends its history with a
	// resume_completed_task ask, and the client reports that as taskCompleted,
	// the same event a task that just finished gets. Consumers that act on
	// completion (the TUI's --oneshot exit) have to tell the two apart.
	it("reports taskCompleted for a resumed completed task, carrying the resume ask", () => {
		const { client } = createMockClient()
		const completions: Array<string | undefined> = []

		client.on("taskCompleted", (event) => completions.push(event.message?.ask))

		client.handleMessage(
			createStateMessage([
				createMessage({ ts: 1, type: "say", say: "text", text: "Say hi" }),
				createMessage({ ts: 2, type: "ask", ask: "completion_result", text: "" }),
				createMessage({ ts: 3, type: "ask", ask: "resume_completed_task", partial: false }),
			]),
		)

		expect(completions).toEqual(["resume_completed_task"])
	})

	// D11 step 2: the client publishes the deliveries stage, every new or
	// changed message once, instead of the last message of each state push.
	describe("Delivery events", () => {
		const text = (ts: number, value: string, partial = false) =>
			createMessage({ ts, type: "say", say: "text", text: value, partial })

		it("delivers every new message of a state push, the first of two included", () => {
			const { client } = createMockClient()
			const delivered: Array<[number, boolean]> = []
			client.on("delivery", (d) => delivered.push([d.message.ts, d.isLast]))

			client.handleMessage(createStateMessage([text(1, "Batch")]))
			client.handleMessage(
				createStateMessage([text(1, "Batch"), text(2, "First part."), text(3, "Second part.")]),
			)

			expect(delivered).toEqual([
				[1, true],
				[2, false],
				[3, true],
			])
		})

		it("delivers nothing for a pure replay, and a messageUpdated as an update", () => {
			const { client } = createMockClient()
			const delivered: Array<[number, string | undefined, boolean]> = []
			client.on("delivery", (d) => delivered.push([d.message.ts, d.message.text, d.update]))

			client.handleMessage(createStateMessage([text(1, "Hel", true)]))
			client.handleMessage({ type: "messageUpdated", clineMessage: text(1, "Hello", false) })
			client.handleMessage(createStateMessage([text(1, "Hello", false)]))

			expect(delivered).toEqual([
				[1, "Hel", false],
				[1, "Hello", true],
			])
		})

		it("delivers after the state change of the same push, as the message event did", () => {
			const { client } = createMockClient()
			const order: string[] = []
			client.on("stateChange", () => order.push("stateChange"))
			client.on("delivery", (d) => order.push(`delivery ${d.message.ts}`))

			client.handleMessage(createStateMessage([text(1, "Hi")]))

			expect(order).toEqual(["stateChange", "delivery 1"])
		})

		it("marks a resumed task's history after beginHistoryReplay", () => {
			const { client } = createMockClient()
			const history: Array<[number, boolean]> = []
			client.on("delivery", (d) => history.push([d.message.ts, d.history]))

			client.beginHistoryReplay()
			client.handleMessage(createStateMessage([text(1, "Old prompt"), text(2, "Old answer.")]))
			client.handleMessage(
				createStateMessage([
					text(1, "Old prompt"),
					text(2, "Old answer."),
					createMessage({ ts: 3, type: "ask", ask: "resume_task", partial: false }),
				]),
			)
			client.handleMessage({ type: "messageUpdated", clineMessage: text(4, "New.") })

			expect(history).toEqual([
				[1, true],
				[2, true],
				[3, true],
				[4, false],
			])
		})
	})

	// D11 step 4: what the client remembers of the transcript (the agent loop
	// state and getMessages, which the JSON cost reads) and the order of its
	// events, pinned before the StateStore goes.
	describe("Transcript and agent state", () => {
		const text = (ts: number, value: string, partial = false) =>
			createMessage({ ts, type: "say", say: "text", text: value, partial })
		const texts = (messages: ClineMessage[]) => messages.map((m) => `${m.ts}:${m.text}`)

		it("keeps the last push, an update replacing its message in place and appending an unknown ts", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([text(1, "A"), text(2, "B", true)]))
			client.handleMessage({ type: "messageUpdated", clineMessage: text(2, "Bee") })
			client.handleMessage({ type: "messageUpdated", clineMessage: text(9, "Z") })

			expect(texts(client.getMessages())).toEqual(["1:A", "2:Bee", "9:Z"])

			client.handleMessage(createStateMessage([text(5, "New task")]))

			expect(texts(client.getMessages())).toEqual(["5:New task"])
		})

		it("is initialized by a messageUpdated alone", () => {
			const { client } = createMockClient()

			client.handleMessage({ type: "messageUpdated", clineMessage: text(1, "Hi") })

			expect(client.isInitialized()).toBe(true)
			expect(texts(client.getMessages())).toEqual(["1:Hi"])
			expect(client.getAgentState().state).not.toBe(AgentLoopState.NO_TASK)
		})

		it("ignores a push without clineMessages and a messageUpdated without a message", () => {
			const { client } = createMockClient()
			const events: string[] = []
			client.on("stateChange", () => events.push("stateChange"))
			client.on("delivery", () => events.push("delivery"))

			client.handleMessage(createStateMessage([text(1, "A")]))
			events.length = 0
			client.handleMessage({ type: "state", state: { mode: "code" } } as ExtensionMessage)
			client.handleMessage({ type: "messageUpdated" } as ExtensionMessage)

			expect(events).toEqual([])
			expect(texts(client.getMessages())).toEqual(["1:A"])
		})

		it("forgets the transcript and the agent state on reset", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ ts: 1, type: "ask", ask: "tool" })]))
			client.reset()

			expect(client.getMessages()).toEqual([])
			expect(client.isInitialized()).toBe(false)
			expect(client.getAgentState().state).toBe(AgentLoopState.NO_TASK)
		})

		it("orders a push as state change events then deliveries, an update as deliveries then state change events", () => {
			const { client } = createMockClient()
			const order: string[] = []
			client.on("stateChange", (e) => order.push(`stateChange ${e.currentState.state}`))
			client.on("waitingForInput", (e) => order.push(`waiting ${e.ask}`))
			client.on("taskCompleted", (e) => order.push(`completed ${e.success}`))
			client.on("delivery", (d) => order.push(`delivery ${d.message.ts}`))

			client.handleMessage(
				createStateMessage([text(1, "Go"), createMessage({ ts: 2, type: "ask", ask: "tool" })]),
			)
			client.handleMessage({
				type: "messageUpdated",
				clineMessage: createMessage({ ts: 3, type: "ask", ask: "completion_result", text: "Done" }),
			})
			// An update that changes nothing: no delivery, the state change event still comes.
			client.handleMessage({
				type: "messageUpdated",
				clineMessage: createMessage({ ts: 3, type: "ask", ask: "completion_result", text: "Done" }),
			})

			expect(order).toEqual([
				"stateChange waiting_for_input",
				"waiting tool",
				"delivery 1",
				"delivery 2",
				"delivery 3",
				"stateChange idle",
				"completed true",
				"stateChange idle",
			])
		})

		it("is already current inside the listeners of both kinds of events", () => {
			const { client } = createMockClient()
			const seen: string[] = []
			const look = (event: string) =>
				seen.push(`${event} ${client.getMessages().length} ${client.getAgentState().currentAsk ?? "-"}`)
			client.on("stateChange", () => look("stateChange"))
			client.on("delivery", () => look("delivery"))

			client.handleMessage(createStateMessage([createMessage({ ts: 1, type: "ask", ask: "followup" })]))
			client.handleMessage({ type: "messageUpdated", clineMessage: text(2, "Thinking", true) })

			expect(seen).toEqual(["stateChange 1 followup", "delivery 1 followup", "delivery 2 -", "stateChange 2 -"])
		})
	})

	it.each([
		[
			"approve",
			(c: ReturnType<typeof createMockClient>["client"]) => c.approve(),
			"yesButtonClicked",
			undefined,
			undefined,
		],
		[
			"reject",
			(c: ReturnType<typeof createMockClient>["client"]) => c.reject(),
			"noButtonClicked",
			undefined,
			undefined,
		],
		[
			"respond",
			(c: ReturnType<typeof createMockClient>["client"]) => c.respond("My answer", ["image-data"]),
			"messageResponse",
			"My answer",
			["image-data"],
		],
	])("answers the extension on %s", (_name, act, askResponse, text, images) => {
		const { client, sentMessages } = createMockClient()

		act(client)

		expect(sentMessages).toEqual([{ type: "askResponse", askResponse, text, images }])
	})

	it("forgets its listeners on reset", () => {
		const { client } = createMockClient()
		const changes = vi.fn()
		client.on("stateChange", changes)

		client.reset()
		client.handleMessage(createStateMessage([say("text")]))

		expect(changes).not.toHaveBeenCalled()
	})
})
