// pnpm --filter tumble-code test core/webview/__tests__/ClineProvider.spec.ts

import * as path from "path"

import * as vscode from "vscode"
import axios from "axios"

import {
	type ProviderSettingsEntry,
	type ClineMessage,
	type ExtensionMessage,
	TumbleCodeEventName,
} from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { Task, TaskOptions } from "../../task/Task"
import { safeWriteJson } from "@tumble-code/core/fs"
import { ClineProvider } from "../ClineProvider"
import { createMockContext, createMockWebviewView, createTestProvider } from "./helpers/providerHarness"
import { panelRegistry } from "../panelRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { MessageManager } from "../../message-manager"
import { logger } from "../../../utils/logging"

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => {
	const fsMock = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(""),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		// TaskHistoryStore.initialize/reconcile/refreshTask need these to be
		// no-ops against the in-memory mock so the shared store becomes ready.
		readdir: vi.fn().mockResolvedValue([]),
		access: vi.fn().mockResolvedValue(undefined),
		rm: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockResolvedValue({ mtimeMs: 0, size: 0, isDirectory: () => true }),
	}
	// Modules that default-import fs/promises (services/roo-config, utils/fs)
	// get the same functions; without `default` their calls threw inside the
	// un-awaited SkillsManager.initialize() and the rejection was logged to the
	// output channel at a timing-dependent moment.
	return { ...fsMock, default: fsMock }
})

// Deterministic nonce so the generated webview HTML can be pinned byte for byte.
vi.mock("../getNonce", () => ({ getNonce: () => "TESTNONCE0123456789abcdefghijklm" }))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockResolvedValue(undefined)
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

vi.mock("../../../utils/path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/path")>()
	return {
		...actual,
		getWorkspacePath: vi.fn().mockReturnValue(""),
	}
})

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
	// TaskHistoryStore.getTasksDir resolves the storage base path; passthrough
	// so the shared store initializes against the mocked storage path.
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => Promise.resolve(defaultPath)),
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

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

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

// The specs assert on or stub these members of the shared vscode mock.
beforeEach(() => {
	vi.spyOn(vscode.window, "showErrorMessage")
	vi.spyOn(vscode.Uri, "file")
	vi.spyOn(vscode.Uri, "joinPath")
	vi.spyOn(vscode.workspace, "getWorkspaceFolder")
})

const lmStudioFetchers = vi.hoisted(() => ({
	hasLoadedFullDetails: vi.fn(() => false),
	forceFullModelDetailsLoad: vi.fn(async () => {}),
}))
vi.mock("../../../api/providers/fetchers/lmstudio", () => lmStudioFetchers)

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
	Task: vi.fn().mockImplementation(function (options: any) {
		return {
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
		}
	}),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
		{
			slug: "ask",
			name: "Ask Mode",
			roleDefinition: "You are a helpful assistant",
			groups: ["read"],
		},
	],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockImplementation((group: string) => {
		// Return appropriate group names for different tool groups
		switch (group) {
			case "read":
				return "Read Tools"
			case "edit":
				return "Edit Tools"
			case "mcp":
				return "MCP Tools"
			default:
				return "General Tools"
		}
	}),
	defaultModeSlug: "code",
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

