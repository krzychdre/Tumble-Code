import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"

// Mock dependencies (mirrors ClineProvider.flicker-free-cancel.spec.ts)
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

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			capture: vi.fn(),
		},
	},
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(false),
		instance: {
			isAuthenticated: vi.fn().mockReturnValue(false),
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("https://api.example.com"),
}))

vi.mock("../../../shared/embeddingModels", () => ({
	EMBEDDING_MODEL_PROFILES: [],
}))

// The delegation transitions themselves are pinned in DelegationService.spec; this pins what
// the provider's cancelTask does with their outcome. importOriginal keeps the exports
// (e.g. TaskHistoryStore) the ClineProvider constructor depends on.
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

describe("ClineProvider delegation cancel/reopen races", () => {
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
			onDidChangeValues: vi.fn(() => ({ dispose: vi.fn() })),
			getProviderSettings: vi.fn().mockReturnValue({ apiProvider: "anthropic" }),
			extensionUri: mockContext.extensionUri,
			globalStorageUri: mockContext.globalStorageUri,
		}

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy as any)
		provider.getState = vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "anthropic" }, mode: "code" })
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
	})

	it("cancelTask detaches a delegated parent and rehydrates the child standalone", async () => {
		const childTask: any = {
			taskId: "child-1",
			instanceId: "ci-1",
			parentTaskId: "parent-1",
			parentTask: { taskId: "parent-1" },
			isStreaming: false,
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
			cancelCurrentRequest: vi.fn(),
			abandoned: false,
		}
		;(provider as any).taskSlot.seedForTests(childTask)

		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		;(provider as any).updateTaskHistory = updateTaskHistory
		provider.getHistoryItem = vi
			.fn()
			.mockImplementation((id: string) =>
				Promise.resolve(
					id === "parent-1"
						? { id: "parent-1", status: "delegated", awaitingChildId: "child-1" }
						: { id: "child-1", status: "active", parentTaskId: "parent-1", rootTaskId: "parent-1" },
				),
			)
		const createWithHistory = vi.fn().mockResolvedValue(undefined)
		provider.createTaskWithHistoryItem = createWithHistory as any

		await provider.cancelTask()

		// Parent detached: delegated -> active, awaitingChildId cleared.
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "parent-1", status: "active", awaitingChildId: undefined }),
		)
		// Child rehydrated standalone (no live parentTask carried over).
		expect(createWithHistory).toHaveBeenCalledWith(expect.objectContaining({ parentTask: undefined }))
	})
})
