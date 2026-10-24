// pnpm --filter tumble-code test core/webview/__tests__/ClineProvider.reacquire.spec.ts

import * as vscode from "vscode"
import type { ExtensionState } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { createMockContext, createMockWebviewView, createTestProvider } from "./helpers/providerHarness"
import { TaskHistoryStore, type TaskHistoryStoreHandle } from "../../task-persistence"

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

vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockResolvedValue(undefined)
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				_destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(data)),
		),
	}
})

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
	Client: vi.fn().mockImplementation(function () {
		return {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({ tools: [] }),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
		}
	}),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(function () {
		return {
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		}
	}),
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
		default: vi.fn().mockImplementation(function () {
			return {
				initializeFilePaths: vi.fn(),
				dispose: vi.fn(),
			}
		}),
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

vi.mock("@tumble-code/cloud", () => ({
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
				on: vi.fn(),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				removeAllListeners: vi.fn(),
			}
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

// The acquire, cooldown and banner mechanics are pinned in TaskHistoryGateway.spec; this pins
// what reaches the webview through the provider.
describe("ClineProvider TaskHistoryStore reacquire", () => {
	let mockContext: vscode.ExtensionContext
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: ReturnType<typeof vi.fn>

	const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

	const makeHandle = (): TaskHistoryStoreHandle => {
		const records = new Map<string, any>()
		const store = {
			onChange: vi.fn(() => vi.fn()),
			migrateFromLegacyHistory: vi.fn().mockResolvedValue(true),
			get: vi.fn((id: string) => records.get(id)),
			getAll: vi.fn(() => Array.from(records.values())),
		} as unknown as TaskHistoryStore
		return { store, dispose: vi.fn() }
	}

	const pushedStates = (): ExtensionState[] =>
		mockPostMessage.mock.calls
			.map((call) => call[0])
			.filter((message: any) => message?.type === "state")
			.map((message: any) => message.state as ExtensionState)

	const waitForStatePush = async (
		predicate: (state: ExtensionState) => boolean,
		timeoutMs = 3000,
	): Promise<ExtensionState[]> => {
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			const found = pushedStates().filter(predicate)
			if (found.length > 0) {
				return found
			}
			await flush(10)
		}
		return pushedStates().filter(predicate)
	}

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockPostMessage = vi.fn()
		mockContext = createMockContext()
		mockWebviewView = createMockWebviewView(mockPostMessage)
	})

	afterEach(() => {
		TaskHistoryStore.resetSharedStoresForTests()
	})

	it("rejects once, then retries after the cooldown and clears the reported error", async () => {
		const handle = makeHandle()
		const acquire = vi
			.spyOn(TaskHistoryStore, "acquire")
			.mockRejectedValueOnce(new Error("deterministic acquire failure"))
			.mockResolvedValueOnce(handle)
		const provider = createTestProvider(mockContext)
		await provider.resolveWebviewView(mockWebviewView).catch(() => {})
		await flush()

		// The eager constructor acquire failed and was reported.
		expect((provider as any).taskHistory.storageErrorMessage).toBe(
			"TaskHistoryStore: deterministic acquire failure",
		)

		// Age out the failure so the next call performs a fresh acquire.
		;(provider as any).taskHistory.lastFailureTs = Date.now() - 6000

		const store = await (provider as any).getTaskHistoryStore()
		expect(store).toBe(handle.store)
		expect((provider as any).taskHistory.storageErrorMessage).toBe("")

		// The webview saw the error appear and then disappear.
		const errorStates = await waitForStatePush(
			(state) => state.storageErrorMessage === "TaskHistoryStore: deterministic acquire failure",
		)
		expect(errorStates.length).toBeGreaterThan(0)
		const clearedStates = await waitForStatePush((state) => state.storageErrorMessage === "")
		expect(clearedStates.length).toBeGreaterThan(0)

		await provider.dispose()
		acquire.mockRestore()
	})

	it("degrades getStateToPostToWebview to an empty history instead of throwing", async () => {
		const acquire = vi.spyOn(TaskHistoryStore, "acquire").mockRejectedValue(new Error("storage down"))
		const provider = createTestProvider(mockContext)
		await flush()

		const state = await provider.getStateToPostToWebview({ includeTaskHistory: true })
		expect(state.taskHistory).toEqual([])
		expect(state.currentTaskItem).toBeUndefined()
		expect(state.storageErrorMessage).toBe("TaskHistoryStore: storage down")

		// Every failed attempt went through the cooldown, so the store
		// registry was only touched once by the eager constructor acquire.
		expect(acquire).toHaveBeenCalledTimes(1)

		await provider.dispose()
		acquire.mockRestore()
	})
})