// The state builder awaits this after it has read the chat messages; the state-order test
// holds it open to make an older snapshot finish building after a newer one.
const { mockOpenAiCodexIsAuthenticated, mockOpenAiCodexAuthStatus } = vi.hoisted(() => ({
	mockOpenAiCodexIsAuthenticated: vi.fn(),
	mockOpenAiCodexAuthStatus: vi.fn(),
}))
vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		isAuthenticated: mockOpenAiCodexIsAuthenticated,
		getAuthenticationStatus: mockOpenAiCodexAuthStatus,
	},
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				off: vi.fn(),
			}
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider", () => {
	// The provider and its collaborators write through the shared logger.
	beforeEach(() => {
		for (const level of ["debug", "info", "warn", "error"] as const) {
			vi.spyOn(logger, level).mockImplementation(() => {})
		}
	})

	beforeAll(() => {
		vi.mocked(Task).mockImplementation(function (options: any) {
			const task: any = {
				api: undefined,
				abortTask: vi.fn(),
				start: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				overwriteClineMessages: vi.fn(),
				overwriteApiConversationHistory: vi.fn(),
				getTaskNumber: vi.fn().mockReturnValue(0),
				setTaskNumber: vi.fn(),
				setParentTask: vi.fn(),
				setRootTask: vi.fn(),
				setTaskApiConfigName: vi.fn(),
				taskId: options?.historyItem?.id || "test-task-id",
				emit: vi.fn(),
				once: vi.fn(),
				off: vi.fn(),
			}

			Object.defineProperty(task, "messageManager", {
				get: () => new MessageManager(task),
			})

			return task
		})
	})

	let defaultTaskOptions: TaskOptions

	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockWebviewView: any
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockContext = createMockContext({ mode: "architect", currentApiConfigName: "current-config" })

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock webview
		mockPostMessage = vi.fn()

		mockWebviewView = createMockWebviewView(mockPostMessage)

		provider = createTestProvider(mockContext)

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// @ts-expect-error - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager

		// Mock getMcpHub method for generateSystemPrompt
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-expect-error - accessing private property for testing
		provider.view = mockWebviewView
		expect(panelRegistry.getVisibleInstance()).toBe(provider)
	})

	test("panelRegistry.observe replays live providers and reports each new one until disposed", () => {
		const seen: ClineProvider[] = []
		const observer = panelRegistry.observe((instance) => seen.push(instance))
		expect(seen).toContain(provider)

		const tab = createTestProvider(mockContext, "editor")
		expect(seen[seen.length - 1]).toBe(tab)

		observer.dispose()
		const count = seen.length
		createTestProvider(mockContext, "editor")
		expect(seen).toHaveLength(count)
	})

	test("resolveWebviewView hydrates the saved terminalProfile into the process-wide Terminal state", async () => {
		const setTerminalProfileSpy = vi.spyOn(Terminal, "setTerminalProfile").mockImplementation(() => {})
		// Seed the persisted setting so the real getState() returns it during hydration.
		await (provider as any).contextProxy.setValue("terminalProfile", "Git Bash")

		await provider.resolveWebviewView(mockWebviewView)
		// The hydration runs in a getState().then(...) callback, so flush microtasks.
		await new Promise((resolve) => setImmediate(resolve))

		expect(setTerminalProfileSpy).toHaveBeenCalledWith("Git Bash")

		setTerminalProfileSpy.mockRestore()
	})

	// API-6: the model preload is the provider's `needsModelPreload`
	// capability, not a provider-name check.
	describe("performPreparationTasks", () => {
		it("preloads the LM Studio model before the task starts", async () => {
			lmStudioFetchers.forceFullModelDetailsLoad.mockClear()
			const task = { apiConfiguration: { apiProvider: "lmstudio", lmStudioModelId: "qwen" } } as unknown as Task

			await provider.performPreparationTasks(task)

			expect(lmStudioFetchers.forceFullModelDetailsLoad).toHaveBeenCalledWith("http://localhost:1234", "qwen")
		})

		it("shows a failed preload (for example an LM Studio that does not answer) and lets the task start", async () => {
			lmStudioFetchers.forceFullModelDetailsLoad.mockRejectedValueOnce(
				new Error("LM Studio at http://localhost:1234 did not answer while loading qwen"),
			)
			const task = { apiConfiguration: { apiProvider: "lmstudio", lmStudioModelId: "qwen" } } as unknown as Task

			await expect(provider.performPreparationTasks(task)).resolves.toBeUndefined()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"LM Studio at http://localhost:1234 did not answer while loading qwen",
			)
		})

		it("preloads nothing for providers without the capability", async () => {
			lmStudioFetchers.forceFullModelDetailsLoad.mockClear()
			const task = { apiConfiguration: { apiProvider: "ollama", ollamaModelId: "qwen" } } as unknown as Task

			await provider.performPreparationTasks(task)

			expect(lmStudioFetchers.forceFullModelDetailsLoad).not.toHaveBeenCalled()
		})
	})

	const stubCreateTaskDeps = () => {
		// createTask runs setValues + allowlist + stack ops before start();
		// stub those so the tests exercise only the branch under test.
		vi.spyOn(provider as any, "setValues").mockResolvedValue(undefined)
		vi.spyOn(provider, "getState").mockResolvedValue({
			mode: "code",
			apiConfiguration: { apiProvider: "openrouter" },
			organizationAllowList: { allowAll: true, providers: {} },
		} as any)
		vi.spyOn(provider as any, "setCurrentTask").mockResolvedValue(undefined)
		vi.spyOn(provider as any, "clearCurrentTask").mockResolvedValue(undefined)
	}

	describe("createTask startTask gating", () => {
		it("auto-starts the task by default", async () => {
			stubCreateTaskDeps()
			const task = await provider.createTask("hello")
			expect((task as any).start).toHaveBeenCalledTimes(1)
		})

		it("does NOT auto-start when options.startTask is false", async () => {
			stubCreateTaskDeps()
			const task = await provider.createTask("hello", undefined, undefined, { startTask: false })
			expect((task as any).start).not.toHaveBeenCalled()
		})
	})

	describe("createTask delegation lineage", () => {
		// The options the provider handed to the Task constructor (mocked above).
		const lastTaskOptions = () => vi.mocked(Task).mock.calls.at(-1)![0]

		// A live Task keeps its lineage as id strings only (taskId, rootTaskId);
		// there is no live root Task object to follow.
		const liveTask = (taskId: string, rootTaskId?: string) => ({ taskId, rootTaskId }) as unknown as Task

		it("a top-level task has no root", async () => {
			stubCreateTaskDeps()
			await provider.createTask("top", undefined, undefined, { startTask: false })
			expect(lastTaskOptions().rootTaskId).toBeUndefined()
		})

		it("a first-level child records its top-level parent as the root", async () => {
			stubCreateTaskDeps()
			await provider.createTask("child", undefined, liveTask("root-task"), { startTask: false })
			expect(lastTaskOptions().rootTaskId).toBe("root-task")
		})

		it("a grandchild records the root of the chain, not its parent", async () => {
			stubCreateTaskDeps()
			const parent = liveTask("mid-task", "root-task")
			await provider.createTask("grandchild", undefined, parent, { startTask: false })
			expect(lastTaskOptions()).toMatchObject({ rootTaskId: "root-task", parentTask: parent })
		})
	})

	describe("tasks created off screen (delegation partners of a task the user left)", () => {
		const lastTaskOptions = () => vi.mocked(Task).mock.calls.at(-1)![0]
		const parent = {
			taskId: "parent-task",
			rootTaskId: "root-task",
			apiConfiguration: { apiProvider: "anthropic" },
			taskApiConfigName: "parent-profile",
		} as unknown as Task

		it("a child starts off screen in its own mode, on the mode's profile, not on screen", async () => {
			stubCreateTaskDeps()
			vi.spyOn(provider, "getApiConfigurationForMode").mockResolvedValue({
				apiConfiguration: { apiProvider: "openai" },
				name: "ask-profile",
			})

			const child = await (provider as any).createDetachedChildTask("sub", parent, "ask", {
				initialStatus: "active",
			})

			expect(lastTaskOptions()).toMatchObject({
				task: "sub",
				taskMode: "ask",
				parentTask: parent,
				rootTaskId: "root-task",
				apiConfiguration: { apiProvider: "openai" },
				initialStatus: "active",
				startTask: false,
			})
			expect(child.setTaskApiConfigName).toHaveBeenCalledWith("ask-profile")
			expect((provider as any).setCurrentTask).not.toHaveBeenCalled()
			expect(provider.getCurrentTask()).toBeUndefined()
			expect(provider.getLiveTaskInstance(child.taskId)).toBe(child)
		})

		it("a child of a mode without its own profile runs on its parent's profile", async () => {
			stubCreateTaskDeps()
			vi.spyOn(provider, "getApiConfigurationForMode").mockResolvedValue(undefined)

			const child = await (provider as any).createDetachedChildTask("sub", parent, "ask", {})

			expect(lastTaskOptions().apiConfiguration).toEqual({ apiProvider: "anthropic" })
			expect(child.setTaskApiConfigName).toHaveBeenCalledWith("parent-profile")
		})

		it("a parent resumed from history off screen runs on its own profile, not started", async () => {
			stubCreateTaskDeps()
			const getForTask = vi
				.spyOn((provider as any).modeProfiles, "getApiConfigurationForTask")
				.mockResolvedValue({ apiConfiguration: { apiProvider: "openai" }, name: "own" })
			const historyItem = { id: "parent-task", number: 3, mode: "code", apiConfigName: "own", status: "active" }

			const task = await (provider as any).createDetachedTaskFromHistory(historyItem)

			expect(getForTask).toHaveBeenCalledWith(historyItem)
			expect(lastTaskOptions()).toMatchObject({
				historyItem,
				apiConfiguration: { apiProvider: "openai" },
				startTask: false,
				initialStatus: "active",
			})
			expect(provider.getCurrentTask()).toBeUndefined()
			expect(provider.getLiveTaskInstance("parent-task")).toBe(task)
		})
	})

	test.each([
		["no workspace folder", []],
		["a workspace folder", [{ uri: { fsPath: "/test/workspace" } }]],
	])(
		"resolveWebviewView with %s lets the webview load the extension, the folders and the custom sounds",
		async (_name, folders) => {
			const customSoundsUri = { fsPath: "/test/storage/path/custom-sounds" } as vscode.Uri
			;(vscode.Uri.file as any).mockReturnValueOnce(customSoundsUri)
			const saved = vscode.workspace.workspaceFolders
			;(vscode.workspace as any).workspaceFolders = folders
			try {
				await provider.resolveWebviewView(mockWebviewView)
			} finally {
				;(vscode.workspace as any).workspaceFolders = saved
			}

			expect(mockWebviewView.webview.options).toEqual({
				enableScripts: true,
				localResourceRoots: [mockContext.extensionUri, ...folders.map((folder) => folder.uri), customSoundsUri],
			})
		},
	)

	describe("logWebviewHiddenDiagnostics", () => {
		let visibilityCallback: () => void

		beforeEach(async () => {
			// Capture the visibility callback registered during resolveWebviewView
			mockWebviewView.onDidChangeVisibility = vi.fn().mockImplementation((cb: () => void) => {
				visibilityCallback = cb
				return { dispose: vi.fn() }
			})
			// @ts-expect-error - accessing private property for testing
			provider.view = mockWebviewView
			await provider.resolveWebviewView(mockWebviewView)
			vi.mocked(logger.info).mockClear()
		})

		test("does not log when no task is active", () => {
			// view becomes hidden with no task on the stack
			Object.defineProperty(mockWebviewView, "visible", { value: false, configurable: true })
			visibilityCallback()
			expect(logger.info).not.toHaveBeenCalled()
		})

		test("does not log when the active task is aborted", async () => {
			const task = new Task(defaultTaskOptions)
			Object.defineProperty(task, "taskId", { value: "aborted-task", writable: true })
			task.abort = true
			await provider.setCurrentTask(task)
			Object.defineProperty(mockWebviewView, "visible", { value: false, configurable: true })
			visibilityCallback()
			expect(logger.info).not.toHaveBeenCalled()
		})

		test("logs task state to output channel when an active task is running", async () => {
			const task = new Task(defaultTaskOptions)
			Object.defineProperty(task, "taskId", { value: "running-task", writable: true })
			await provider.setCurrentTask(task)
			Object.defineProperty(mockWebviewView, "visible", { value: false, configurable: true })
			visibilityCallback()
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("running-task"))
		})
	})

	describe("editor tab view state", () => {
		let viewStateCallback: () => void
		let panel: any

		const didBecomeVisibleCount = () =>
			mockPostMessage.mock.calls.filter(
				([message]: [any]) => message?.type === "action" && message?.action === "didBecomeVisible",
			).length

		beforeEach(async () => {
			const { onDidChangeVisibility: _unused, ...rest } = mockWebviewView
			panel = {
				...rest,
				visible: true,
				// The shared mock disposes at once, which would dispose a tab provider.
				onDidDispose: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
				onDidChangeViewState: vi.fn().mockImplementation((cb: () => void) => {
					viewStateCallback = cb
					return { dispose: vi.fn() }
				}),
			}
			await provider.resolveWebviewView(panel)
			mockPostMessage.mockClear()
		})

		test("losing focus while staying visible does not send didBecomeVisible", () => {
			// The user clicks another editor group: active flips, visible stays true.
			viewStateCallback()
			viewStateCallback()
			expect(didBecomeVisibleCount()).toBe(0)
		})

		test("coming back on screen sends didBecomeVisible once", () => {
			panel.visible = false
			viewStateCallback()
			panel.visible = true
			viewStateCallback()
			viewStateCallback()
			expect(didBecomeVisibleCount()).toBe(1)
		})
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("postMessageToWebview does not throw when webview is disposed", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Simulate postMessage throwing after webview disposal
		mockPostMessage.mockRejectedValueOnce(new Error("Webview is disposed"))

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }

		// Should not throw
		await expect(provider.postMessageToWebview(message)).resolves.toBeUndefined()
	})

	test("postMessageToWebview skips postMessage after dispose", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		mockPostMessage.mockClear()

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	test("dispose is idempotent — second call is a no-op", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		await provider.dispose()

		// dispose body runs only once: log "Disposing ClineProvider..." appears once
		const disposeCalls = vi
			.mocked(logger.info)
			.mock.calls.filter(([msg]) => typeof msg === "string" && msg.includes("Disposing ClineProvider..."))
		expect(disposeCalls).toHaveLength(1)
	})

	test("webviewDidLaunch builds the webview state only once", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
		const buildState = vi.spyOn(provider, "getStateToPostToWebview")

		await messageHandler({ type: "webviewDidLaunch" })

		await vi.waitFor(() => expect(provider.isViewLaunched).toBe(true))
		// Only the state push itself builds the webview state.
		expect(buildState).toHaveBeenCalledTimes(1)
	})

	test("the state push takes the codex sign-in flag from the cached status", async () => {
		mockOpenAiCodexAuthStatus.mockReset()
		mockOpenAiCodexAuthStatus.mockResolvedValue(true)
		mockOpenAiCodexIsAuthenticated.mockReset()
		mockOpenAiCodexIsAuthenticated.mockResolvedValue(false)

		const state = await provider.getStateToPostToWebview()

		expect(state.openAiCodexIsAuthenticated).toBe(true)
		expect(mockOpenAiCodexIsAuthenticated).not.toHaveBeenCalled()
	})

	test("the clearTask message clears the task and pushes the state", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
		const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)
		await provider.setCurrentTask(new Task(defaultTaskOptions))

		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
		await messageHandler({ type: "clearTask" })

		expect(clearTaskSpy).toHaveBeenCalledTimes(1)
		expect(postStateToWebviewSpy).toHaveBeenCalledTimes(1)
	})

	test("setCurrentTask replaces the current task (single-task slot, D7)", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline1 = new Task(defaultTaskOptions) // Create a new mocked instance
		const mockCline2 = new Task(defaultTaskOptions) // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// install the first, then the second — production discipline is
		// pop-then-push, but even a bare double-add must not stack.
		await provider.setCurrentTask(mockCline1)
		await provider.setCurrentTask(mockCline2)

		// verify the slot holds exactly the latest task
		expect(provider.getCurrentTask()).toBe(mockCline2)
		expect(provider.getCurrentTaskStack()).toEqual(["test-task-id-2"])
	})

	// Each state push is built asynchronously: the chat messages are read part-way through and
	// more awaits follow. When two pushes overlap, the one that read the messages first can finish
	// last. The webview only applies clineMessages whose sequence number is higher than the last
	// one it applied, so the number must follow the order of the reads, not the order of the
	// posts. Otherwise the older snapshot (for example a child task with no messages yet) wins and
	// the chat view falls back to Home.
	test.each([
		["postStateToWebview", (p: ClineProvider) => p.postStateToWebview()],
		["postStateToWebviewWithoutTaskHistory", (p: ClineProvider) => p.postStateToWebviewWithoutTaskHistory()],
	])("%s numbers chat message snapshots in the order they were read", async (_name, postState) => {
		const task = new Task(defaultTaskOptions)
		await provider.setCurrentTask(task)
		const newerMessages: ClineMessage[] = [{ ts: 1, type: "say", say: "text", text: "child ready" }]
		task.clineMessages = []

		let releaseOlderBuild: ((value: boolean) => void) | undefined
		mockOpenAiCodexAuthStatus.mockReset()
		mockOpenAiCodexAuthStatus
			.mockImplementationOnce(() => new Promise<boolean>((resolve) => (releaseOlderBuild = resolve)))
			.mockResolvedValue(false)
		const postMessageSpy = vi.spyOn(provider, "postMessageToWebview").mockResolvedValue(undefined)

		// The older push reads the empty message list, then stays parked on a later await.
		const olderPost = postState(provider)
		await vi.waitFor(() => expect(releaseOlderBuild).toBeDefined())

		// Meanwhile the task gets its first message and a newer push completes.
		task.clineMessages = newerMessages
		await postState(provider)

		releaseOlderBuild!(false)
		await olderPost

		const posted = postMessageSpy.mock.calls
			.map(([message]) => message)
			.filter((message) => message.type === "state")
			.map((message) => message.state!)
		expect(posted.map((state) => state.clineMessages)).toEqual([newerMessages, []])
		expect(posted[1].clineMessagesSeq).toBeLessThan(posted[0].clineMessagesSeq!)
	})

	test("postStateToWebviewWithoutClineMessages carries no message sequence number", async () => {
		mockOpenAiCodexAuthStatus.mockReset()
		mockOpenAiCodexAuthStatus.mockResolvedValue(false)
		const postMessageSpy = vi.spyOn(provider, "postMessageToWebview").mockResolvedValue(undefined)

		await provider.postStateToWebviewWithoutClineMessages()

		const state = postMessageSpy.mock.calls[0][0].state!
		expect(state.clineMessages).toBeUndefined()
		expect(state.clineMessagesSeq).toBeUndefined()
	})

	test("language is set to VSCode language", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "pt-BR"

		const state = await provider.getState()
		expect(state.language).toBe("pt-BR")
	})

	// DEF-C25, owner decisions 4a and 4b: a user who never touched these
	// settings gets the same value from every host path.
	describe("decided defaults for never-saved settings (DEF-C25)", () => {
		const decided = {
			terminalShellIntegrationTimeout: 30_000,
			soundEnabled: false,
			enableCheckpoints: true,
			writeDelayMs: 1000,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			customModePrompts: {},
			showRooIgnoredFiles: false,
		}
		const pick = (state: Record<string, unknown>) =>
			Object.fromEntries(Object.keys(decided).map((key) => [key, state[key]]))

		test("getState resolves the decided defaults", async () => {
			;(mockContext.globalState.get as any).mockImplementation(() => undefined)
			expect(pick(await provider.getState())).toEqual(decided)
		})

		test("the state posted to the webview carries the decided defaults", async () => {
			;(mockContext.globalState.get as any).mockImplementation(() => undefined)
			expect(pick((await provider.getStateToPostToWebview()) as any)).toEqual(decided)
		})

		test("resolveWebviewView applies the decided timeout to the terminal when none is saved", async () => {
			const setTimeoutSpy = vi.spyOn(Terminal, "setShellIntegrationTimeout").mockImplementation(() => {})

			await provider.resolveWebviewView(mockWebviewView)
			// The hydration runs in a getState().then(...) callback, so flush microtasks.
			await new Promise((resolve) => setImmediate(resolve))

			expect(setTimeoutSpy).toHaveBeenCalledWith(30_000)
			setTimeoutSpy.mockRestore()
		})
	})

	test.each([
		["writeDelayMs", 2000],
		["soundEnabled", true],
		["autoCondenseContext", false],
		["autoCondenseContextPercent", 75],
		["maxWorkspaceFiles", 300],
		["showRooIgnoredFiles", true],
	])("updateSettings stores %s in the state", async (key, value) => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { [key]: value } })

		expect((await provider.getState())[key as keyof Awaited<ReturnType<typeof provider.getState>>]).toBe(value)
		expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
	})

	it("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
			listConfig: vi
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: vi.fn(),
		} as any

		provider.setValue("currentApiConfigName", "current-config")

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	test.each([
		["loadApiConfiguration", "new-config", { name: "new-config" }],
		["loadApiConfigurationById", "new-id", { id: "new-id" }],
	])("%s activates the profile and binds it to the current mode", async (type, text, lookup) => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { apiProvider: "anthropic", id: "new-id", name: "new-config" }

		;(provider as any).providerSettingsManager = {
			activateProfile: vi.fn().mockResolvedValue(profile),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
		} as any

		await messageHandler({ type: "mode", text: "architect" })
		await messageHandler({ type, text })

		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith(lookup)
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "existing code role",
				customInstructions: "existing code prompt",
			},
			architect: {
				roleDefinition: "existing architect role",
				customInstructions: "existing architect prompt",
			},
		}

		provider.setValue("customModePrompts", existingPrompts)

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	describe("editMessage", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		// An earlier exchange, then the user message being edited and its reply.
		const setEditableTask = async () => {
			const task = new Task(defaultTaskOptions)
			task.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "First" },
				{ ts: 2000, type: "say", say: "user_feedback", text: "Original" },
				{ ts: 3000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			task.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }] as any[]
			task.submitUserMessage = vi.fn()
			await provider.setCurrentTask(task)
			return task
		}
		const webviewMessage = (message: unknown) =>
			(mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0](message)
		const postedTypes = () => mockPostMessage.mock.calls.map(([message]: any[]) => message.type)

		test("submit only asks; confirm rewinds from the edited user message and resubmits the new text", async () => {
			const task = await setEditableTask()
			const [first] = task.clineMessages

			await webviewMessage({ type: "submitEditedMessage", value: 3000, editedMessageContent: "Edited" })

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 3000,
				text: "Edited",
				hasCheckpoint: false,
				images: undefined,
			})
			expect(task.overwriteClineMessages).not.toHaveBeenCalled()
			expect(task.submitUserMessage).not.toHaveBeenCalled()

			await webviewMessage({ type: "editMessageConfirm", messageTs: 3000, text: "Edited" })

			expect(task.overwriteClineMessages).toHaveBeenCalledWith([first])
			expect(task.overwriteApiConversationHistory).toHaveBeenCalledWith([{ ts: 1000 }])
			expect(task.submitUserMessage).toHaveBeenCalledWith("Edited", [])
		})

		test("delete only asks; confirm keeps the messages before the deleted one", async () => {
			const task = await setEditableTask()
			const [first, original] = task.clineMessages

			await webviewMessage({ type: "deleteMessage", value: 3000 })

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 3000,
				hasCheckpoint: false,
			})
			expect(task.overwriteClineMessages).not.toHaveBeenCalled()

			await webviewMessage({ type: "deleteMessageConfirm", messageTs: 3000 })

			expect(task.overwriteClineMessages).toHaveBeenCalledWith([first, original])
		})

		test.each([
			["editMessageConfirm", "errors.message.error_editing_message"],
			["deleteMessageConfirm", "errors.message.error_deleting_message"],
		])("a failing rewind on %s shows %s", async (type, errorKey) => {
			const task = await setEditableTask()
			task.overwriteClineMessages = vi.fn().mockRejectedValue(new Error("Connection lost"))

			await webviewMessage({ type, messageTs: 3000, text: "Edited" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(errorKey)
			expect(task.submitUserMessage).not.toHaveBeenCalled()
		})

		test("confirming an edit of a message that is gone changes nothing", async () => {
			const task = await setEditableTask()

			await webviewMessage({ type: "editMessageConfirm", messageTs: 5000, text: "Edited" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.message_not_found")
			expect(task.overwriteClineMessages).not.toHaveBeenCalled()
			expect(task.submitUserMessage).not.toHaveBeenCalled()
		})

		test("malformed edit and delete requests open no dialog", async () => {
			await setEditableTask()

			await webviewMessage({ type: "submitEditedMessage", editedMessageContent: "Edited" })
			await webviewMessage({ type: "submitEditedMessage", value: "invalid", editedMessageContent: "Edited" })
			await webviewMessage({ type: "submitEditedMessage", value: 3000 })
			await webviewMessage({ type: "deleteMessage", value: 0 })
			;(provider as any).taskSlot.seedForTests()
			await webviewMessage({ type: "submitEditedMessage", value: 3000, editedMessageContent: "Edited" })
			await webviewMessage({ type: "deleteMessage", value: 3000 })

			expect(postedTypes()).not.toContain("showEditMessageDialog")
			expect(postedTypes()).not.toContain("showDeleteMessageDialog")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.invalid_timestamp_for_deletion")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.no_active_task_to_delete")
		})
	})

	describe("getSystemPrompt", () => {
		test.each([
			["architect", "architect"],
			[undefined, "code"],
		])("the preview for mode %s is built for %s and posted", async (requested, built) => {
			const { SYSTEM_PROMPT } = await import("../../prompts/system")
			vi.mocked(SYSTEM_PROMPT).mockResolvedValueOnce("the prompt")
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({ type: "getSystemPrompt", mode: requested })

			expect(vi.mocked(SYSTEM_PROMPT).mock.calls.at(-1)![0]).toMatchObject({ mode: built })
			expect(mockPostMessage).toHaveBeenCalledWith({ type: "systemPrompt", text: "the prompt", mode: requested })
		})

		test("a failure shows the error", async () => {
			const { SYSTEM_PROMPT } = await import("../../prompts/system")
			vi.mocked(SYSTEM_PROMPT).mockRejectedValueOnce(new Error("Test error"))
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({ type: "getSystemPrompt", mode: "code" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.get_system_prompt")
		})
	})

	describe("updateCustomMode", () => {
		test("updates both file and state when updating custom mode", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Mock CustomModesManager methods
			;(provider as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Updated role definition",
						groups: ["read"] as const,
					},
				]),
				dispose: vi.fn(),
			} as any

			// Test updating a custom mode
			await messageHandler({
				type: "updateCustomMode",
				modeConfig: {
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Updated role definition",
					groups: ["read"] as const,
				},
			})

			// Verify CustomModesManager.updateCustomMode was called
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledWith(
				"test-mode",
				expect.objectContaining({
					slug: "test-mode",
					roleDefinition: "Updated role definition",
				}),
			)

			// Verify state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [
				{ groups: ["read"], name: "Test Mode", roleDefinition: "Updated role definition", slug: "test-mode" },
			])

			// Verify state was posted to webview
			// Verify state was posted to webview with correct format
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "state",
					state: expect.objectContaining({
						customModes: [
							expect.objectContaining({
								slug: "test-mode",
								roleDefinition: "Updated role definition",
							}),
						],
					}),
				}),
			)
		})
	})

	describe("upsertApiConfiguration", () => {
		const upsert = async (saveConfig: ReturnType<typeof vi.fn>) => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig,
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
			} as any
			await messageHandler({ type: "mode", text: "architect" })
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" },
			})
		}

		test("saves the profile, makes it current, binds it to the mode and posts the state", async () => {
			await upsert(vi.fn().mockResolvedValue("test-id"))

			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", {
				apiProvider: "anthropic",
				apiKey: "test-key",
			})
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
			expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "test-id")
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("a failing save is logged and shown with its cause", async () => {
			await upsert(vi.fn().mockRejectedValue(new Error("disk full")))

			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error create new api configuration"))
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config: disk full")
		})
	})

	describe("cloud profile sync wiring", () => {
		const installFakeCloudService = async (authenticated: boolean) => {
			const { EventEmitter } = await import("events")
			const { CloudService } = await import("@tumble-code/cloud")
			const fake = Object.assign(new EventEmitter(), {
				isAuthenticated: vi.fn().mockReturnValue(authenticated),
				getOrganizationSettings: vi.fn().mockReturnValue(undefined),
			})
			const descriptor = Object.getOwnPropertyDescriptor(CloudService, "instance")
			Object.defineProperty(CloudService, "instance", { get: () => fake, configurable: true })
			const restore = () => Object.defineProperty(CloudService, "instance", descriptor!)
			return { fake, restore }
		}

		const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

		test("construction subscribes once, and initializeCloudProfileSyncWhenReady does not add a second listener", async () => {
			const { fake, restore } = await installFakeCloudService(false)
			try {
				const p = createTestProvider(mockContext)
				await flush()
				expect(fake.listenerCount("settings-updated")).toBe(1)

				await p.initializeCloudProfileSyncWhenReady()
				await p.initializeCloudProfileSyncWhenReady()
				expect(fake.listenerCount("settings-updated")).toBe(1)
			} finally {
				restore()
			}
		})

		test("construction syncs cloud profiles right away when already authenticated", async () => {
			const { fake, restore } = await installFakeCloudService(true)
			try {
				createTestProvider(mockContext)
				await flush()
				expect(fake.getOrganizationSettings).toHaveBeenCalledTimes(1)
			} finally {
				restore()
			}
		})

		// The sync decisions are pinned in CloudProfileSync.spec; this pins the provider's host wiring.
		const makeSyncedProvider = async (
			syncResult: { hasChanges: boolean; activeProfileChanged: boolean; activeProfileId?: string },
			providerProfiles: Record<string, unknown> | null = { cloud: { apiProvider: "anthropic" } },
		) => {
			const cloud = await installFakeCloudService(false)
			cloud.fake.getOrganizationSettings.mockReturnValue(providerProfiles ? { providerProfiles } : {})
			const p = createTestProvider(mockContext)
			await flush()
			await p.setValue("currentApiConfigName", "local-profile")
			const sync = vi.spyOn(p.providerSettingsManager, "syncCloudProfiles").mockResolvedValue(syncResult as any)
			vi.spyOn(p.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "cloud-profile", id: "cloud-id", apiProvider: "anthropic" },
			])
			vi.spyOn(p.providerSettingsManager, "getProfile").mockResolvedValue({
				name: "cloud-profile",
				id: "cloud-id",
			} as any)
			const activate = vi.spyOn(p, "activateProviderProfile").mockResolvedValue(undefined as any)
			const postState = vi.spyOn(p, "postStateToWebviewWithoutClineMessages").mockResolvedValue(undefined)
			return { p, cloud, sync, activate, postState }
		}

		test("settings-updated with changes refreshes the profile list, activates the new active profile and posts state", async () => {
			const { p, cloud, sync, activate, postState } = await makeSyncedProvider({
				hasChanges: true,
				activeProfileChanged: true,
				activeProfileId: "cloud-id",
			})
			try {
				cloud.fake.emit("settings-updated")
				await flush()
				expect(sync).toHaveBeenCalledWith({ cloud: { apiProvider: "anthropic" } }, "local-profile")
				expect(p.providerSettingsManager.getProfile).toHaveBeenCalledWith({ id: "cloud-id" })
				expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
					{ name: "cloud-profile", id: "cloud-id", apiProvider: "anthropic" },
				])
				expect(activate).toHaveBeenCalledWith({ name: "cloud-profile" })
				expect(postState).toHaveBeenCalledTimes(1)
			} finally {
				cloud.restore()
			}
		})

		test("dispose removes the settings-updated listener", async () => {
			const { p, cloud } = await makeSyncedProvider({ hasChanges: false, activeProfileChanged: false })
			try {
				expect(cloud.fake.listenerCount("settings-updated")).toBe(1)
				await p.dispose()
				expect(cloud.fake.listenerCount("settings-updated")).toBe(0)
			} finally {
				cloud.restore()
			}
		})
	})

	// The HTML itself is pinned in WebviewHtml.spec; this pins what the sidebar passes to it.
	describe("webview HTML", () => {
		const renderSidebar = async (development: boolean, openRouterBaseUrl?: string) => {
			const context = {
				...mockContext,
				extensionUri: { fsPath: "/ext" },
				extensionMode: development ? vscode.ExtensionMode.Development : vscode.ExtensionMode.Production,
			} as unknown as vscode.ExtensionContext
			const p = createTestProvider(context)
			await p.contextProxy.setValue("openRouterBaseUrl", openRouterBaseUrl)
			await p.resolveWebviewView(mockWebviewView)
			return mockWebviewView.webview.html as string
		}

		// A developer's own .vite-port file must not change the port.
		const realFs = require("fs") as typeof import("fs")
		const originalExistsSync = realFs.existsSync
		let existsSpy: { mockRestore(): void }

		beforeEach(() => {
			existsSpy = vi
				.spyOn(realFs, "existsSync")
				.mockImplementation((p) => !String(p).endsWith(".vite-port") && originalExistsSync(p))
			vi.mocked(vscode.Uri.joinPath).mockImplementation(
				(base: any, ...parts: string[]) => ({ path: [base?.fsPath, ...parts].join("/") }) as any,
			)
			mockWebviewView.webview.asWebviewUri = vi.fn((uri: any) => `vscode-resource:${uri.path}`)
			vi.mocked(axios.get)
				.mockReset()
				.mockResolvedValue({ data: { data: [] } })
		})

		afterEach(() => {
			vi.mocked(vscode.Uri.joinPath).mockReset()
			existsSpy.mockRestore()
		})

		test("production loads the built bundle under the Tumble Code title, with the saved OpenRouter origin", async () => {
			const html = await renderSidebar(false, "https://router.example.com/api/v1")

			expect(html).toContain("<title>Tumble Code</title>")
			expect(html).toContain('src="vscode-resource:/ext/webview-ui/build/assets/index.js"')
			expect(html).toContain("https://router.example.com https://api.requesty.ai;")
			expect(axios.get).not.toHaveBeenCalled()
		})

		test("development is served by the dev server", async () => {
			const html = await renderSidebar(true)

			expect(axios.get).toHaveBeenCalledWith("http://localhost:5173")
			expect(html).toContain('src="http://localhost:5173/src/index.tsx"')
			expect(html).toContain("https://openrouter.ai")
		})

		test("development without a dev server falls back to production and says so", async () => {
			vi.mocked(axios.get).mockRejectedValueOnce(new Error("ECONNREFUSED"))

			const html = await renderSidebar(true)

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.hmr_not_running")
			expect(html).toContain('src="vscode-resource:/ext/webview-ui/build/assets/index.js"')
		})
	})

	// The forwarding table is pinned in taskEventForwarding.spec; this pins the provider's side:
	// attach on creation, the host it passes, the rehydrate decision and the detach on removal.
	describe("task event forwarding", () => {
		const tokenUsage = { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.5 } as any
		const toolUsage = { read_file: { attempts: 1, failures: 0 } } as any

		const makeTask = async (overrides: Record<string, unknown> = {}) => {
			const { EventEmitter } = await vi.importActual<typeof import("events")>("events")
			return Object.assign(new EventEmitter(), {
				taskId: "task-1",
				instanceId: "instance-1",
				abortTask: vi.fn().mockResolvedValue(undefined),
				...overrides,
			}) as any
		}

		const attach = (task: any) => (provider as any).taskCreationCallback(task)

		test("creation emits TaskCreated and the task's events reach provider listeners", async () => {
			const task = await makeTask()
			const created = vi.fn()
			const completed = vi.fn()
			provider.on(TumbleCodeEventName.TaskCreated, created)
			provider.on(TumbleCodeEventName.TaskCompleted, completed)
			const markTerminal = vi.spyOn(provider.subagentRegistry, "markTerminal")

			attach(task)
			task.emit(TumbleCodeEventName.TaskCompleted, "task-1", tokenUsage, toolUsage)

			expect(created).toHaveBeenCalledWith(task)
			expect(completed).toHaveBeenCalledWith("task-1", tokenUsage, toolUsage)
			expect(markTerminal).toHaveBeenCalledWith("task-1", "completed")

			provider.off(TumbleCodeEventName.TaskCompleted, completed)
			task.emit(TumbleCodeEventName.TaskCompleted, "task-1", tokenUsage, toolUsage)
			expect(completed).toHaveBeenCalledTimes(1)
		})

		test("a parent that turns idle or resumable gets the subagent results waiting for it", () => {
			const deliverIfIdle = vi.spyOn(provider.backgroundSubagents, "deliverIfIdle").mockImplementation(() => {})

			provider.emit(TumbleCodeEventName.TaskIdle, "parent-1")
			provider.emit(TumbleCodeEventName.TaskResumable, "parent-2")

			expect(deliverIfIdle.mock.calls).toEqual([["parent-1"], ["parent-2"]])
		})

		test("the delegation host's emit reaches provider listeners with its arguments", () => {
			const listener = vi.fn()
			provider.on(TumbleCodeEventName.TaskDelegationCompleted, listener)

			const host = (provider as any).delegation.host
			expect(host.emit(TumbleCodeEventName.TaskDelegationCompleted, "parent-1", "child-1", "done")).toBe(true)
			expect(listener).toHaveBeenCalledWith("parent-1", "child-1", "done")
		})

		test.each([
			["a streaming failure of the foreground task", true, {}, "instance-1"],
			["a user cancel", false, { abortReason: "user_cancelled" }, "instance-1"],
			["a background task", false, { isBackground: true }, "instance-1"],
			["an instance already replaced on screen", false, {}, "instance-2"],
		])("an abort of %s rehydrates it from history: %s", async (_name, rehydrates, overrides, currentInstanceId) => {
			const task = await makeTask({
				abortReason: "streaming_failed",
				isBackground: false,
				parentTask: { taskId: "parent" },
				...overrides,
			})
			attach(task)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue({ ...task, instanceId: currentInstanceId })
			vi.spyOn(provider, "getHistoryItem").mockResolvedValue({ id: "task-1", task: "t" } as any)
			const rehydrate = vi.spyOn(provider, "createTaskWithHistoryItem").mockResolvedValue(task)

			task.emit(TumbleCodeEventName.TaskAborted)
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(rehydrate.mock.calls).toEqual(
				rehydrates ? [[{ id: "task-1", task: "t", parentTask: { taskId: "parent" } }]] : [],
			)
		})

		test("a failed rehydrate is logged, not thrown", async () => {
			const task = await makeTask({ abortReason: "streaming_failed", isBackground: false })
			attach(task)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)
			vi.spyOn(provider, "getHistoryItem").mockRejectedValue(new Error("Task not found"))

			task.emit(TumbleCodeEventName.TaskAborted)
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(logger.error).toHaveBeenCalledWith(
				"[onTaskAborted] Failed to rehydrate after streaming failure: Task not found",
			)
		})

		test("removing the task from the slot detaches every forwarded listener", async () => {
			const task = await makeTask()
			attach(task)
			await provider.setCurrentTask(task)

			await provider.clearCurrentTask()

			expect(task.eventNames()).toEqual([])
		})
	})
})

