import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"

// Mock dependencies (mirrors ClineProvider.delegation-cancel-races.spec.ts)
vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	return {
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			workspaceFolders: [],
			onDidChangeConfiguration: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
		})),
		Disposable: {
			from: vi.fn(),
		},
		window: {
			showErrorMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			onDidChangeActiveTextEditor: vi.fn(() => mockDisposable),
		},
		Uri: {
			file: vi.fn().mockReturnValue({ toString: () => "file://test" }),
		},
	}
})

vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy")
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({
			registerClient: vi.fn(),
		}),
		unregisterProvider: vi.fn(),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			captureTaskCreated: vi.fn(),
		},
	},
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(false),
		instance: {
			isAuthenticated: vi.fn().mockReturnValue(false),
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://api.example.com"),
}))

vi.mock("../../../shared/embeddingModels", () => ({
	EMBEDDING_MODEL_PROFILES: [],
}))

vi.mock("../../task-persistence", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		readApiMessages: vi.fn().mockResolvedValue([]),
		saveApiMessages: vi.fn().mockResolvedValue(undefined),
		saveTaskMessages: vi.fn().mockResolvedValue(undefined),
	}
})
vi.mock("../../task-persistence/taskMessages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		readTaskMessages: vi.fn().mockResolvedValue([]),
	}
})

describe("ClineProvider cancelTask abort-race (TE-7)", () => {
	let provider: ClineProvider
	let mockContext: any
	let mockOutputChannel: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: { fsPath: "/test/storage" },
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			extensionUri: { fsPath: "/test/extension" },
		}

		mockOutputChannel = {
			appendLine: vi.fn(),
			dispose: vi.fn(),
		}

		const mockContextProxy = {
			getValues: vi.fn().mockReturnValue({}),
			getValue: vi.fn().mockReturnValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			getProviderSettings: vi.fn().mockReturnValue({ apiProvider: "anthropic" }),
			extensionUri: mockContext.extensionUri,
			globalStorageUri: mockContext.globalStorageUri,
		}

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy as any)
		provider.getState = vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "anthropic" }, mode: "code" })
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
	})

	// Helper: create a mock task with controllable isStreaming and abortTask timing.
	function makeMockTask(opts: {
		taskId?: string
		instanceId?: string
		isStreaming?: boolean
		abortTaskImpl?: () => Promise<void>
	}): any {
		const taskId = opts.taskId ?? "task-1"
		const instanceId = opts.instanceId ?? "inst-1"
		const isStreaming = opts.isStreaming ?? true

		const task: any = {
			taskId,
			instanceId,
			rootTask: undefined,
			parentTask: undefined,
			isStreaming,
			didFinishAbortingStream: false,
			isWaitingForFirstChunk: false,
			abandoned: false,
			abort: false,
			abortReason: undefined,
			emit: vi.fn(),
			cancelCurrentRequest: vi.fn(),
			abortTask: vi.fn(),
		}

		// Default abortTask: set abort=true, flip isStreaming=false after a microtask.
		if (opts.abortTaskImpl) {
			task.abortTask = vi.fn(opts.abortTaskImpl)
		} else {
			task.abortTask = vi.fn(async () => {
				task.abort = true
				// Simulate processStream finally block clearing isStreaming.
				await Promise.resolve()
				task.isStreaming = false
			})
		}

		return task
	}

	it("fast abort: cancelTask completes without spurious failure (control)", async () => {
		const task = makeMockTask({ isStreaming: true })
		;(provider as any).clineStack = [task]

		provider.getTaskWithId = vi.fn().mockResolvedValue({
			historyItem: { id: "task-1", status: "active", task: "test" },
		})
		const createWithHistory = vi.fn().mockResolvedValue(undefined)
		provider.createTaskWithHistoryItem = createWithHistory as any

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		await provider.cancelTask()

		// No "Failed to abort task" error — abort resolved quickly.
		expect(errorSpy).not.toHaveBeenCalled()
		expect(task.abandoned).toBe(true)
		// Rehydrate proceeded.
		expect(createWithHistory).toHaveBeenCalledOnce()

		errorSpy.mockRestore()
	})

	it("slow abort: cancelTask does not log 'Failed to abort task' when abort is still progressing", async () => {
		// Simulate an abort that takes longer than the 3s pWaitFor bound.
		// isStreaming stays true until the slow abort resolves.
		// The abort resolves at 5000ms — past the 3000ms pWaitFor timeout.
		const task = makeMockTask({
			isStreaming: true,
			abortTaskImpl: () =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						task.abort = true
						task.isStreaming = false
						resolve()
					}, 5000)
				}),
		})
		;(provider as any).clineStack = [task]

		provider.getTaskWithId = vi.fn().mockResolvedValue({
			historyItem: { id: "task-1", status: "active", task: "test" },
		})
		const createWithHistory = vi.fn().mockResolvedValue(undefined)
		provider.createTaskWithHistoryItem = createWithHistory as any

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Use fake timers so the 3s pWaitFor timeout fires instantly.
		vi.useFakeTimers()

		const cancelPromise = provider.cancelTask()

		// Advance past the 3s pWaitFor timeout — the abort (5s) hasn't resolved yet.
		await vi.advanceTimersByTimeAsync(3100)

		// cancelTask should have resolved (it's bounded at 3s).
		await cancelPromise

		// Key assertion: NO spurious "Failed to abort task" error.
		// Pre-fix: the pWaitFor catches the timeout and logs "Failed to abort task".
		expect(errorSpy).not.toHaveBeenCalled()

		// abandoned is set after the bounded wait, not before.
		expect(task.abandoned).toBe(true)

		// The abort is still in progress (hasn't resolved at 3100ms).
		expect(task.abort).toBe(false)
		expect(task.isStreaming).toBe(true)

		// Let the slow abort finish.
		await vi.advanceTimersByTimeAsync(2000)
		expect(task.abort).toBe(true)
		expect(task.isStreaming).toBe(false)

		vi.useRealTimers()
		errorSpy.mockRestore()
	})

	it("abandoned is not set before the bounded wait concludes", async () => {
		// Verify ordering: abandoned should be false when abortTask starts,
		// and only set after the pWaitFor completes.
		const task = makeMockTask({ isStreaming: true })
		;(provider as any).clineStack = [task]

		provider.getTaskWithId = vi.fn().mockResolvedValue({
			historyItem: { id: "task-1", status: "active", task: "test" },
		})
		provider.createTaskWithHistoryItem = vi.fn().mockResolvedValue(undefined) as any

		const abandonedAtAbortStart: boolean[] = []
		const origAbort = task.abortTask
		task.abortTask = vi.fn(async () => {
			abandonedAtAbortStart.push(task.abandoned)
			await origAbort()
		})

		// Use fake timers so pWaitFor's 3s timeout fires instantly.
		vi.useFakeTimers()
		const cancelPromise = provider.cancelTask()
		await vi.advanceTimersByTimeAsync(3100)
		await cancelPromise

		// When abortTask started, abandoned was NOT yet true.
		expect(abandonedAtAbortStart).toHaveLength(1)
		expect(abandonedAtAbortStart[0]).toBe(false)
		// After cancelTask, abandoned is true.
		expect(task.abandoned).toBe(true)

		vi.useRealTimers()
	})

	// Mock Task constructor so any rehydration path that constructs a Task is safe.
	beforeEach(() => {
		vi.mocked(Task).mockImplementation(
			() =>
				({
					taskId: "rehydrated",
					instanceId: "ri-1",
					emit: vi.fn(),
					on: vi.fn(),
					off: vi.fn(),
				}) as any,
		)
	})
})
