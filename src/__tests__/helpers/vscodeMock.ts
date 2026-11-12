/**
 * Shared `vi.mock("vscode", ...)` factory body for the webview resume specs
 * (history-resume-delegation, nested-delegation-resume, task-resume-ui).
 *
 * vitest hoists vi.mock above every import, so the factory cannot reference a
 * normally imported helper; it pulls this one in with a dynamic import (the
 * same recipe as api/providers/__tests__/provider-test-helpers.ts):
 *
 *   vi.mock("vscode", async () => {
 *   	const { vscodeModuleMock } = await import("./helpers/vscodeMock")
 *   	return vscodeModuleMock()
 *   })
 *
 * A spec whose stand-in needs more members (task-resume-ui's document
 * listeners, its Test extension mode) passes them as extras, merged over the
 * base.
 */

type VscodeMockExtras = {
	window?: Record<string, unknown>
	workspace?: Record<string, unknown>
	ExtensionMode?: Record<string, number>
}

export const vscodeModuleMock = (extras: VscodeMockExtras = {}) => {
	const window = {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	}
	const workspace = {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((_key: string, defaultValue: any) => defaultValue),
			update: vi.fn(),
		})),
		workspaceFolders: [],
	}
	const env = { machineId: "test-machine", uriScheme: "vscode", appName: "VSCode", language: "en", sessionId: "sess" }
	const Uri = { file: (p: string) => ({ fsPath: p, toString: () => p }) }
	const commands = { executeCommand: vi.fn() }
	const ExtensionMode = { Development: 2 }
	const version = "1.0.0-test"
	return {
		window: { ...window, ...extras.window },
		workspace: { ...workspace, ...extras.workspace },
		env,
		Uri,
		commands,
		ExtensionMode: { ...ExtensionMode, ...extras.ExtensionMode },
		version,
	}
}