describe("Project MCP Settings", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockWebviewView: any
	let mockPostMessage: any

	beforeEach(async () => {
		vi.clearAllMocks()
		const pathUtils = await import("../../../utils/path")
		vi.mocked(pathUtils.getWorkspacePath).mockReturnValue("")

		mockContext = createMockContext()
		mockPostMessage = vi.fn()
		mockWebviewView = createMockWebviewView(mockPostMessage)
		;(vscode.window as any).activeTextEditor = undefined
		;(vscode.workspace.getWorkspaceFolder as any).mockReset()
		provider = createTestProvider(mockContext)
	})

	test("handles openProjectMcpSettings message", async () => {
		// Mock workspace folders first
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
		const pathUtils = await import("../../../utils/path")
		vi.mocked(pathUtils.getWorkspacePath).mockReturnValue("/test/workspace")

		// Mock fs functions
		const fs = await import("fs/promises")
		const mockedFs = vi.mocked(fs)
		mockedFs.mkdir.mockClear()
		mockedFs.mkdir.mockResolvedValue(undefined)
		mockedFs.writeFile.mockClear()
		mockedFs.writeFile.mockResolvedValue(undefined)

		// Mock fileExistsAtPath to return false (file doesn't exist)
		const fsUtils = await import("../../../utils/fs")
		vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(false)

		// Mock openFile
		const openFileModule = await import("../../../integrations/misc/open-file")
		const openFileSpy = vi.spyOn(openFileModule, "openFile").mockClear().mockResolvedValue(undefined)

		// Set up the webview
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Trigger openProjectMcpSettings through the message handler
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		const expectedRooDir = path.join("/test/workspace", ".roo")
		const expectedMcpPath = path.join(expectedRooDir, "mcp.json")

		// Check that fs.mkdir was called with the correct path
		expect(mockedFs.mkdir).toHaveBeenCalledWith(expectedRooDir, { recursive: true })

		// Verify file was created with default content
		expect(safeWriteJson).toHaveBeenCalledWith(expectedMcpPath, { mcpServers: {} }, { prettyPrint: true })

		// Check that openFile was called
		expect(openFileSpy).toHaveBeenCalledWith(expectedMcpPath)
	})

	test("handles openProjectMcpSettings when workspace is not open", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock no workspace folders
		;(vscode.workspace as any).workspaceFolders = []

		// Trigger openProjectMcpSettings
		await messageHandler({ type: "openProjectMcpSettings" })

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.no_workspace")
	})

	test("handles openProjectMcpSettings file creation error", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
		const pathUtils = await import("../../../utils/path")
		vi.mocked(pathUtils.getWorkspacePath).mockReturnValue("/test/workspace")

		// Mock fs functions to fail
		const fs = await import("fs/promises")
		const mockedFs = vi.mocked(fs)
		mockedFs.mkdir.mockRejectedValue(new Error("Failed to create directory"))

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify the translated error key is surfaced in test mode
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_json")
	})
})

