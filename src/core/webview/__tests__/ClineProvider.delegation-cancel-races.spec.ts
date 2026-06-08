import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"

// Mock dependencies (mirrors ClineProvider.flicker-free-cancel.spec.ts)
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

// Partial mocks of the persistence helpers so reopenParentFromDelegation's success path
// can run without touching disk. importOriginal preserves the other exports (e.g.
// TaskHistoryStore) the ClineProvider constructor depends on.
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
			rootTask: { taskId: "parent-1" },
			parentTask: { taskId: "parent-1" },
			isStreaming: false,
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
			cancelCurrentRequest: vi.fn(),
			abandoned: false,
		}
		;(provider as any).clineStack = [childTask]

		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		;(provider as any).updateTaskHistory = updateTaskHistory
		provider.getTaskWithId = vi.fn().mockImplementation((id: string) =>
			Promise.resolve({
				historyItem:
					id === "parent-1"
						? { id: "parent-1", status: "delegated", awaitingChildId: "child-1" }
						: { id: "child-1", status: "active", parentTaskId: "parent-1", rootTaskId: "parent-1" },
			}),
		)
		const createWithHistory = vi.fn().mockResolvedValue(undefined)
		provider.createTaskWithHistoryItem = createWithHistory as any

		await provider.cancelTask()

		// Parent detached: delegated -> active, awaitingChildId cleared.
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "parent-1", status: "active", awaitingChildId: undefined }),
		)
		// Child rehydrated standalone (no parentTask/rootTask carried over).
		expect(createWithHistory).toHaveBeenCalledWith(
			expect.objectContaining({ parentTask: undefined, rootTask: undefined }),
		)
	})

	it("reopenParentFromDelegation aborts (returns false) when parent no longer awaits this child", async () => {
		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		const fakeProvider: any = {
			contextProxy: { globalStorageUri: { fsPath: "/test/storage" } },
			cancelledDelegationChildIds: new Set<string>(),
			log: vi.fn(),
			updateTaskHistory,
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: { id: "parent-1", status: "active", awaitingChildId: undefined },
			}),
		}

		const result = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(fakeProvider, {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "done",
		})

		expect(result).toBe(false)
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	// Regression parity with the AttemptCompletionTool gate: a late background usage-drain
	// save can clobber the parent status "delegated" -> "active" while leaving awaitingChildId
	// pointing at this child. reopenParentFromDelegation must NOT treat that drift as a detach;
	// otherwise delegateToParent receives didReopen === false and the child finalizes the whole
	// task. See ai_plans/2026-06-08_delegated-subtask-no-return.md.
	it("reopenParentFromDelegation proceeds when status drifted to 'active' but awaitingChildId still points here", async () => {
		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		const fakeProvider: any = {
			contextProxy: { globalStorageUri: { fsPath: "/test/storage" } },
			cancelledDelegationChildIds: new Set<string>(),
			log: vi.fn(),
			updateTaskHistory,
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(undefined),
			emit: vi.fn(),
			getTaskWithId: vi.fn().mockImplementation((id: string) =>
				Promise.resolve({
					historyItem:
						id === "parent-1"
							? { id: "parent-1", status: "active", awaitingChildId: "child-1", childIds: [] }
							: { id: "child-1", status: "active" },
				}),
			),
		}

		const result = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(fakeProvider, {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "done",
		})

		// Guard passed despite the status drift: the delegation completed.
		expect(result).toBe(true)
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-1",
				status: "active",
				completedByChildId: "child-1",
				awaitingChildId: undefined,
			}),
		)
	})

	it("reopenParentFromDelegation aborts (returns false) when the parent is already completed", async () => {
		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		const fakeProvider: any = {
			contextProxy: { globalStorageUri: { fsPath: "/test/storage" } },
			cancelledDelegationChildIds: new Set<string>(),
			log: vi.fn(),
			updateTaskHistory,
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: { id: "parent-1", status: "completed", awaitingChildId: "child-1" },
			}),
		}

		const result = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(fakeProvider, {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "done",
		})

		expect(result).toBe(false)
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("reopenParentFromDelegation aborts (returns false) when the child was cancelled mid-approval", async () => {
		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		const fakeProvider: any = {
			contextProxy: { globalStorageUri: { fsPath: "/test/storage" } },
			cancelledDelegationChildIds: new Set<string>(["child-1"]),
			log: vi.fn(),
			updateTaskHistory,
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: { id: "parent-1", status: "delegated", awaitingChildId: "child-1" },
			}),
		}

		const result = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(fakeProvider, {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "done",
		})

		expect(result).toBe(false)
		expect(updateTaskHistory).not.toHaveBeenCalled()
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
