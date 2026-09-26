// cd src && npx vitest run core/task/__tests__/TaskHistory.turn-counts.spec.ts
//
// CORE-R7 (Phase 10): the host-side work one scripted request cycle causes,
// counted through the real TaskAskSay and TaskHistory. It pins today's numbers
// (full state pushes, messageUpdated posts, ui_messages saves, getState
// calls) AND the cloud contract (one TASK_MESSAGE capture per finished
// message, one Message event per add or update), so a performance change
// updates the numbers here deliberately and cannot change the contract by
// accident.

import { RooCodeEventName, TelemetryEventName, type ClineMessage } from "@roo-code/types"

const { captureEvent, savedSnapshots, metadataRuns } = vi.hoisted(() => ({
	captureEvent: vi.fn(),
	savedSnapshots: [] as ClineMessage[][],
	metadataRuns: { count: 0 },
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		isEnabled: () => true,
		hasInstance: () => true,
		instance: { captureEvent },
	},
}))

vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(async ({ messages }: { messages: ClineMessage[] }) => {
		savedSnapshots.push(messages)
	}),
	readTaskMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	readApiMessages: vi.fn().mockResolvedValue([]),
	taskMetadata: vi.fn(async () => {
		metadataRuns.count++
		return { historyItem: { id: "turn-task", ts: 1, task: "t", number: 1 }, tokenUsage: {} }
	}),
}))

import { TaskAskSay } from "../TaskAskSay"
import { TaskHistory } from "../TaskHistory"

/** Serialized size in bytes, the way the webview and the disk receive it. */
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

interface Counts {
	getState: number
	statePushes: number
	statePushBytes: number
	messageUpdatedPosts: number
	saves: number
	saveBytes: number
	metadataRuns: number
	taskMessageCaptures: number
	messageEvents: { created: number; updated: number }
}

/** The task fields TaskAskSay and TaskHistory read, with both helpers attached. */
interface TurnTask {
	clineMessages: ClineMessage[]
	askSay: TaskAskSay
	history: TaskHistory
}

/**
 * A task with the real TaskAskSay and TaskHistory, a provider that counts
 * what reaches it, and `history` earlier messages of about the median real
 * message size (1.7 KB, measured on 1,053 local tasks).
 */
function makeTask(historyMessages: number) {
	const clineMessages: ClineMessage[] = []
	for (let i = 0; i < historyMessages; i++) {
		clineMessages.push({ ts: i + 1, type: "say", say: "text", text: "x".repeat(1_700) })
	}

	const counts = {
		getState: 0,
		statePushes: 0,
		statePushBytes: 0,
		messageUpdatedPosts: 0,
	}
	const messageEvents = { created: 0, updated: 0 }

	const provider = {
		getState: vi.fn(async () => {
			counts.getState++
			return { autoApprovalEnabled: true, autoApprovalMode: "bypass", cwd: "/ws" }
		}),
		// What the real push carries for the chat: the whole message list.
		postStateToWebviewWithoutTaskHistory: vi.fn(async () => {
			counts.statePushes++
			counts.statePushBytes += bytes({ type: "state", state: { clineMessages: task.clineMessages } })
		}),
		postMessageToWebview: vi.fn(async (message: { type: string }) => {
			if (message.type === "messageUpdated") {
				counts.messageUpdatedPosts++
			}
		}),
		updateTaskHistory: vi.fn(async () => []),
		subagentRegistry: { isWatched: () => false },
	}

	const task = {
		taskId: "turn-task",
		instanceId: "1",
		abort: false,
		isBackground: false,
		cwd: "/ws",
		globalStoragePath: "/storage",
		clineMessages,
		apiConversationHistory: [],
		cloudSyncedMessageTimestamps: new Set<number>(clineMessages.map((m) => m.ts)),
		providerRef: { deref: () => provider },
		taskNumber: 1,
		_taskMode: "code",
		_taskApiConfigName: "default",
		taskApiConfigReady: Promise.resolve(),
		toolUsage: {},
		debouncedEmitTokenUsage: vi.fn(),
		restoreTodoListForTask: vi.fn(),
		messageQueueService: { isEmpty: () => true, dequeueMessage: () => undefined, messages: [] },
		checkpointSave: vi.fn(async () => {}),
		emit: vi.fn((event: string, payload?: { action?: "created" | "updated" }) => {
			if (event === RooCodeEventName.Message && payload?.action) {
				messageEvents[payload.action]++
			}
			return true
		}),
	} as unknown as TurnTask
	task.history = new TaskHistory(task as any)
	task.askSay = new TaskAskSay(task as any)

	const snapshot = (): Counts => ({
		...counts,
		saves: savedSnapshots.length,
		saveBytes: savedSnapshots.reduce((sum, messages) => sum + bytes(messages), 0),
		metadataRuns: metadataRuns.count,
		taskMessageCaptures: captureEvent.mock.calls.filter(
			([event]) => event.event === TelemetryEventName.TASK_MESSAGE,
		).length,
		messageEvents: { ...messageEvents },
	})

	return { task, snapshot }
}

