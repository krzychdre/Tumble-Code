// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.taskHistory.spec.ts

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import type { HistoryItem, ExtensionMessage } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ContextProxy } from "../../config/ContextProxy"
import { ClineProvider } from "../ClineProvider"
import { TaskHistoryStore } from "../../task-persistence"

// Mock setup
vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
	readdir: vi.fn().mockResolvedValue([]),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

vi.mock("../../../utils/safeWriteJson", () => {
	const write = vi.fn().mockImplementation(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	})
	return {
		safeWriteJson: write,
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

// The JSON transaction gateway is mocked above; keep proper-lockfile inert for
// unrelated safe-write call sites in these provider-wiring specs.
vi.mock("proper-lockfile", () => ({
	lock: vi.fn(async () => async () => {}),
	unlock: vi.fn(async () => {}),
	check: vi.fn(async () => false),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: {
		InvalidRequest: "InvalidRequest",
		MethodNotFound: "MethodNotFound",
		InternalError: "InternalError",
	},
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
	})),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		})),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options: any) => ({
		api: undefined,
		abortTask: vi.fn(),
		handleWebviewAskResponse: vi.fn(),
		clineMessages: [],
		apiConversationHistory: [],
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
		getTaskNumber: vi.fn().mockReturnValue(0),
		setTaskNumber: vi.fn(),
		setParentTask: vi.fn(),
		setRootTask: vi.fn(),
		taskId: options?.historyItem?.id || "test-task-id",
		emit: vi.fn(),
	})),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("file content"),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [{ slug: "code", name: "Code Mode", roleDefinition: "You are a code assistant", groups: ["read", "edit"] }],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockReturnValue("General Tools"),
	defaultModeSlug: "code",
}))

