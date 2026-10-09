import type { Mock } from "vitest"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

import { getVisibleProviderOrLog, openStartupTab, registerCommands, replaceOrphanedTabs } from "../registerCommands"
import { logger } from "../../utils/logging"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("vscode", () => ({
	TabInputWebview: class {
		constructor(public viewType: string) {}
	},
	Uri: { joinPath: vi.fn(() => ({})) },
	ViewColumn: { Two: 2 },
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		executeCommand: vi.fn(),
	},
	window: {
		createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		createWebviewPanel: vi.fn(() => ({ onDidDispose: vi.fn() })),
		tabGroups: { all: [], close: vi.fn() },
		visibleTextEditors: [],
	},
	workspace: {
		getConfiguration: vi.fn(() => ({ get: (_key: string, defaultValue: unknown) => defaultValue })),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
	},
}))

vi.mock("../../core/webview/ClineProvider")

vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: { getInstance: vi.fn().mockResolvedValue({}) },
}))

vi.mock("../../services/code-index/manager", () => ({
	CodeIndexManager: { getInstance: vi.fn() },
}))

vi.mock("delay", () => ({ default: vi.fn() }))

vi.mock("../../services/ripgrep/diagnostic", () => ({
	registerRipgrepDiagnosticCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}))

describe("getVisibleProviderOrLog", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(logger, "warn").mockImplementation(() => {})
	})

	it("returns the visible provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(mockProvider)

		const result = getVisibleProviderOrLog()

		expect(result).toBe(mockProvider)
		expect(logger.warn).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no provider found", () => {
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(undefined)

		const result = getVisibleProviderOrLog()

		expect(result).toBeUndefined()
		expect(logger.warn).toHaveBeenCalledWith("Cannot find any visible Tumble Code instances.")
	})
})

describe("registerCommands", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("registers the ripgrep diagnostic command and stores its disposable in context.subscriptions", async () => {
		const { registerRipgrepDiagnosticCommand } = await import("../../services/ripgrep/diagnostic")

		const mockContext = {
			subscriptions: [] as { dispose: () => void }[],
		} as unknown as vscode.ExtensionContext
		const mockOutputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		const mockProvider = {} as ClineProvider

		registerCommands({
			context: mockContext,
			outputChannel: mockOutputChannel,
			provider: mockProvider,
		})

		const mock = vi.mocked(registerRipgrepDiagnosticCommand)
		const disposable = mock.mock.results[0]?.value
		expect(mock).toHaveBeenCalled()
		expect(mockContext.subscriptions).toContain(disposable)
	})
})

describe("replaceOrphanedTabs", () => {
	const options = {
		context: { subscriptions: [], extensionUri: {} } as unknown as vscode.ExtensionContext,
		outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
	}

	const tab = (viewType: string, viewColumn: number) =>
		({ input: new vscode.TabInputWebview(viewType), group: { viewColumn } }) as unknown as vscode.Tab

	const setTabs = (tabs: vscode.Tab[]) => {
		;(vscode.window.tabGroups as { all: unknown }).all = [{ tabs }]
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does nothing when no Tumble tab is open", async () => {
		setTabs([tab("mainThreadWebview-other.panel", 1)])

		expect(await replaceOrphanedTabs(options)).toBe(false)

		expect(vscode.window.tabGroups.close).not.toHaveBeenCalled()
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
	})

	it("closes a tab left by the previous host and opens a working one in its group", async () => {
		const orphan = tab(`mainThreadWebview-${ClineProvider.tabPanelId}`, 3)
		setTabs([tab("mainThreadWebview-other.panel", 1), orphan])

		expect(await replaceOrphanedTabs(options)).toBe(true)

		expect(vscode.window.tabGroups.close).toHaveBeenCalledWith([orphan])
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			"Tumble Code",
			3,
			expect.anything(),
		)
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.newGroupRight")
		expect(vi.mocked(ClineProvider).mock.instances[0].resolveWebviewView).toHaveBeenCalled()
	})
})

describe("openStartupTab", () => {
	const options = {
		context: { subscriptions: [], extensionUri: {} } as unknown as vscode.ExtensionContext,
		outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
	}

	const tab = (viewType: string, viewColumn: number) =>
		({ input: new vscode.TabInputWebview(viewType), group: { viewColumn } }) as unknown as vscode.Tab

	const setTabs = (tabs: vscode.Tab[]) => {
		;(vscode.window.tabGroups as { all: unknown }).all = [{ tabs }]
	}

	const setOpenInEditorOnStartup = (value: boolean) => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: (key: string, defaultValue: unknown) => (key === "openInEditorOnStartup" ? value : defaultValue),
		} as unknown as vscode.WorkspaceConfiguration)
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("opens no tab when the setting is off and no Tumble tab is open", async () => {
		setOpenInEditorOnStartup(false)
		setTabs([])

		await openStartupTab(options)

		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
	})

	it("opens one tab when the setting is on and no Tumble tab is open", async () => {
		setOpenInEditorOnStartup(true)
		setTabs([])

		await openStartupTab(options)

		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			"Tumble Code",
			expect.anything(),
			expect.anything(),
		)
	})

	it("opens only the replacement tab, in the orphan's group, when the setting is on", async () => {
		setOpenInEditorOnStartup(true)
		const orphan = tab(`mainThreadWebview-${ClineProvider.tabPanelId}`, 3)
		setTabs([orphan])

		await openStartupTab(options)

		expect(vscode.window.tabGroups.close).toHaveBeenCalledWith([orphan])
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			"Tumble Code",
			3,
			expect.anything(),
		)
	})
})
