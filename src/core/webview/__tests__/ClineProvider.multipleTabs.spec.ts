// npx vitest run core/webview/__tests__/ClineProvider.multipleTabs.spec.ts
//
// Several Tumble Code editor tabs can be open at once, each with its own
// ClineProvider, next to the sidebar. The lookups the commands use (reveal,
// focus, the title-bar buttons) must pick the panel the user was in last and
// must forget a tab as soon as it closes, without forgetting the others.

import * as vscode from "vscode"
import { TelemetryService } from "@tumble-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import type { Task } from "../../task/Task"
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

const webviewFields = () => ({
	webview: {
		postMessage: vi.fn().mockResolvedValue(true),
		html: "",
		options: {},
		onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
		asWebviewUri: vi.fn(),
		cspSource: "vscode-webview://test-csp-source",
	},
	visible: true,
})

/** An editor tab (a WebviewPanel) whose focus and close the test drives. */
const fakeTab = (viewColumn: number) => {
	let onViewState: (() => void) | undefined
	let onDispose: (() => void) | undefined
	const panel = {
		...webviewFields(),
		active: false,
		viewColumn,
		reveal: vi.fn(),
		onDidChangeViewState: vi.fn((listener: () => void) => {
			onViewState = listener
			return { dispose: vi.fn() }
		}),
		onDidDispose: vi.fn((listener: () => void) => {
			onDispose = listener
			return { dispose: vi.fn() }
		}),
	}
	return {
		panel,
		focus: () => {
			panel.active = true
			onViewState?.()
		},
		blur: () => {
			panel.active = false
			onViewState?.()
		},
		close: () => onDispose?.(),
	}
}

/** The sidebar (a WebviewView). */
const fakeSidebar = () => {
	let onVisibility: (() => void) | undefined
	const view = {
		...webviewFields(),
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeVisibility: vi.fn((listener: () => void) => {
			onVisibility = listener
			return { dispose: vi.fn() }
		}),
	}
	return {
		view,
		show: () => {
			view.visible = true
			onVisibility?.()
		},
	}
}

const mcpHubStub = () => ({
	listTools: vi.fn().mockResolvedValue([]),
	callTool: vi.fn().mockResolvedValue({ content: [] }),
	listResources: vi.fn().mockResolvedValue([]),
	readResource: vi.fn().mockResolvedValue({ contents: [] }),
	getAllServers: vi.fn().mockReturnValue([]),
})

describe("ClineProvider - several editor tabs", () => {
	let context: vscode.ExtensionContext
	let contextProxy: ContextProxy
	let providers: ClineProvider[]

	const createProvider = (renderContext: "sidebar" | "editor") => {
		const outputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel
		const provider = new ClineProvider(context, outputChannel, renderContext, contextProxy)
		provider.getMcpHub = vi.fn().mockReturnValue(mcpHubStub())
		providers.push(provider)
		return provider
	}

	const openTab = async (viewColumn = 2) => {
		const provider = createProvider("editor")
		const tab = fakeTab(viewColumn)
		await provider.resolveWebviewView(tab.panel as unknown as vscode.WebviewPanel)
		return { provider, ...tab }
	}

	const openSidebar = async () => {
		const provider = createProvider("sidebar")
		const sidebar = fakeSidebar()
		await provider.resolveWebviewView(sidebar.view as unknown as vscode.WebviewView)
		return { provider, ...sidebar }
	}

	beforeEach(() => {
		vi.clearAllMocks()
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
		context = makeContext()
		contextProxy = new ContextProxy(context)
		providers = []
	})

	afterEach(async () => {
		for (const provider of providers) {
			await provider.dispose()
		}
	})

	it("getEditorTab returns the tab the user focused last, not the newest one", async () => {
		const a = await openTab()
		const b = await openTab()
		expect(ClineProvider.getEditorTab()).toBe(b.panel)

		b.blur()
		a.focus()

		expect(ClineProvider.getEditorTab()).toBe(a.panel)
	})

	it("closing one tab keeps the other one reachable, even while the closed one is still disposing", async () => {
		const a = await openTab()
		const b = await openTab()
		b.focus()

		// The close listener starts the provider's async dispose; the lookups
		// must skip it from that moment, its panel is gone.
		b.close()

		expect(ClineProvider.getEditorTab()).toBe(a.panel)
		expect(ClineProvider.getLastActiveInstance()).toBe(a.provider)
		expect(ClineProvider.getVisibleInstance()).toBe(a.provider)
	})

	it("getVisibleInstance picks the visible panel the user was in last", async () => {
		const sidebar = await openSidebar()
		const a = await openTab(1)
		const b = await openTab(2)
		expect(ClineProvider.getVisibleInstance()).toBe(b.provider)

		a.focus()
		expect(ClineProvider.getVisibleInstance()).toBe(a.provider)

		sidebar.show()
		expect(ClineProvider.getVisibleInstance()).toBe(sidebar.provider)
	})

	it("getEditorTab never returns the sidebar", async () => {
		const tab = await openTab()
		const sidebar = await openSidebar()
		sidebar.show()

		expect(ClineProvider.getEditorTab()).toBe(tab.panel)
		expect(ClineProvider.getLastActiveInstance()).toBe(sidebar.provider)
	})

	it("a click in one tab (focusPanelRequest) reveals that tab in place, never another one", async () => {
		const a = await openTab(1)
		const b = await openTab(2)
		b.focus()

		await webviewMessageHandler(a.provider, { type: "focusPanelRequest" })

		expect(a.panel.reveal).toHaveBeenCalledWith(undefined, false)
		expect(b.panel.reveal).not.toHaveBeenCalled()
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("revealView leaves an active tab alone and focuses the sidebar view", async () => {
		const tab = await openTab()
		tab.focus()
		await tab.provider.revealView()
		expect(tab.panel.reveal).not.toHaveBeenCalled()

		const sidebar = await openSidebar()
		await sidebar.provider.revealView()
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${ClineProvider.sideBarId}.focus`)
	})

	it("revealView focuses the sidebar even before its view was ever resolved", async () => {
		// The API and the remote-control bridge can run a task in the sidebar
		// provider before the user ever opened the sidebar.
		const sidebar = createProvider("sidebar")

		await sidebar.revealView()

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${ClineProvider.sideBarId}.focus`)
	})

	it("opening a task that another panel runs shows it in that panel instead of starting it twice", async () => {
		const a = await openTab(1)
		const b = await openTab(2)
		const liveTask = { taskId: "task-1" } as unknown as Task
		vi.spyOn(a.provider, "findLiveTask").mockImplementation((id) => (id === "task-1" ? liveTask : undefined))
		const showInA = vi.spyOn(a.provider, "showTaskWithId").mockResolvedValue(undefined)
		const historyInB = vi.spyOn(b.provider, "getHistoryItem")

		await b.provider.showTaskWithId("task-1")

		expect(showInA).toHaveBeenCalledWith("task-1")
		expect(a.panel.reveal).toHaveBeenCalledWith(undefined, false)
		expect(historyInB).not.toHaveBeenCalled()
	})
})
