// pnpm --filter tumble-code test core/webview/__tests__/ClineProvider.taskHistory.spec.ts

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import type { ClineMessage, HistoryItem, ExtensionMessage } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { ClineProvider } from "../ClineProvider"
import { createMockContext, createMockWebviewView, createTestProvider } from "./helpers/providerHarness"
import { webviewMessageHandler } from "../webviewMessageHandler"
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

vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockImplementation(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	})
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
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
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider Task History Synchronization", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockPostMessage = vi.fn()
		mockContext = createMockContext()
		mockWebviewView = createMockWebviewView(mockPostMessage)

		provider = createTestProvider(mockContext)

		// Wait for the async TaskHistoryStore initialization to complete
		// (fire-and-forget from the constructor; microtasks need to flush)
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock the custom modes manager
		;(provider as any).customModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}
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
			const earlyProvider = createTestProvider(mockContext, "editor")
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
	})

	it("the posted state lists the tasks of every workspace", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		for (const [id, workspace] of [
			["ws1-task", "/path/to/workspace1"],
			["ws2-task", "/different/workspace"],
		]) {
			await provider.updateTaskHistory(createHistoryItem({ id, task: id, workspace }), { broadcast: false })
		}

		const state = await provider.getStateToPostToWebview()

		expect(state.taskHistory.map((item: HistoryItem) => item.id).sort()).toEqual(["ws1-task", "ws2-task"])
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
			const providerB = createTestProvider(mockContext, "editor")
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(createMockWebviewView(mockPostMessageB))
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

		it("disposing one provider does not break the other's store subscription", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const providerB = createTestProvider(mockContext, "editor")
			await new Promise((resolve) => setTimeout(resolve, 10))
			const mockPostMessageB = vi.fn()
			await providerB.resolveWebviewView(createMockWebviewView(mockPostMessageB))
			providerB.isViewLaunched = true
			;(providerB as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}

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
		it.each([
			["postStateToWebviewWithoutTaskHistory", (p: ClineProvider) => p.postStateToWebviewWithoutTaskHistory()],
			[
				"postStateToWebviewWithoutClineMessages",
				(p: ClineProvider) => p.postStateToWebviewWithoutClineMessages(),
			],
		])("%s does not call taskHistoryStore.getAll()", async (_name, post) => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true
			const getAllSpy = vi.spyOn(await (provider as any).getTaskHistoryStore(), "getAll")

			await post(provider)

			expect(getAllSpy).not.toHaveBeenCalled()
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

	describe("full state pushes carry the task history only when it changed since the last push to the view (CORE-R7)", () => {
		const statePushes = (post: ReturnType<typeof vi.fn> = mockPostMessage) =>
			post.mock.calls.map((call) => call[0]).filter((message) => message?.type === "state")
		const lastState = (post: ReturnType<typeof vi.fn> = mockPostMessage) => statePushes(post).at(-1)!.state
		const historyIds = (state: { taskHistory?: HistoryItem[] }) => state.taskHistory?.map((item) => item.id)
		const storeIds = async () =>
			((await (provider as any).getTaskHistoryStore()) as TaskHistoryStore)
				.getAll()
				.filter((item) => item.ts && item.task)
				.map((item) => item.id)

		const launchView = async (target: ClineProvider = provider, view: vscode.WebviewView = mockWebviewView) => {
			await target.resolveWebviewView(view)
			target.isViewLaunched = true
		}

		beforeEach(async () => {
			await provider.updateTaskHistory(createHistoryItem({ id: "push-a", task: "A", ts: 1_000 }), {
				broadcast: false,
			})
			await provider.updateTaskHistory(createHistoryItem({ id: "push-b", task: "B", ts: 2_000 }), {
				broadcast: false,
			})
		})

		it("the first full push carries the whole history; a push with nothing changed omits the key and keeps the rest", async () => {
			await launchView()
			mockPostMessage.mockClear()

			await provider.postStateToWebview()
			expect(historyIds(lastState())).toEqual(["push-b", "push-a"])

			await provider.postStateToWebview()
			const second = lastState()
			expect("taskHistory" in second).toBe(false)
			// Everything else is still a full state.
			expect(second).toHaveProperty("mode")
			expect(second).toHaveProperty("clineMessages")
			expect(second).toHaveProperty("currentTaskId")
		})

		it("every history writer makes the next full push carry the current history", async () => {
			await launchView()
			await provider.postStateToWebview()
			const store = (await (provider as any).getTaskHistoryStore()) as TaskHistoryStore

			// atomicReadAndUpdate reads the record from disk, which this spec's fs
			// mock cannot serve; the store spec pins that it changes the revision.
			const writers: Array<[string, () => Promise<unknown>]> = [
				[
					"updateTaskHistory (broadcast)",
					() => provider.updateTaskHistory(createHistoryItem({ id: "push-c", task: "C", ts: 3_000 })),
				],
				[
					"updateTaskHistory (no broadcast)",
					() =>
						provider.updateTaskHistory(createHistoryItem({ id: "push-c", task: "C2", ts: 3_000 }), {
							broadcast: false,
						}),
				],
				[
					"another provider's write to the shared store",
					() => store.upsert(createHistoryItem({ id: "push-d", task: "D", ts: 4_000 }), Symbol("other")),
				],
				["another provider's delete", () => store.delete("push-d", Symbol("other"))],
				["an external change picked up by the store", async () => store.invalidateAll()],
			]

			for (const [name, write] of writers) {
				await provider.postStateToWebview()
				expect("taskHistory" in lastState(), `${name}: settled before the write`).toBe(false)

				await write()
				mockPostMessage.mockClear()
				await provider.postStateToWebview()

				expect(historyIds(lastState()), name).toEqual(await storeIds())
			}
		})

		it("deleteTaskFromState's own full push carries the history without the deleted task", async () => {
			await launchView()
			await provider.postStateToWebview()
			mockPostMessage.mockClear()

			await provider.deleteTaskFromState("push-a")

			expect(historyIds(lastState())).toEqual(["push-b"])
		})

		it("a push without the history does not count as having delivered it", async () => {
			await launchView()
			await provider.postStateToWebview()
			await provider.updateTaskHistory(createHistoryItem({ id: "push-e", task: "E", ts: 5_000 }), {
				broadcast: false,
			})

			await provider.postStateToWebviewWithoutTaskHistory()
			await provider.postStateToWebviewWithoutClineMessages()
			mockPostMessage.mockClear()
			await provider.postStateToWebview()

			expect(historyIds(lastState())).toEqual(["push-e", "push-b", "push-a"])
		})

		it("webviewDidLaunch (a reloaded webview) always receives the whole history", async () => {
			await launchView()
			await provider.postStateToWebview()
			await provider.postStateToWebview()
			expect("taskHistory" in lastState()).toBe(false)
			mockPostMessage.mockClear()

			await webviewMessageHandler(provider, { type: "webviewDidLaunch" })
			await vi.waitFor(() => expect(statePushes()).toHaveLength(1))

			expect(historyIds(lastState())).toEqual(["push-b", "push-a"])
		})

		it("a new webview resolved for the same provider receives the whole history", async () => {
			await launchView()
			await provider.postStateToWebview()

			const newPost = vi.fn()
			await launchView(provider, createMockWebviewView(newPost))
			await provider.postStateToWebview()

			expect(historyIds(lastState(newPost))).toEqual(["push-b", "push-a"])
		})

		it("each view keeps its own record: the tab panel's first push carries the history the sidebar already has", async () => {
			await launchView()
			await provider.postStateToWebview()

			const tab = createTestProvider(mockContext, "editor")
			;(tab as any).customModesManager = (provider as any).customModesManager
			tab.getMcpHub = provider.getMcpHub
			const tabPost = vi.fn()
			await launchView(tab, createMockWebviewView(tabPost))
			await tab.postStateToWebview()

			expect(historyIds(lastState(tabPost))).toEqual(["push-b", "push-a"])
			await tab.dispose()
		})

		it("the updatePrompt handler's full push follows the same rule", async () => {
			await launchView()
			await provider.postStateToWebview()
			mockPostMessage.mockClear()

			await webviewMessageHandler(provider, {
				type: "updatePrompt",
				promptMode: "code",
				customPrompt: { roleDefinition: "be brief" },
			})

			const state = lastState()
			expect("taskHistory" in state).toBe(false)
			expect(state.customModePrompts?.code).toEqual({ roleDefinition: "be brief" })
		})

		it("an unavailable store sends an empty history, and the first push after it recovers sends the whole one", async () => {
			await launchView()
			await provider.postStateToWebview()
			const getStore = vi
				.spyOn(provider as any, "getTaskHistoryStore")
				.mockRejectedValueOnce(new Error("disk gone"))
			mockPostMessage.mockClear()

			await provider.postStateToWebview()
			expect(lastState().taskHistory).toEqual([])

			await provider.postStateToWebview()
			expect(historyIds(lastState())).toEqual(["push-b", "push-a"])
			getStore.mockRestore()
		})
	})

	describe("chat messages: a view that accepts messageAdded gets only the new message (CORE-R7)", () => {
		type FakeTask = { taskId: string; clineMessages: ClineMessage[]; todoList: unknown[] }
		const makeTask = (taskId: string, count: number): FakeTask => ({
			taskId,
			clineMessages: Array.from({ length: count }, (_, i) => ({
				ts: i + 1,
				type: "say" as const,
				say: "text" as const,
				text: `m${i}`,
			})),
			todoList: [{ id: "t1", content: "todo", status: "pending" }],
		})
		const posted = (post: ReturnType<typeof vi.fn> = mockPostMessage) => post.mock.calls.map((call) => call[0])
		const ofType = (type: string, post?: ReturnType<typeof vi.fn>) =>
			posted(post).filter((message) => message?.type === type)

		let current: FakeTask | undefined
		beforeEach(() => {
			current = undefined
			vi.spyOn(provider, "getCurrentTask").mockImplementation(() => current as any)
		})

		/** Resolves the view, reports its launch and waits for the launch's full push. */
		const launch = async (launchMessage: Record<string, unknown>) => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true
			mockPostMessage.mockClear()
			await webviewMessageHandler(provider, { type: "webviewDidLaunch", ...launchMessage } as any)
			await vi.waitFor(() => expect(ofType("state")).toHaveLength(1))
			mockPostMessage.mockClear()
		}

		const add = (task: FakeTask, text: string) => {
			const message = { ts: 1_000 + task.clineMessages.length, type: "say", say: "text", text } as ClineMessage
			task.clineMessages.push(message)
			return { message, appended: provider.postClineMessageAdded(task, message) }
		}

		it("posts the message alone with the state that has no message list, one per added message", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })

			const first = add(current, "four")
			await expect(first.appended).resolves.toBe(true)
			const second = add(current, "five")
			await expect(second.appended).resolves.toBe(true)

			expect(ofType("state")).toHaveLength(0)
			const added = ofType("messageAdded")
			expect(added.map((m) => [m.sourceTaskId, m.messageIndex, m.clineMessage.text])).toEqual([
				["task-1", 3, "four"],
				["task-1", 4, "five"],
			])
			const state = added[0].state
			for (const key of ["clineMessages", "clineMessagesSeq", "taskHistory"]) {
				expect(state, key).not.toHaveProperty(key)
			}
			// The rest of the state still travels with every message (todos, mode, settings).
			expect(state.currentTaskTodos).toEqual(current.todoList)
			expect(state.currentTaskId).toBe("task-1")
			expect(state).toHaveProperty("mode")
		})

		it("a view that launched without the flag (the CLI) is never sent messageAdded", async () => {
			current = makeTask("task-1", 3)
			await launch({})

			await expect(add(current, "four").appended).resolves.toBe(false)
			expect(posted()).toEqual([])

			// Declined explicitly: the same.
			await launch({ acceptsMessageAdded: false })
			await expect(add(current, "five").appended).resolves.toBe(false)
			expect(posted()).toEqual([])
		})

		it("the first message of a task the view has not been sent needs a full push first", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })

			current = makeTask("task-2", 0)
			await expect(add(current, "first").appended).resolves.toBe(false)

			await provider.postStateToWebviewWithoutTaskHistory()
			await expect(add(current, "second").appended).resolves.toBe(true)
			expect(ofType("messageAdded").map((m) => m.messageIndex)).toEqual([1])
		})

		it("a replaced message list (overwrite, resume) needs a full push first", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })

			current.clineMessages = current.clineMessages.slice(0, 2)
			await expect(add(current, "after rewind").appended).resolves.toBe(false)
		})

		it("a message of a task that is not the current one is not sent alone", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })
			const other = makeTask("task-other", 3)

			await expect(add(other, "elsewhere").appended).resolves.toBe(false)
		})

		it("a message the view may not have in order (a list sent before an unposted message) needs a full push", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })

			// A message pushed without being posted leaves the view one behind.
			current.clineMessages.push({ ts: 999, type: "say", say: "text", text: "unposted" } as ClineMessage)
			await expect(add(current, "next").appended).resolves.toBe(false)
		})

		it("a new webview for the provider holds nothing until a full push", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })

			await provider.resolveWebviewView(createMockWebviewView(vi.fn()))
			await expect(add(current, "four").appended).resolves.toBe(false)
		})

		it("a view replaced while the message's state is being built gets a full push instead", async () => {
			current = makeTask("task-1", 3)
			await launch({ acceptsMessageAdded: true })
			const newPost = vi.fn()

			const { appended } = add(current, "four")
			void provider.resolveWebviewView(createMockWebviewView(newPost))
			await expect(appended).resolves.toBe(true)

			expect(ofType("messageAdded", newPost)).toHaveLength(0)
			const full = ofType("state", newPost)
			expect(full).toHaveLength(1)
			expect(full[0].state.clineMessages.map((m: ClineMessage) => m.text)).toEqual(["m0", "m1", "m2", "four"])
		})

		it("a message changed in place is posted as messageUpdated to an accepting view that holds the list, never to the CLI", async () => {
			current = makeTask("task-1", 2)
			await launch({ acceptsMessageAdded: true })

			await provider.postEditedClineMessage(current, current.clineMessages[0])
			expect(ofType("messageUpdated").map((m) => [m.sourceTaskId, m.clineMessage.ts])).toEqual([["task-1", 1]])

			await launch({})
			await provider.postEditedClineMessage(current, current.clineMessages[0])
			expect(posted()).toEqual([])

			// An accepting view that holds another list gets nothing either.
			await launch({ acceptsMessageAdded: true })
			await provider.postEditedClineMessage(makeTask("task-other", 2), current.clineMessages[0])
			expect(posted()).toEqual([])
		})

		it("resyncClineMessages answers with a full push of the current task's list", async () => {
			current = makeTask("task-1", 2)
			await launch({ acceptsMessageAdded: true })

			await webviewMessageHandler(provider, { type: "resyncClineMessages" } as any)

			await vi.waitFor(() => expect(ofType("state")).toHaveLength(1))
			expect(ofType("state")[0].state.clineMessages.map((m: ClineMessage) => m.text)).toEqual(["m0", "m1"])
		})
	})
})