// The property assembly is pinned in TelemetryPropertiesSource.spec; this pins what the provider feeds it.
describe("getTelemetryProperties", () => {
	let provider: ClineProvider
	let mockCline: any

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		provider = createTestProvider(createMockContext({ mode: "code", apiProvider: "anthropic" }))
		mockCline = new Task({ provider, apiConfiguration: { apiProvider: "openrouter" } })
		mockCline.api = { getModel: vi.fn().mockReturnValue({ id: "claude-sonnet-4-20250514" }) }
	})

	test("the source reads the current task, the extension's package and the subagent runner", async () => {
		await provider.setCurrentTask(mockCline)
		vi.spyOn((provider as any).backgroundTaskRunner, "subagentParentOf").mockImplementation((id) =>
			id === "sub-1" ? mockCline.taskId : undefined,
		)

		expect(provider.appProperties).toMatchObject({ appVersion: "1.0.0" })
		expect(await provider.getTelemetryProperties()).toMatchObject({
			appVersion: "1.0.0",
			taskId: mockCline.taskId,
			modelId: "claude-sonnet-4-20250514",
		})
		expect(await provider.getTelemetryProperties("sub-1")).toMatchObject({
			taskId: "sub-1",
			parentTaskId: mockCline.taskId,
			isSubtask: true,
		})
	})

	test("a task from history takes its parent from the history store", async () => {
		await provider.setCurrentTask(mockCline)
		vi.spyOn(provider as any, "getTaskHistoryStore").mockResolvedValue({
			get: (id: string) => (id === "old-child" ? { id, parentTaskId: "old-parent" } : undefined),
		})

		expect(await provider.getTelemetryProperties("old-child")).toMatchObject({
			taskId: "old-child",
			parentTaskId: "old-parent",
			isSubtask: true,
		})
	})
})

