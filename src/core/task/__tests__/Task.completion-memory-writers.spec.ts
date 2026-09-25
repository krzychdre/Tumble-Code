// npx vitest run core/task/__tests__/Task.completion-memory-writers.spec.ts

// The memory background writers (extraction + dream) must run when a
// top-level task finishes normally. `Task` hooks them on `TaskCompleted`, but
// `AttemptCompletionTool` emits `TaskCompleted` only when the
// `completion_result` ask is answered with `yesButtonClicked`. The VS Code
// webview never sends that answer: its "Start New Task" button (and every
// other way of leaving a finished task) goes through `clearTask` ->
// `removeClineFromStack` -> `abortTask(true)`, an ABANDONED abort, and
// abandoned aborts skip the writers. So in the VS Code chat the writers
// never ran after a normally completed task.
//
// These tests drive the real pieces: a real `Task` (with its real
// `TaskLifecycle` and `TaskAskSay`), the real `AttemptCompletionTool`, and
// the real `ClineProvider.clearTask` / `removeClineFromStack` bodies bound to
// a minimal provider stand-in. Only the memory writer entry points are spied.

import { RooCodeEventName, type ProviderSettings } from "@roo-code/types"

const { extractSpy, dreamSpy, drainExtractionSpy, drainDreamsSpy } = vi.hoisted(() => ({
	extractSpy: vi.fn().mockResolvedValue(undefined),
	dreamSpy: vi.fn().mockResolvedValue(undefined),
	drainExtractionSpy: vi.fn().mockResolvedValue(undefined),
	drainDreamsSpy: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../memory", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../memory")>()),
	executeExtractMemories: extractSpy,
	executeAutoDream: dreamSpy,
	drainPendingExtraction: drainExtractionSpy,
	drainPendingDreams: drainDreamsSpy,
	renderTranscript: vi.fn().mockReturnValue(""),
	isAutoMemoryEnabled: vi.fn().mockReturnValue(true),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: () => true,
		instance: new Proxy({}, { get: () => vi.fn() }),
	},
}))

vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: { releaseTerminalsForTask: vi.fn() },
}))
vi.mock("../../ignore/RooIgnoreController")
vi.mock("../../protect/RooProtectedController")
vi.mock("../../context-tracking/FileContextTracker")
vi.mock("../../../integrations/editor/DiffViewProvider")
vi.mock("../../tools/ToolRepetitionDetector")
vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(() => ({
		getModel: () => ({ info: {}, id: "test-model" }),
	})),
}))

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { attemptCompletionTool, type AttemptCompletionCallbacks } from "../../tools/AttemptCompletionTool"

type ProviderStandIn = {
	clineStack: Task[]
	taskEventListeners: Map<Task, Array<() => void>>
	resetSubagentPanel: () => Promise<void>
	removeClineFromStack: typeof ClineProvider.prototype.removeClineFromStack
	clearTask: typeof ClineProvider.prototype.clearTask
	cancelTask: typeof ClineProvider.prototype.cancelTask
	log: ReturnType<typeof vi.fn>
	delegation: { detach: ReturnType<typeof vi.fn> }
	[key: string]: unknown
}

function makeProvider(): ProviderStandIn {
	// The fields `Task`, `TaskAskSay` and `TaskLifecycle` read from their
	// provider, plus the real `clearTask` / `removeClineFromStack` bodies so
	// the test walks the exact code the webview's "Start New Task" reaches.
	const provider: ProviderStandIn = {
		clineStack: [],
		taskEventListeners: new Map(),
		resetSubagentPanel: vi.fn().mockResolvedValue(undefined),
		removeClineFromStack: ClineProvider.prototype.removeClineFromStack,
		clearTask: ClineProvider.prototype.clearTask,
		cancelTask: ClineProvider.prototype.cancelTask,
		log: vi.fn(),
		delegation: { detach: vi.fn().mockResolvedValue(false) },
		context: { globalStorageUri: { fsPath: "/test/storage" } },
		getState: vi.fn().mockResolvedValue({ mode: "code" }),
		getValue: vi.fn().mockReturnValue(undefined),
		getTaskHistory: vi.fn().mockResolvedValue([]),
		getHistoryItem: vi.fn().mockResolvedValue({ status: "completed" }),
		notifyBackgroundOutcome: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		updateTaskHistory: vi.fn().mockResolvedValue([]),
		memorySubTaskRunner: vi.fn(),
		getCurrentTask(this: ProviderStandIn) {
			return this.clineStack.at(-1)
		},
	}
	return provider
}

function makeTask(provider: ProviderStandIn, options: { parentTaskId?: string; isBackground?: boolean } = {}): Task {
	const task = new Task({
		provider: provider as unknown as ClineProvider,
		apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" } as ProviderSettings,
		startTask: false,
		isBackground: options.isBackground,
	})
	if (options.parentTaskId) {
		;(task as unknown as { parentTaskId: string }).parentTaskId = options.parentTaskId
	}
	// Keep the message bookkeeping in memory (no disk writes in a unit test).
	const history = (task as unknown as { history: Record<string, unknown> }).history
	history.addToClineMessages = async (message: unknown) => {
		task.clineMessages.push(message as (typeof task.clineMessages)[number])
	}
	history.saveClineMessages = vi.fn().mockResolvedValue(undefined)
	history.updateClineMessage = vi.fn().mockResolvedValue(undefined)
	;(task as unknown as { checkpointSave: unknown }).checkpointSave = vi.fn().mockResolvedValue(undefined)
	provider.clineStack.push(task)
	return task
}

