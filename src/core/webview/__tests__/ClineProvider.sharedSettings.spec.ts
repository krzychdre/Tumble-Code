// npx vitest run core/webview/__tests__/ClineProvider.sharedSettings.spec.ts
//
// The sidebar and every editor tab are separate ClineProviders sharing one
// ContextProxy. A setting written through one of them must reach the other
// panels' webviews too: before, only the writer's webview was pushed, so the
// other panel's switch kept the old value and a click sent its inverse.

import * as vscode from "vscode"
import { TelemetryService } from "@tumble-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { webviewMessageHandler } from "../webviewMessageHandler"

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

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation(function (options) {
		return {
			taskId: options.taskId || "test-task-id",
			saveClineMessages: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			abortTask: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			getTaskNumber: vi.fn().mockReturnValue(0),
			setTaskNumber: vi.fn(),
			setParentTask: vi.fn(),
			setRootTask: vi.fn(),
			emit: vi.fn(),
			parentTask: options.parentTask,
			updateApiConfiguration: vi.fn(),
			setTaskApiConfigName: vi.fn(),
			_taskApiConfigName: options.historyItem?.apiConfigName,
			taskApiConfigName: options.historyItem?.apiConfigName,
		}
	}),
}))

vi.mock("../../prompts/sections/custom-instructions")

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

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(function () {
		return {
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
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
			}
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

vi.mock("../../../shared/modes", () => {
	const mockModes = [
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
			roleDefinition: "You are an assistant",
			groups: ["read"],
		},
		{
			slug: "debug",
			name: "Debug Mode",
			roleDefinition: "You are a debugger",
			groups: ["read", "edit"],
		},
		{
			slug: "orchestrator",
			name: "Orchestrator Mode",
			roleDefinition: "You are an orchestrator",
			groups: [],
		},
	]

	return {
		modes: mockModes,
		getAllModes: vi.fn((customModes?: Array<{ slug: string }>) => {
			if (!customModes?.length) {
				return [...mockModes]
			}
			const allModes = [...mockModes]
			customModes.forEach((cm) => {
				const idx = allModes.findIndex((m) => m.slug === cm.slug)
				if (idx !== -1) {
					allModes[idx] = cm as (typeof mockModes)[number]
				} else {
					allModes.push(cm as (typeof mockModes)[number])
				}
			})
			return allModes
		}),
		getModeBySlug: vi.fn().mockReturnValue({
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		}),
		defaultModeSlug: "code",
	}
})

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				setProvider: vi.fn(),
				capture: vi.fn(),
			}
		},
	},
}))

type PostMessage = ReturnType<typeof vi.fn>

const makeContext = () => {
	const globalState: Record<string, unknown> = { mode: "code", currentApiConfigName: "default-profile" }
	const workspaceState: Record<string, unknown> = {}
	const secrets: Record<string, string | undefined> = {}
	return {
		extensionPath: "/test/path",
		extensionUri: {} as vscode.Uri,
		globalState: {
			get: vi.fn().mockImplementation((key: string) => globalState[key]),
			update: vi.fn().mockImplementation((key: string, value: unknown) => {
				globalState[key] = value
				return Promise.resolve()
			}),
			keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
		},
		secrets: {
			get: vi.fn().mockImplementation((key: string) => secrets[key]),
			store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
				secrets[key] = value
				return Promise.resolve()
			}),
			delete: vi.fn().mockImplementation((key: string) => {
				delete secrets[key]
				return Promise.resolve()
			}),
		},
		workspaceState: {
			get: vi
				.fn()
				.mockImplementation((key: string, defaultValue?: unknown) =>
					key in workspaceState ? workspaceState[key] : defaultValue,
				),
			update: vi.fn().mockImplementation((key: string, value: unknown) => {
				workspaceState[key] = value
				return Promise.resolve()
			}),
			keys: vi.fn().mockImplementation(() => Object.keys(workspaceState)),
		},
		subscriptions: [],
		extension: { packageJSON: { version: "1.0.0" } },
		globalStorageUri: { fsPath: "/test/storage/path" },
	} as unknown as vscode.ExtensionContext
}

const webviewFields = (postMessage: PostMessage) => ({
	webview: {
		postMessage,
		html: "",
		options: {},
		onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
		asWebviewUri: vi.fn(),
		cspSource: "vscode-webview://test-csp-source",
	},
	visible: true,
	onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
})

/** The sidebar: a WebviewView. */
const sidebarView = (postMessage: PostMessage) =>
	({
		...webviewFields(postMessage),
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
	}) as unknown as vscode.WebviewView

/** An editor tab: a WebviewPanel. */
const tabPanel = (postMessage: PostMessage) =>
	({
		...webviewFields(postMessage),
		onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
	}) as unknown as vscode.WebviewPanel

const statePushes = (postMessage: PostMessage) =>
	postMessage.mock.calls.map(([message]) => message).filter((message) => message?.type === "state")

const mcpHubStub = () => ({
	listTools: vi.fn().mockResolvedValue([]),
	callTool: vi.fn().mockResolvedValue({ content: [] }),
	listResources: vi.fn().mockResolvedValue([]),
	readResource: vi.fn().mockResolvedValue({ contents: [] }),
	getAllServers: vi.fn().mockReturnValue([]),
})

