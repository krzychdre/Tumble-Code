import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { ContextProxy } from "../../config/ContextProxy"
import type { ProviderSettings, HistoryItem } from "@tumble-code/types"

// Mock dependencies
vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy")
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({
			registerClient: vi.fn(),
		}),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))

// Mock TelemetryService
vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			capture: vi.fn(),
		},
	},
}))

// Mock CloudService
vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(false),
		instance: {
			isAuthenticated: vi.fn().mockReturnValue(false),
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("https://api.roo-code.com"),
}))

vi.mock("../../../shared/embeddingModels", () => ({
	EMBEDDING_MODEL_PROFILES: [],
}))

describe("ClineProvider flicker-free cancel", () => {
	let provider: ClineProvider
	let mockContext: any
	let mockOutputChannel: any
	let mockTask1: any
	let mockTask2: any

	const mockApiConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiKey: "test-key",
	} as ProviderSettings

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock extension context
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

		// Setup mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			dispose: vi.fn(),
		}

		// Setup mock context proxy
		const mockContextProxy = {
			getValues: vi.fn().mockReturnValue({}),
			getValue: vi.fn().mockReturnValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			onDidChangeValues: vi.fn(() => ({ dispose: vi.fn() })),
			getProviderSettings: vi.fn().mockReturnValue(mockApiConfig),
			extensionUri: mockContext.extensionUri,
			globalStorageUri: mockContext.globalStorageUri,
		}

		// Create provider instance
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy as any)

		// Mock provider methods
		provider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: mockApiConfig,
			organizationAllowList: { allowAll: true, providers: {} },
			mode: "code",
		})

		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		// Mock private method using any cast
		;(provider as any).updateGlobalState = vi.fn().mockResolvedValue(undefined)
		provider.activateProviderProfile = vi.fn().mockResolvedValue(undefined)
		provider.performPreparationTasks = vi.fn().mockResolvedValue(undefined)
		provider.getHistoryItem = vi.fn().mockImplementation((id) =>
			Promise.resolve({
				id,
				number: 1,
				ts: Date.now(),
				task: "test task",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.001,
				workspace: "/test/workspace",
			}),
		)

		// Setup mock tasks
		mockTask1 = {
			taskId: "task-1",
			instanceId: "instance-1",
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
			abandoned: false,
			dispose: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}

		mockTask2 = {
			taskId: "task-1", // Same ID for rehydration scenario
			instanceId: "instance-2", // Different instance
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}

		// Mock Task constructor
		vi.mocked(Task).mockImplementation(function () {
			return mockTask2 as any
		})
	})

	const historyItem = (id: string): HistoryItem => ({
		id,
		number: 1,
		task: "test task",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 200,
		totalCost: 0.001,
		workspace: "/test/workspace",
	})

	it("rehydrating the current task replaces it in place, without clearing the slot", async () => {
		;(provider as any).taskSlot.seedForTests(mockTask1)
		const cleanups = [vi.fn(), vi.fn()]
		;(provider as any).taskEventListeners.set(mockTask1, cleanups)
		const clearCurrentTask = vi.spyOn(provider, "clearCurrentTask")

		await provider.createTaskWithHistoryItem(historyItem("task-1"))

		expect(clearCurrentTask).not.toHaveBeenCalled()
		expect((provider as any).taskSlot.current).toBe(mockTask2)
		expect(mockTask1.abortTask).toHaveBeenCalled()
		for (const cleanup of cleanups) {
			expect(cleanup).toHaveBeenCalled()
		}
		expect(mockTask2.emit).toHaveBeenCalledWith("taskFocused")
	})

	it.each([
		["another task is current", () => (provider as any).taskSlot.seedForTests(mockTask1)],
		["the slot is empty", () => (provider as any).taskSlot.seedForTests()],
	])("opening a task from history when %s leaves the current one first", async (_name, seed) => {
		seed()
		const clearCurrentTask = vi.spyOn(provider, "clearCurrentTask").mockResolvedValue(undefined)

		await provider.createTaskWithHistoryItem(historyItem("task-2"))

		expect(clearCurrentTask).toHaveBeenCalled()
	})
})