function callbacks(): AttemptCompletionCallbacks {
	return {
		askApproval: vi.fn(),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		askFinishSubTaskApproval: vi.fn().mockResolvedValue(true),
		toolDescription: vi.fn().mockReturnValue("attempt_completion"),
	}
}

/**
 * Run attempt_completion until it blocks on the completion_result ask. The
 * still-pending tool run is returned inside an object (an async function
 * returning a bare promise would adopt it and wait for the answer).
 */
async function completeAndWaitForAsk(task: Task, cb = callbacks()): Promise<{ run: Promise<void> }> {
	const run = attemptCompletionTool.execute({ result: "All done." }, task, cb)
	await vi.waitFor(() => {
		const last = task.clineMessages.at(-1)
		expect(last?.type).toBe("ask")
		expect(last?.ask).toBe("completion_result")
	})
	return { run }
}

describe("memory writers after a normally completed task", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset implementations too: one test swaps in never-settling drains.
		drainExtractionSpy.mockReset().mockResolvedValue(undefined)
		drainDreamsSpy.mockReset().mockResolvedValue(undefined)
	})

	it("runs the writers once when the webview clears a finished task (Start New Task)", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)

		await completeAndWaitForAsk(task)
		expect(extractSpy).not.toHaveBeenCalled()

		// ChatView answers completion_result with startNewTask() -> "clearTask".
		await provider.clearTask()

		expect(provider.clineStack).toHaveLength(0)
		expect(task.abandoned).toBe(true)
		expect(extractSpy).toHaveBeenCalledTimes(1)
		expect(extractSpy.mock.calls[0][0]).toMatchObject({ taskId: task.taskId, isMainAgent: true })
		await vi.waitFor(() => expect(dreamSpy).toHaveBeenCalledTimes(1))
	})

	it("does not block the clear on draining the writers it just started", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await completeAndWaitForAsk(task)

		// A drain that never settles would freeze "Start New Task" (the
		// message handler awaits clearTask before posting the new state).
		drainExtractionSpy.mockImplementation(() => new Promise(() => {}))
		drainDreamsSpy.mockImplementation(() => new Promise(() => {}))

		const cleared = await Promise.race([
			provider.clearTask().then(() => "cleared"),
			new Promise((resolve) => setTimeout(() => resolve("blocked"), 1_000)),
		])

		expect(cleared).toBe("cleared")
		expect(extractSpy).toHaveBeenCalledTimes(1)
	})

	it("runs the writers once when the user switches to another task from history", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await completeAndWaitForAsk(task)

		// createTaskWithHistoryItem / createTask pop the finished task the
		// same way: removeClineFromStack -> abortTask(true).
		await provider.removeClineFromStack()

		expect(extractSpy).toHaveBeenCalledTimes(1)
	})

	it("runs the writers exactly once when the ask is accepted with yes and the task is cleared afterwards", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		const completed = vi.fn()
		task.on(RooCodeEventName.TaskCompleted, completed)

		const { run } = await completeAndWaitForAsk(task)
		task.handleWebviewAskResponse("yesButtonClicked")
		await run

		expect(completed).toHaveBeenCalledTimes(1)
		expect(extractSpy).toHaveBeenCalledTimes(1)

		await provider.clearTask()

		expect(extractSpy).toHaveBeenCalledTimes(1)
	})

	it("does not run the writers when the user answers the completion with feedback and it is then cleared mid-run", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		const cb = callbacks()

		const { run } = await completeAndWaitForAsk(task, cb)
		task.handleWebviewAskResponse("messageResponse", "please also add tests")
		await run
		expect(cb.pushToolResult).toHaveBeenCalledTimes(1)

		// The loop continues with the feedback; leaving now is abandoning a
		// task that is no longer at a completion boundary.
		await provider.clearTask()

		expect(extractSpy).not.toHaveBeenCalled()
		expect(dreamSpy).not.toHaveBeenCalled()
	})

	it("does not run the writers on Stop (user cancel) while the completion ask is pending", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await completeAndWaitForAsk(task)

		// ClineProvider.cancelTask marks the abort as a user cancel first.
		task.abortReason = "user_cancelled"
		await task.abortTask()
		// Rehydration afterwards pops the same instance as an abandoned abort.
		await provider.removeClineFromStack()

		expect(extractSpy).not.toHaveBeenCalled()
		expect(dreamSpy).not.toHaveBeenCalled()
	})

	it("does not run the writers for a background task left at a completion ask", async () => {
		const provider = makeProvider()
		const task = makeTask(provider, { isBackground: true })
		await completeAndWaitForAsk(task)

		await provider.clearTask()

		expect(extractSpy).not.toHaveBeenCalled()
		expect(dreamSpy).not.toHaveBeenCalled()
	})

	it("does not run the writers when a task reopened from history is cleared", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		// A completed task reopened from history carries the old
		// completion_result ask from an earlier session; this instance never
		// asked it, so clearing must not re-extract the whole old conversation.
		task.clineMessages.push({ ts: 1, type: "ask", ask: "completion_result", text: "" })

		await provider.clearTask()

		expect(extractSpy).not.toHaveBeenCalled()
	})
})
