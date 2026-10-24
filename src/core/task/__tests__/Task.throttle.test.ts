import { TumbleCodeEventName, ProviderSettings, TokenUsage } from "@tumble-code/types"

import { Task } from "../Task"
import { CLINE_MESSAGES_SAVE_IDLE_MS } from "../TaskMessageLog"
import { ClineProvider } from "../../webview/ClineProvider"
import { taskMetadata } from "../../task-persistence"

// Mock dependencies
vi.mock("../../webview/ClineProvider")
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
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

// Mock TelemetryService
vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
		},
	},
}))

// Mock task persistence to avoid disk writes
vi.mock("../../task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	readTaskMessages: vi.fn().mockResolvedValue([]),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
	taskMetadata: vi.fn().mockResolvedValue({
		historyItem: {
			id: "test-task-id",
			number: 1,
			task: "Test task",
			ts: Date.now(),
			totalCost: 0.01,
			tokensIn: 100,
			tokensOut: 50,
		},
		tokenUsage: {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 0,
			totalCacheReads: 0,
		},
	}),
}))

/** Token usage `n` times the base figures, as taskMetadata would report it after `n` saves. */
const usage = (n: number): TokenUsage => ({
	totalTokensIn: 100 * n,
	totalTokensOut: 50 * n,
	totalCost: 0.01 * n,
	contextTokens: 150 * n,
	totalCacheWrites: 0,
	totalCacheReads: 0,
})

const metadataWith = (tokenUsage: TokenUsage) => ({
	historyItem: { id: "test-task-id", number: 1, task: "Test task", ts: 1, totalCost: 0, tokensIn: 0, tokensOut: 0 },
	tokenUsage,
})

describe("Task token usage updates", () => {
	let task: Task
	let emit: ReturnType<typeof vi.spyOn>

	/** Saves one more message, which reports the token usage taskMetadata computed. */
	const addMessage = (text: string) =>
		task.history.addToClineMessages({ ts: Date.now(), type: "say", say: "text", text })
	const usageEmits = () =>
		emit.mock.calls.filter(([event]: unknown[]) => event === TumbleCodeEventName.TaskTokenUsageUpdated)

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		const provider = {
			context: { globalStorageUri: { fsPath: "/test/path" } },
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			getCurrentTask: () => task,
		}
		task = new Task({
			provider: provider as unknown as ClineProvider,
			apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" } as ProviderSettings,
			startTask: false,
		})
		emit = vi.spyOn(task, "emit")
	})

	afterEach(() => {
		vi.useRealTimers()
		if (!task.abort) {
			task.dispose()
		}
	})

	it("emits the first change at once, with the tool usage, and at most once per 2 s after that", async () => {
		let saves = 0
		vi.mocked(taskMetadata).mockImplementation(async () => metadataWith(usage(++saves)))
		task.toolUsage = { read_file: { attempts: 5, failures: 1 } }

		await addMessage("Message 1")
		expect(usageEmits()).toEqual([
			[TumbleCodeEventName.TaskTokenUsageUpdated, task.taskId, usage(1), task.toolUsage],
		])
		const firstSnapshot = task.tokenUsageSnapshot

		vi.advanceTimersByTime(500)
		await addMessage("Message 2")
		expect(usageEmits()).toHaveLength(1)
		expect(task.tokenUsageSnapshot).toBe(firstSnapshot)

		vi.advanceTimersByTime(1600)
		await addMessage("Message 3")
		expect(usageEmits()).toHaveLength(2)
		expect(task.tokenUsageSnapshot!.totalTokensIn).toBeGreaterThan(firstSnapshot!.totalTokensIn)
	})

	it("does not emit unchanged usage after the window", async () => {
		vi.mocked(taskMetadata).mockResolvedValue(metadataWith(usage(1)))

		await addMessage("Message 1")
		vi.advanceTimersByTime(2100)
		await addMessage("Message 2")

		expect(usageEmits()).toHaveLength(1)
	})

	it("emits a tool usage change alone and snapshots a copy of it", async () => {
		vi.mocked(taskMetadata).mockResolvedValue(metadataWith(usage(1)))
		await addMessage("Message 1")
		vi.advanceTimersByTime(2100)

		task.toolUsage = { read_file: { attempts: 3, failures: 0 }, write_to_file: { attempts: 2, failures: 1 } }
		await addMessage("Message 2")
		// The second write is coalesced (CORE-R7 step 4): let it run.
		await vi.advanceTimersByTimeAsync(CLINE_MESSAGES_SAVE_IDLE_MS)

		expect(usageEmits()).toHaveLength(2)
		expect(task.toolUsageSnapshot).toEqual(task.toolUsage)
		expect(task.toolUsageSnapshot).not.toBe(task.toolUsage)
	})

	it("flushes a final update inside the throttle window before TaskAborted", async () => {
		await addMessage("Message 1")
		task.toolUsage = { read_file: { attempts: 5, failures: 1 } }
		emit.mockClear()

		vi.advanceTimersByTime(500)
		await task.abortTask()

		const events = emit.mock.calls.map(([event]: unknown[]) => event)
		expect(events.indexOf(TumbleCodeEventName.TaskTokenUsageUpdated)).toBeGreaterThanOrEqual(0)
		expect(events.indexOf(TumbleCodeEventName.TaskTokenUsageUpdated)).toBeLessThan(
			events.indexOf(TumbleCodeEventName.TaskAborted),
		)
	})

	it("counts tool attempts and failures, and reports a failure only when it has a message", () => {
		task.recordToolUsage("read_file")
		task.recordToolUsage("read_file")
		task.recordToolError("read_file")
		task.recordToolError("write_to_file", "permission denied")

		expect(task.toolUsage).toEqual({
			read_file: { attempts: 2, failures: 1 },
			write_to_file: { attempts: 0, failures: 1 },
		})
		expect(emit.mock.calls.filter(([event]: unknown[]) => event === TumbleCodeEventName.TaskToolFailed)).toEqual([
			[TumbleCodeEventName.TaskToolFailed, task.taskId, "write_to_file", "permission denied"],
		])
	})

	it("computes tokenUsage once and serves the snapshot after that", () => {
		task.clineMessages = [
			{ ts: 1, type: "say", say: "text", text: "task" },
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0.1 }),
			},
		]

		const first = task.tokenUsage

		expect(first).toMatchObject({ totalTokensIn: 10, totalTokensOut: 5, totalCost: 0.1 })
		task.clineMessages.push({ ts: 3, type: "say", say: "api_req_started", text: JSON.stringify({ tokensIn: 99 }) })
		expect(task.tokenUsage).toBe(first)
	})
})
