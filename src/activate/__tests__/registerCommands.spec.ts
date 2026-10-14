import type { Mock } from "vitest"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

import { TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { getVisibleProviderOrLog, registerCommands, replaceOrphanedTabs } from "../registerCommands"
import { STATUS_BAR_CLICK_SOURCE } from "../statusBar"
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

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

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

		await replaceOrphanedTabs(options)

		expect(vscode.window.tabGroups.close).not.toHaveBeenCalled()
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
	})

	it("closes a tab left by the previous host and opens a working one in its group", async () => {
		const orphan = tab(`mainThreadWebview-${ClineProvider.tabPanelId}`, 3)
		setTabs([tab("mainThreadWebview-other.panel", 1), orphan])

		await replaceOrphanedTabs(options)

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

	it("replaces every orphaned tab, each in its own group", async () => {
		const first = tab(`mainThreadWebview-${ClineProvider.tabPanelId}`, 2)
		const second = tab(`mainThreadWebview-${ClineProvider.tabPanelId}`, 3)
		setTabs([first, second])

		await replaceOrphanedTabs(options)

		expect(vscode.window.tabGroups.close).toHaveBeenCalledWith([first, second])
		const columns = vi.mocked(vscode.window.createWebviewPanel).mock.calls.map(([, , column]) => column)
		expect(columns).toEqual([2, 3])
	})
})

/** Registers the commands and runs the one whose id ends with `.${name}`. */
const runRegisteredCommand = async (name: string, provider = {} as ClineProvider, ...args: unknown[]) => {
	registerCommands({
		context: { subscriptions: [], extensionUri: {} } as unknown as vscode.ExtensionContext,
		outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
		provider,
	})
	const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([id]) => id.endsWith(`.${name}`))
	expect(call).toBeDefined()
	await call![1](...args)
}

describe("openInNewTab", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = []
	})

	it("opens a second tab beside the Tumble tab used last, without an empty new group", async () => {
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue({ viewColumn: 3 } as unknown as vscode.WebviewPanel)

		await runRegisteredCommand("openInNewTab")

		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			"Tumble Code",
			3,
			expect.anything(),
		)
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.newGroupRight")
	})

	it("opens the first tab in a new group to the right when no editor is visible", async () => {
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(undefined)

		await runRegisteredCommand("openInNewTab")

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.action.newGroupRight")
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
			ClineProvider.tabPanelId,
			"Tumble Code",
			2,
			expect.anything(),
		)
	})
})

describe("focusPanel and focusInput", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("focusPanel reveals the panel the user was in last", async () => {
		const host = { revealView: vi.fn() }
		vi.mocked(ClineProvider.getLastActiveInstance).mockReturnValue(host as unknown as ClineProvider)

		await runRegisteredCommand("focusPanel")

		expect(host.revealView).toHaveBeenCalledTimes(1)
	})

	it("focusPanel opens the sidebar when no panel is open", async () => {
		vi.mocked(ClineProvider.getLastActiveInstance).mockReturnValue(undefined)

		await runRegisteredCommand("focusPanel")

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			expect.stringMatching(/^workbench\.view\.extension\./),
		)
	})

	it("focusInput asks the sidebar to focus its input only when the sidebar was used last", async () => {
		const sidebar = { revealView: vi.fn(), postMessageToWebview: vi.fn() }
		const tab = { revealView: vi.fn(), postMessageToWebview: vi.fn() }

		vi.mocked(ClineProvider.getLastActiveInstance).mockReturnValue(tab as unknown as ClineProvider)
		await runRegisteredCommand("focusInput", sidebar as unknown as ClineProvider)
		expect(tab.revealView).toHaveBeenCalledTimes(1)
		expect(sidebar.postMessageToWebview).not.toHaveBeenCalled()

		vi.mocked(ClineProvider.getLastActiveInstance).mockReturnValue(sidebar as unknown as ClineProvider)
		await runRegisteredCommand("focusInput", sidebar as unknown as ClineProvider)
		expect(sidebar.postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "focusInput" })
	})
})

describe("editorTitleButtonClicked", () => {
	const runCommand = async (...args: unknown[]) => {
		registerCommands({
			context: { subscriptions: [], extensionUri: {} } as unknown as vscode.ExtensionContext,
			outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
			provider: {} as ClineProvider,
		})
		const call = vi
			.mocked(vscode.commands.registerCommand)
			.mock.calls.find(([id]) => id.endsWith(".editorTitleButtonClicked"))
		expect(call).toBeDefined()
		await call![1](...args)
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reveals the open Tumble tab instead of opening a second one", async () => {
		const panel = { reveal: vi.fn() }
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(panel as unknown as vscode.WebviewPanel)

		await runCommand()

		expect(panel.reveal).toHaveBeenCalledTimes(1)
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
	})

	it("opens a new Tumble tab when none is open", async () => {
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(undefined)

		await runCommand()

		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
	})

	it("reports a click from the editor title bar, which passes the editor's URI", async () => {
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(undefined)

		await runCommand({ scheme: "file", path: "/mock/workspace/a.ts" })

		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.TITLE_BUTTON_CLICKED, {
			button: "editorTitle",
		})
	})

	it("reports a click from the status bar item and reveals the open tab", async () => {
		const panel = { reveal: vi.fn() }
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(panel as unknown as vscode.WebviewPanel)

		await runCommand(STATUS_BAR_CLICK_SOURCE)

		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.TITLE_BUTTON_CLICKED, {
			button: "statusBar",
		})
		expect(panel.reveal).toHaveBeenCalledTimes(1)
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
	})

	it("opens a new tab from the status bar item when none is open", async () => {
		vi.mocked(ClineProvider.getEditorTab).mockReturnValue(undefined)

		await runCommand(STATUS_BAR_CLICK_SOURCE)

		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
	})
})