/** Longer than the 50 ms coalescing window plus the state build. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

describe("ClineProvider - shared settings reach every open panel", () => {
	let context: vscode.ExtensionContext
	let outputChannel: vscode.OutputChannel
	let providers: ClineProvider[]

	const createProvider = (renderContext: "sidebar" | "editor", contextProxy: ContextProxy) => {
		const provider = new ClineProvider(context, outputChannel, renderContext, contextProxy)
		provider.getMcpHub = vi.fn().mockReturnValue(mcpHubStub())
		providers.push(provider)
		return provider
	}

	beforeEach(() => {
		vi.clearAllMocks()
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
		context = makeContext()
		outputChannel = { appendLine: vi.fn(), clear: vi.fn(), dispose: vi.fn() } as unknown as vscode.OutputChannel
		providers = []
	})

	afterEach(async () => {
		for (const provider of providers) {
			await provider.dispose()
		}
	})

	async function openSidebarAndTab() {
		const contextProxy = new ContextProxy(context)
		const sidebar = createProvider("sidebar", contextProxy)
		const tab = createProvider("editor", contextProxy)
		const sidebarPost = vi.fn().mockResolvedValue(true)
		const tabPost = vi.fn().mockResolvedValue(true)
		await sidebar.resolveWebviewView(sidebarView(sidebarPost))
		await tab.resolveWebviewView(tabPanel(tabPost))
		await settle()
		sidebarPost.mockClear()
		tabPost.mockClear()
		return { contextProxy, sidebar, tab, sidebarPost, tabPost }
	}

	it("a switch flipped in the editor tab is pushed to the sidebar webview too", async () => {
		const { tab, sidebarPost, tabPost } = await openSidebarAndTab()

		await webviewMessageHandler(tab, { type: "updateSettings", updatedSettings: { alwaysAllowWrite: true } })

		// The writer refreshes its own webview, as before.
		expect(statePushes(tabPost).at(-1)?.state.alwaysAllowWrite).toBe(true)
		// The other panel learns the new value without any action of its own.
		await vi.waitFor(() => expect(statePushes(sidebarPost).at(-1)?.state.alwaysAllowWrite).toBe(true))
		// A push for settings never carries the chat (it would race the task stream).
		expect(statePushes(sidebarPost).at(-1)?.state.clineMessages).toBeUndefined()
	})

	it("a switch flipped in the sidebar is pushed to the editor tab", async () => {
		const { sidebar, tabPost } = await openSidebarAndTab()

		await webviewMessageHandler(sidebar, { type: "autoApprovalEnabled", bool: true })

		await vi.waitFor(() => expect(statePushes(tabPost).at(-1)?.state.autoApprovalEnabled).toBe(true))
	})

	it("a write that bypasses the webview (the remote-control bridge) reaches every panel", async () => {
		const { contextProxy, sidebarPost, tabPost } = await openSidebarAndTab()

		await contextProxy.setValue("alwaysAllowExecute", true)

		await vi.waitFor(() => {
			expect(statePushes(sidebarPost).at(-1)?.state.alwaysAllowExecute).toBe(true)
			expect(statePushes(tabPost).at(-1)?.state.alwaysAllowExecute).toBe(true)
		})
	})

	it("coalesces a burst of writes into one push per panel", async () => {
		const { contextProxy, sidebarPost } = await openSidebarAndTab()

		await contextProxy.setValues({ alwaysAllowReadOnly: true, alwaysAllowWrite: true, alwaysAllowExecute: true })
		await settle()

		expect(statePushes(sidebarPost)).toHaveLength(1)
	})

	it("a lone panel gets no extra push: the writer already refreshes it", async () => {
		const contextProxy = new ContextProxy(context)
		const sidebar = createProvider("sidebar", contextProxy)
		const sidebarPost = vi.fn().mockResolvedValue(true)
		await sidebar.resolveWebviewView(sidebarView(sidebarPost))
		await settle()
		sidebarPost.mockClear()

		await contextProxy.setValue("alwaysAllowWrite", true)
		await settle()

		expect(statePushes(sidebarPost)).toHaveLength(0)
	})

	it("a closed editor tab stops listening", async () => {
		const { contextProxy, tab, sidebarPost, tabPost } = await openSidebarAndTab()
		await tab.dispose()

		await contextProxy.setValue("alwaysAllowWrite", true)
		await settle()

		expect(statePushes(tabPost)).toHaveLength(0)
		// Alone again: the sidebar is refreshed by the writer only.
		expect(statePushes(sidebarPost)).toHaveLength(0)
	})

	it("postStateToAllWebviewsWithoutClineMessages pushes every open panel", async () => {
		const { sidebarPost, tabPost } = await openSidebarAndTab()

		await ClineProvider.postStateToAllWebviewsWithoutClineMessages()

		expect(statePushes(sidebarPost)).toHaveLength(1)
		expect(statePushes(tabPost)).toHaveLength(1)
	})
})