vi.mock("../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				getAllowList: vi.fn().mockResolvedValue("*"),
				getUserInfo: vi.fn().mockReturnValue(null),
				canShareTask: vi.fn().mockResolvedValue(false),
				canSharePublicly: vi.fn().mockResolvedValue(false),
				getOrganizationSettings: vi.fn().mockReturnValue(null),
				getOrganizationMemberships: vi.fn().mockResolvedValue([]),
				getUserSettings: vi.fn().mockReturnValue(null),
				isTaskSyncEnabled: vi.fn().mockReturnValue(false),
				// EventEmitter stubs used by ClineProvider's cloud listener
				// (un)subscription. `off` is called on dispose.
				on: vi.fn(),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				removeAllListeners: vi.fn(),
			}
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
	getRooCodeProviderUrl: vi.fn().mockReturnValue("http://localhost:8080/proxy"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider Task History Synchronization", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, any> = {
			mode: "code",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: any) => {
					globalState[key] = value
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Wait for the async TaskHistoryStore initialization to complete
		// (fire-and-forget from the constructor; microtasks need to flush)
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock the custom modes manager
		;(provider as any).customModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock getMcpHub
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	afterEach(() => {
		// The shared TaskHistoryStore lives in a process-wide registry keyed
		// by storage path; every provider in this spec uses the same
		// "/test/storage/path", so reset between cases to keep them isolated.
		TaskHistoryStore.resetSharedStoresForTests()
	})

	// Helper to create valid HistoryItem with required fields
	const createHistoryItem = (overrides: Partial<HistoryItem> & { id: string; task: string }): HistoryItem => ({
		number: 1,
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
		...overrides,
	})

	// Helper to find calls by message type
	const findCallsByType = (calls: any[][], type: string) => {
		return calls.filter((call) => call[0]?.type === type)
	}

	// Helper to build a mock WebviewView with the given postMessage spy. Used
	// to construct a second provider's view in the cross-provider tests.
	const makeMockWebviewView = (postMessage: ReturnType<typeof vi.fn>): vscode.WebviewView =>
		({
			webview: {
				postMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		}) as unknown as vscode.WebviewView

	const deferred = <T>() => {
		let resolve!: (value: T) => void
		let reject!: (reason?: unknown) => void
		const promise = new Promise<T>((res, rej) => {
			resolve = res
			reject = rej
		})
		return { promise, resolve, reject }
	}

	const makeReadyStoreHandle = () => {
		const records = new Map<string, HistoryItem>()
		const store = {
			onChange: vi.fn(() => vi.fn()),
			migrateFromLegacyHistory: vi.fn().mockResolvedValue(true),
			upsert: vi.fn(async (item: HistoryItem) => records.set(item.id, item)),
			get: vi.fn((id: string) => records.get(id)),
			getAll: vi.fn(() => Array.from(records.values())),
		} as unknown as TaskHistoryStore
		return { store, dispose: vi.fn() }
	}

	describe("TaskHistoryStore readiness gate", () => {
		it("waits for delayed acquire before an early operation dereferences the store", async () => {
			const pending = deferred<ReturnType<typeof makeReadyStoreHandle>>()
			const acquire = vi.spyOn(TaskHistoryStore, "acquire").mockReturnValueOnce(pending.promise)
			const earlyProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"editor",
				new ContextProxy(mockContext),
			)
			const item = createHistoryItem({ id: "early-write", task: "Early write" })

			const operation = earlyProvider.updateTaskHistory(item, { broadcast: false })
			const handle = makeReadyStoreHandle()
			expect(handle.store.upsert).not.toHaveBeenCalled()
			pending.resolve(handle)
			await operation

			expect(handle.store.upsert).toHaveBeenCalledWith(item, expect.any(Symbol))
			await earlyProvider.dispose()
			acquire.mockRestore()
		})

		it("propagates acquire failure to an operation instead of using an uninitialized field", async () => {
			const acquire = vi
				.spyOn(TaskHistoryStore, "acquire")
				.mockRejectedValueOnce(new Error("deterministic acquire failure"))
			const failedProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"editor",
				new ContextProxy(mockContext),
			)

			await expect(
				failedProvider.updateTaskHistory(createHistoryItem({ id: "failed", task: "Failed" }), {
					broadcast: false,
				}),
			).rejects.toThrow("deterministic acquire failure")

			await failedProvider.dispose()
			acquire.mockRestore()
		})

		it("releases a late store without subscribing or migrating when disposed before acquire resolves", async () => {
			const pending = deferred<ReturnType<typeof makeReadyStoreHandle>>()
			const acquire = vi.spyOn(TaskHistoryStore, "acquire").mockReturnValueOnce(pending.promise)
			const disposedProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"editor",
				new ContextProxy(mockContext),
			)
			await disposedProvider.dispose()
			const handle = makeReadyStoreHandle()

			pending.resolve(handle)
			await vi.waitFor(() => expect(handle.dispose).toHaveBeenCalledTimes(1))

			expect(handle.store.onChange).not.toHaveBeenCalled()
			expect(handle.store.migrateFromLegacyHistory).not.toHaveBeenCalled()
			acquire.mockRestore()
		})

		it("allows a new provider to acquire successfully after another provider's acquire failure", async () => {
			const handle = makeReadyStoreHandle()
			const acquire = vi
				.spyOn(TaskHistoryStore, "acquire")
				.mockRejectedValueOnce(new Error("first provider failed"))
				.mockResolvedValueOnce(handle)
			const failedProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"editor",
				new ContextProxy(mockContext),
			)
			await expect(failedProvider.getTaskHistory()).rejects.toThrow("first provider failed")

			const retryProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"editor",
				new ContextProxy(mockContext),
			)
			await expect(retryProvider.getTaskHistory()).resolves.toEqual([])

			await failedProvider.dispose()
			await retryProvider.dispose()
			expect(handle.dispose).toHaveBeenCalledTimes(1)
			acquire.mockRestore()
		})
	})

	describe("legacy cleanup gate", () => {
		it("does not clear legacy keys when disk migration reports a schema or I/O failure", async () => {
			const clearLegacyTaskHistoryKeys = vi.fn()
			const migrationStore = {
				migrateFromLegacyHistory: vi.fn().mockResolvedValue(false),
			}
			const migrationProvider = {
				getTaskHistoryStore: vi.fn().mockResolvedValue(migrationStore),
				contextProxy: {
					hasLegacyTaskHistory: vi.fn().mockReturnValue(true),
					getLegacyTaskHistory: vi
						.fn()
						.mockReturnValue([createHistoryItem({ id: "legacy-retained", task: "Retained" })]),
					clearLegacyTaskHistoryKeys,
				},
				log: vi.fn(),
			}

			await (ClineProvider.prototype as any).initializeTaskHistoryStore.call(migrationProvider)

			expect(migrationStore.migrateFromLegacyHistory).toHaveBeenCalledTimes(1)
			expect(clearLegacyTaskHistoryKeys).not.toHaveBeenCalled()
		})
	})

	describe("updateTaskHistory", () => {
		it("persists only through TaskHistoryStore, not globalState", async () => {
			vi.mocked(mockContext.globalState.update).mockClear()

			await provider.updateTaskHistory(createHistoryItem({ id: "store-only", task: "Store-only task" }), {
				broadcast: false,
			})

			expect((await (provider as any).getTaskHistoryStore()).get("store-only")).toBeDefined()
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith("taskHistory", expect.anything())
		})

		it("broadcasts task history update by default", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-1",
				task: "Test task",
			})

			await provider.updateTaskHistory(historyItem)

			// Should have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBeGreaterThanOrEqual(1)

			const lastCall = taskHistoryItemUpdatedCalls[taskHistoryItemUpdatedCalls.length - 1]
			expect(lastCall[0].type).toBe("taskHistoryItemUpdated")
			expect(lastCall[0].taskHistoryItem).toBeDefined()
			expect(lastCall[0].taskHistoryItem.id).toBe("task-1")
		})

		it("does not broadcast when broadcast option is false", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Clear previous calls
			mockPostMessage.mockClear()

			const historyItem = createHistoryItem({
				id: "task-2",
				task: "Test task 2",
			})

			await provider.updateTaskHistory(historyItem, { broadcast: false })

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("does not broadcast when view is not launched", async () => {
			// Do not resolve webview and keep isViewLaunched false
			provider.isViewLaunched = false

			const historyItem = createHistoryItem({
				id: "task-3",
				task: "Test task 3",
			})

			await provider.updateTaskHistory(historyItem)

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("preserves delegated metadata on partial update unless explicitly overwritten (UTH-02)", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const initial = createHistoryItem({
				id: "task-delegated-metadata",
				task: "Delegated task",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: ["child-1"],
			})

			await provider.updateTaskHistory(initial, { broadcast: false })

			// Partial update intentionally omits delegated metadata fields.
			const partialUpdate: HistoryItem = {
				...createHistoryItem({ id: "task-delegated-metadata", task: "Delegated task (updated)" }),
				status: "active",
			}

			await provider.updateTaskHistory(partialUpdate, { broadcast: false })
			// updateTaskHistory is void; read the updated item from the store.
			const updatedItem = (await (provider as any).getTaskHistoryStore()).get("task-delegated-metadata")

			expect(updatedItem).toBeDefined()
			expect(updatedItem?.status).toBe("active")
			expect(updatedItem?.delegatedToId).toBe("child-1")
			expect(updatedItem?.awaitingChildId).toBe("child-1")
			expect(updatedItem?.childIds).toEqual(["child-1"])
		})

		it("invalidates recentTasksCache on updateTaskHistory (UTH-04)", async () => {
			const workspace = provider.cwd
			const tsBase = Date.now()

			await provider.updateTaskHistory(
				createHistoryItem({
					id: "cache-seed",
					task: "Cache seed",
					workspace,
					ts: tsBase,
				}),
				{ broadcast: false },
			)

			const initialRecent = await provider.getRecentTasks()
			expect(initialRecent).toContain("cache-seed")

			// Prime cache and verify internal cache is set.
			expect((provider as unknown as { recentTasksCache?: string[] }).recentTasksCache).toEqual(initialRecent)

			await provider.updateTaskHistory(
				createHistoryItem({
					id: "cache-new",
					task: "Cache new",
					workspace,
					ts: tsBase + 1,
				}),
				{ broadcast: false },
			)

			// Direct assertion for invalidation side-effect.
			expect((provider as unknown as { recentTasksCache?: string[] }).recentTasksCache).toBeUndefined()

			const recomputedRecent = await provider.getRecentTasks()
			expect(recomputedRecent).toContain("cache-new")
		})

		it("updates existing task in history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-update",
				task: "Original task",
			})

			await provider.updateTaskHistory(historyItem)

			// Update the same task
			const updatedItem: HistoryItem = {
				...historyItem,
				task: "Updated task",
				tokensIn: 200,
			}

			await provider.updateTaskHistory(updatedItem)

			// Verify the update was persisted in the store
			const storeHistory = (await (provider as any).getTaskHistoryStore()).getAll()
			expect(storeHistory).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: "task-update", task: "Updated task" })]),
			)

			// Should not have duplicates
			const matchingItems = storeHistory.filter((item: HistoryItem) => item.id === "task-update")
			expect(matchingItems.length).toBe(1)
		})

		it("returns the updated task history array", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-return",
				task: "Return test task",
			})

			await provider.updateTaskHistory(historyItem)

			// updateTaskHistory is void; verify persistence via the store.
			const taskHistoryStore = await (provider as any).getTaskHistoryStore()
			expect(taskHistoryStore.get("task-return")).toBeDefined()
			expect(taskHistoryStore.get("task-return")?.id).toBe("task-return")
		})
	})

	describe("broadcastTaskHistoryUpdate", () => {
		it("sends taskHistoryUpdated message with sorted history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "old", ts: now - 10000, task: "Old task" }),
				createHistoryItem({ id: "new", ts: now, task: "New task", number: 2 }),
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "taskHistoryUpdated",
					taskHistory: expect.any(Array),
				}),
			)

			// Verify the history is sorted (newest first)
			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]
			expect(sentHistory[0].id).toBe("new") // Newest should be first
			expect(sentHistory[1].id).toBe("old") // Oldest should be second
		})

		it("filters out invalid history items", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "valid", ts: now, task: "Valid task" }),
				createHistoryItem({ id: "no-ts", ts: 0, task: "No timestamp", number: 2 }), // Invalid: ts is 0/falsy
				createHistoryItem({ id: "no-task", ts: now, task: "", number: 3 }), // Invalid: empty task
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			// Only valid item should be included
			expect(sentHistory.length).toBe(1)
			expect(sentHistory[0].id).toBe("valid")
		})

		it("reads from store when no history is provided", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Populate the store with an item
			const now = Date.now()
			await provider.updateTaskHistory(createHistoryItem({ id: "from-store", ts: now, task: "Store task" }), {
				broadcast: false,
			})

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate()

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			expect(sentHistory.length).toBeGreaterThanOrEqual(1)
			expect(sentHistory.some((item) => item.id === "from-store")).toBe(true)
		})
	})

	describe("task history includes all workspaces", () => {
		it("getStateToPostToWebview returns tasks from all workspaces", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const now = Date.now()

			// Populate the store with multi-workspace items
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws1-task",
					ts: now,
					task: "Workspace 1 task",
					workspace: "/path/to/workspace1",
				}),
				{ broadcast: false },
			)
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws2-task",
					ts: now - 1000,
					task: "Workspace 2 task",
					workspace: "/path/to/workspace2",
					number: 2,
				}),
				{ broadcast: false },
			)
			await provider.updateTaskHistory(
				createHistoryItem({
					id: "ws3-task",
					ts: now - 2000,
					task: "Workspace 3 task",
					workspace: "/different/workspace",
					number: 3,
				}),
				{ broadcast: false },
			)

			const state = await provider.getStateToPostToWebview()

			// All tasks from all workspaces should be included
			expect(state.taskHistory.length).toBe(3)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace1")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace2")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/different/workspace")).toBe(true)
		})
	})

	describe("taskHistory write lock (mutex)", () => {
		it("serializes concurrent updateTaskHistory calls so no entries are lost", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Fire 5 concurrent updateTaskHistory calls
			const items = Array.from({ length: 5 }, (_, i) =>
				createHistoryItem({ id: `concurrent-${i}`, task: `Task ${i}` }),
			)

			await Promise.all(items.map((item) => provider.updateTaskHistory(item, { broadcast: false })))

			// All 5 entries must survive (read from store, not debounced globalState)
			const history = (await (provider as any).getTaskHistoryStore()).getAll()
			const ids = history.map((h: HistoryItem) => h.id)
			for (const item of items) {
				expect(ids).toContain(item.id)
			}
			expect(history.length).toBe(5)
		})

		it("serializes concurrent update and deleteTaskFromState so they don't corrupt each other", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Seed with two items
			const keep = createHistoryItem({ id: "keep-me", task: "Keep" })
			const remove = createHistoryItem({ id: "remove-me", task: "Remove" })
			await provider.updateTaskHistory(keep, { broadcast: false })
			await provider.updateTaskHistory(remove, { broadcast: false })

			// Concurrently: add a new item AND delete "remove-me"
			const newItem = createHistoryItem({ id: "new-item", task: "New" })
			await Promise.all([
				provider.updateTaskHistory(newItem, { broadcast: false }),
				provider.deleteTaskFromState("remove-me"),
			])

			const history = (await (provider as any).getTaskHistoryStore()).getAll()
			const ids = history.map((h: HistoryItem) => h.id)
			expect(ids).toContain("keep-me")
			expect(ids).toContain("new-item")
			expect(ids).not.toContain("remove-me")
		})

		it("does not block subsequent writes when a previous store write errors", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Temporarily make the store's atomic writer throw
			const { safeWriteJson } = await import("../../../utils/safeWriteJson")
			const mockSafeWriteJson = vi.mocked(safeWriteJson)
			let callCount = 0
			mockSafeWriteJson.mockImplementation(async () => {
				callCount++
				if (callCount === 1) {
					throw new Error("simulated write failure")
				}
			})

			// First call should fail (store write failure)
			const item1 = createHistoryItem({ id: "fail-item", task: "Fail" })
			await expect(provider.updateTaskHistory(item1, { broadcast: false })).rejects.toThrow(
				"simulated write failure",
			)

			// Restore mock
			mockSafeWriteJson.mockResolvedValue(undefined)

			// Second call should still succeed (store lock not stuck)
			const item2 = createHistoryItem({ id: "ok-item", task: "OK" })
			await provider.updateTaskHistory(item2, { broadcast: false })
			// updateTaskHistory is void; verify the item landed in the store.
			expect((await (provider as any).getTaskHistoryStore()).get("ok-item")).toBeDefined()
		})

		it("serializes concurrent updates to the same item preserving the last write", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const base = createHistoryItem({ id: "race-item", task: "Original" })
			await provider.updateTaskHistory(base, { broadcast: false })

			// Fire two concurrent updates to the same item
			await Promise.all([
				provider.updateTaskHistory(createHistoryItem({ id: "race-item", task: "Original", tokensIn: 111 }), {
					broadcast: false,
				}),
				provider.updateTaskHistory(createHistoryItem({ id: "race-item", task: "Original", tokensIn: 222 }), {
					broadcast: false,
				}),
			])

			const history = (await (provider as any).getTaskHistoryStore()).getAll()
			const item = history.find((h: HistoryItem) => h.id === "race-item")
			expect(item).toBeDefined()
			// The second write (tokensIn: 222) should be the last one since writes are serialized
			expect(item!.tokensIn).toBe(222)
		})
	})

	describe("cross-provider propagation (shared store)", () => {
		it("does not leave a suppression marker when writing before the webview starts", async () => {
			await provider.updateTaskHistory(createHistoryItem({ id: "before-view", task: "Before view" }), {
				broadcast: false,
			})
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true
			mockPostMessage.mockClear()

			const otherOrigin = Symbol("other-provider")
			await (
				await (provider as any).getTaskHistoryStore()
			).upsert(createHistoryItem({ id: "before-view", task: "After view" }), otherOrigin)
			const updates = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")
			expect(updates).toHaveLength(1)
			expect(updates[0][0].taskHistoryItem.task).toBe("After view")
		})

		it("routes concurrent same-ID writes by origin token without cross-suppressing providers", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true
			const providerB = new ClineProvider(mockContext, mockOutputChannel, "editor", new ContextProxy(mockContext))
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(makeMockWebviewView(mockPostMessageB))
			providerB.isViewLaunched = true
			mockPostMessage.mockClear()
			mockPostMessageB.mockClear()

			await Promise.all([
				provider.updateTaskHistory(createHistoryItem({ id: "same-id-origin", task: "A" })),
				providerB.updateTaskHistory(createHistoryItem({ id: "same-id-origin", task: "B" })),
			])

			expect(findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")).toHaveLength(2)
			expect(findCallsByType(mockPostMessageB.mock.calls, "taskHistoryItemUpdated")).toHaveLength(2)
			expect(findCallsByType(mockPostMessage.mock.calls, "taskHistoryUpdated")).toHaveLength(0)
			expect(findCallsByType(mockPostMessageB.mock.calls, "taskHistoryUpdated")).toHaveLength(0)
			providerB.dispose()
		})

		it("a local upsert by provider A pushes a targeted update to provider B (no full broadcast to B), and no double to A", async () => {
			// Two providers sharing the same storage path share one store.
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Second provider on the same storage path -> same shared store.
			const providerB = new ClineProvider(mockContext, mockOutputChannel, "editor", new ContextProxy(mockContext))
			await new Promise((resolve) => setTimeout(resolve, 10))
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(makeMockWebviewView(mockPostMessageB))
			providerB.isViewLaunched = true
			;(providerB as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			providerB.getMcpHub = vi.fn().mockReturnValue({
				listTools: vi.fn().mockResolvedValue([]),
				callTool: vi.fn().mockResolvedValue({ content: [] }),
				listResources: vi.fn().mockResolvedValue([]),
				readResource: vi.fn().mockResolvedValue({ contents: [] }),
				getAllServers: vi.fn().mockReturnValue([]),
			})

			// Both share the same store instance.
			expect(await (providerB as any).getTaskHistoryStore()).toBe(await (provider as any).getTaskHistoryStore())

			mockPostMessage.mockClear()
			mockPostMessageB.mockClear()

			// Provider A upserts an item.
			await provider.updateTaskHistory(createHistoryItem({ id: "shared-upsert", task: "Shared" }))

			// A: exactly one targeted taskHistoryItemUpdated for the item (its
			// own broadcast), and the onChange echo is suppressed for A.
			const aUpdated = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")
			expect(aUpdated.length).toBe(1)
			expect(aUpdated[0][0].taskHistoryItem.id).toBe("shared-upsert")
			// A should NOT receive a full taskHistoryUpdated broadcast for its
			// own local mutation.
			const aFullBroadcast = findCallsByType(mockPostMessage.mock.calls, "taskHistoryUpdated")
			expect(aFullBroadcast.length).toBe(0)

			// B: receives the targeted taskHistoryItemUpdated from the shared
			// store's onChange (external:false, not B's own), but NO full
			// broadcast (it's a local mutation, just not B's).
			const bUpdated = findCallsByType(mockPostMessageB.mock.calls, "taskHistoryItemUpdated")
			expect(bUpdated.length).toBeGreaterThanOrEqual(1)
			expect(bUpdated[bUpdated.length - 1][0].taskHistoryItem.id).toBe("shared-upsert")
			const bFullBroadcast = findCallsByType(mockPostMessageB.mock.calls, "taskHistoryUpdated")
			expect(bFullBroadcast.length).toBe(0)

			providerB.dispose()
		})

		it("a local delete by provider A pushes a targeted delete to provider B (no full broadcast to B), and no double to A", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Seed an item via A.
			await provider.updateTaskHistory(createHistoryItem({ id: "shared-del", task: "Shared" }), {
				broadcast: false,
			})
			expect((await (provider as any).getTaskHistoryStore()).get("shared-del")).toBeDefined()

			const providerB = new ClineProvider(mockContext, mockOutputChannel, "editor", new ContextProxy(mockContext))
			await new Promise((resolve) => setTimeout(resolve, 10))
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(makeMockWebviewView(mockPostMessageB))
			providerB.isViewLaunched = true
			;(providerB as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			providerB.getMcpHub = vi.fn().mockReturnValue({
				listTools: vi.fn().mockResolvedValue([]),
				callTool: vi.fn().mockResolvedValue({ content: [] }),
				listResources: vi.fn().mockResolvedValue([]),
				readResource: vi.fn().mockResolvedValue({ contents: [] }),
				getAllServers: vi.fn().mockReturnValue([]),
			})

			mockPostMessage.mockClear()
			mockPostMessageB.mockClear()

			// Provider A deletes the item.
			await provider.deleteTaskFromState("shared-del")
			expect((await (provider as any).getTaskHistoryStore()).get("shared-del")).toBeUndefined()

			// A: exactly one targeted taskHistoryItemDeleted for the item (its
			// own broadcast); the onChange echo is suppressed for A.
			const aDeleted = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemDeleted")
			expect(aDeleted.length).toBe(1)
			expect(aDeleted[0][0].taskHistoryItemId).toBe("shared-del")
			const aFullBroadcast = findCallsByType(mockPostMessage.mock.calls, "taskHistoryUpdated")
			expect(aFullBroadcast.length).toBe(0)

			// B: receives the targeted taskHistoryItemDeleted from the shared
			// store's onChange, but NO full broadcast.
			const bDeleted = findCallsByType(mockPostMessageB.mock.calls, "taskHistoryItemDeleted")
			expect(bDeleted.length).toBeGreaterThanOrEqual(1)
			expect(bDeleted[bDeleted.length - 1][0].taskHistoryItemId).toBe("shared-del")
			const bFullBroadcast = findCallsByType(mockPostMessageB.mock.calls, "taskHistoryUpdated")
			expect(bFullBroadcast.length).toBe(0)

			providerB.dispose()
		})

		it("disposing one provider does not break the other's store subscription", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const providerB = new ClineProvider(mockContext, mockOutputChannel, "editor", new ContextProxy(mockContext))
			await new Promise((resolve) => setTimeout(resolve, 10))
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(makeMockWebviewView(mockPostMessageB))
			providerB.isViewLaunched = true
			;(providerB as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			providerB.getMcpHub = vi.fn().mockReturnValue({
				listTools: vi.fn().mockResolvedValue([]),
				callTool: vi.fn().mockResolvedValue({ content: [] }),
				listResources: vi.fn().mockResolvedValue([]),
				readResource: vi.fn().mockResolvedValue({ contents: [] }),
				getAllServers: vi.fn().mockReturnValue([]),
			})

			// Dispose A. The shared store must keep running for B (B's
			// subscription stays alive; this is the last-consumer refcount
			// teardown guard).
			provider.dispose()

			// B's store subscription must still work: a write via B fires B's
			// targeted update. Use the store directly to avoid providerA.
			mockPostMessageB.mockClear()
			await providerB.updateTaskHistory(createHistoryItem({ id: "after-a-dispose", task: "Survivor" }))
			const bUpdated = findCallsByType(mockPostMessageB.mock.calls, "taskHistoryItemUpdated")
			expect(bUpdated.length).toBeGreaterThanOrEqual(1)
			expect((await (providerB as any).getTaskHistoryStore()).get("after-a-dispose")).toBeDefined()

			providerB.dispose()
		})
	})

	describe("lazy state — without-history path never calls getAll()", () => {
		it("postStateToWebviewWithoutTaskHistory does not call taskHistoryStore.getAll()", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const getAllSpy = vi.spyOn(await (provider as any).getTaskHistoryStore(), "getAll")

			await provider.postStateToWebviewWithoutTaskHistory()

			// The without-history path must NOT materialize/sort the full
			// history. Zero getAll() calls.
			expect(getAllSpy).not.toHaveBeenCalled()

			getAllSpy.mockRestore()
		})

		it("postStateToWebviewWithoutClineMessages does not call taskHistoryStore.getAll()", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const getAllSpy = vi.spyOn(await (provider as any).getTaskHistoryStore(), "getAll")

			await provider.postStateToWebviewWithoutClineMessages()

			expect(getAllSpy).not.toHaveBeenCalled()

			getAllSpy.mockRestore()
		})

		it("postStateToWebview (full state) DOES call getAll() and includes history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			await provider.updateTaskHistory(createHistoryItem({ id: "full-state-task", task: "Full" }), {
				broadcast: false,
			})

			const getAllSpy = vi.spyOn(await (provider as any).getTaskHistoryStore(), "getAll")

			await provider.postStateToWebview()

			// The full-state path must include the sorted history.
			expect(getAllSpy).toHaveBeenCalled()
			const stateCall = mockPostMessage.mock.calls.find((c) => c[0]?.type === "state")
			expect(stateCall).toBeDefined()
			expect(stateCall![0].state.taskHistory.length).toBeGreaterThanOrEqual(1)
			expect((stateCall![0].state.taskHistory as HistoryItem[]).some((h) => h.id === "full-state-task")).toBe(
				true,
			)

			getAllSpy.mockRestore()
		})
	})
})