/** Ignores the AskIgnoredError a partial ask throws by design. */
async function partialAsk(task: TurnTask, text: string) {
	await task.askSay.ask("tool", text, true).catch(() => undefined)
}

/**
 * One request cycle as the stream processor drives the chat: the request row,
 * streamed reasoning, streamed text, and one tool call whose arguments stream
 * in before it is auto-approved. Chunk counts are arguments.
 */
async function runTurn(task: TurnTask, chunks: { reasoning: number; text: number; toolArgs: number }) {
	await task.askSay.say("api_req_started", JSON.stringify({ apiProtocol: "openai" }))

	let reasoning = ""
	for (let i = 0; i < chunks.reasoning; i++) {
		reasoning += "think "
		await task.askSay.say("reasoning", reasoning, undefined, true)
	}
	await task.askSay.say("reasoning", reasoning, undefined, false)

	let text = ""
	for (let i = 0; i < chunks.text; i++) {
		text += "word "
		await task.askSay.say("text", text, undefined, true)
	}
	await task.askSay.say("text", text, undefined, false)

	let path = ""
	for (let i = 0; i < chunks.toolArgs; i++) {
		path += "a"
		await partialAsk(task, JSON.stringify({ tool: "readFile", path, toolCallId: "call-1" }))
	}
	const { response } = await task.askSay.ask(
		"tool",
		JSON.stringify({ tool: "readFile", path, toolCallId: "call-1" }),
		false,
	)
	expect(response).toBe("yesButtonClicked")

	// Let the fire-and-forget saves of the approval settle.
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("CORE-R7 request-cycle counts (TaskAskSay + TaskHistory)", () => {
	let now = 1_000_000

	beforeEach(() => {
		captureEvent.mockClear()
		savedSnapshots.length = 0
		metadataRuns.count = 0
		vi.spyOn(Date, "now").mockImplementation(() => ++now)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const chunks = { reasoning: 20, text: 30, toolArgs: 10 }

	it("pins today's pushes, saves, getState calls and the cloud contract for one cycle", async () => {
		const { task, snapshot } = makeTask(0)

		await runTurn(task, chunks)

		const counts = snapshot()
		// 4 messages: api_req_started, reasoning, text, the tool ask.
		expect(task.clineMessages).toHaveLength(4)
		expect(counts).toMatchObject({
			// One full state push per added message.
			statePushes: 4,
			// Every streamed chunk after the first of a message, plus the finish of the
			// three streamed messages (the auto-approved ask is finished already answered).
			messageUpdatedPosts: 19 + 29 + 9 + 3,
			// One save per added message and one per finished streamed message.
			saves: 4 + 3,
			// Metrics over the whole message list after every save.
			metadataRuns: 7,
			// One ask() per tool-argument chunk plus the final ask, each reads the settings.
			getState: 11,
			// The cloud contract: one capture per finished message, one event per add/update.
			taskMessageCaptures: 4,
			messageEvents: { created: 4, updated: 19 + 29 + 9 + 3 },
		})
	})

	it("sends and writes the whole history on every added message (bytes grow with the conversation)", async () => {
		const empty = makeTask(0)
		await runTurn(empty.task, chunks)
		const small = empty.snapshot()

		savedSnapshots.length = 0
		metadataRuns.count = 0
		captureEvent.mockClear()
		const long = makeTask(300)
		await runTurn(long.task, chunks)
		const large = long.snapshot()

		// Same number of operations...
		expect(large.statePushes).toBe(small.statePushes)
		expect(large.saves).toBe(small.saves)
		expect(large.taskMessageCaptures).toBe(small.taskMessageCaptures)
		// ...but each push and each save carries the 300 earlier messages again.
		// The 300 messages as they sit inside the array (without its brackets, plus one comma).
		const history = bytes(long.task.clineMessages.slice(0, 300)) - 1
		expect(large.statePushBytes - small.statePushBytes).toBeGreaterThanOrEqual(large.statePushes * history)
		expect(large.saveBytes - small.saveBytes).toBeGreaterThanOrEqual(large.saves * history)
	})
})