describe("ClineProvider getTaskWithId", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockContext = createMockContext({ mode: "code", currentApiConfigName: "current-config" })

		provider = createTestProvider(mockContext)
	})

	it("returns empty apiConversationHistory when file is missing", async () => {
		const historyItem = { id: "missing-api-file-task", task: "test task", ts: Date.now() }
		const globalStateGet = vi.mocked(mockContext.globalState.get)
		globalStateGet.mockClear()
		vi.spyOn(await (provider as any).getTaskHistoryStore(), "get").mockReturnValue(historyItem as any)

		const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

		const result = await (provider as any).getTaskWithId("missing-api-file-task")

		expect(result.historyItem).toEqual(historyItem)
		expect(result.apiConversationHistory).toEqual([])
		expect(deleteTaskSpy).not.toHaveBeenCalled()
		expect(globalStateGet).not.toHaveBeenCalledWith("taskHistory")
	})

	it("returns empty apiConversationHistory when file contains invalid JSON", async () => {
		const historyItem = { id: "corrupt-api-task", task: "test task", ts: Date.now() }
		const globalStateGet = vi.mocked(mockContext.globalState.get)
		globalStateGet.mockClear()
		vi.spyOn(await (provider as any).getTaskHistoryStore(), "get").mockReturnValue(historyItem as any)

		// Make fileExistsAtPath return true so the read path is exercised
		const fsUtils = await import("../../../utils/fs")
		vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(true)

		// Make readFile return corrupted JSON
		const fsp = await import("fs/promises")
		vi.mocked(fsp.readFile).mockResolvedValueOnce("{not valid json!!!" as never)

		const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

		const result = await (provider as any).getTaskWithId("corrupt-api-task")

		expect(result.historyItem).toEqual(historyItem)
		expect(result.apiConversationHistory).toEqual([])
		expect(deleteTaskSpy).not.toHaveBeenCalled()
		expect(globalStateGet).not.toHaveBeenCalledWith("taskHistory")

		// Restore the spy
		vi.mocked(fsUtils.fileExistsAtPath).mockRestore()
	})
})
