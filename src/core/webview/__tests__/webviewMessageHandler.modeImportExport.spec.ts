// Characterization tests for the "exportMode" and "importMode" messages
// (CORE-R3 moves them into their own module; these pin today's behavior first).
//
// Run: cd src && ./node_modules/.bin/vitest run core/webview/__tests__/webviewMessageHandler.modeImportExport.spec.ts

import type { WebviewMessage } from "@roo-code/types"

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showSaveDialog: vi.fn(),
		showOpenDialog: vi.fn(),
	},
	workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }], getConfiguration: vi.fn() },
	Uri: { file: (p: string) => ({ fsPath: p }) },
}))

vi.mock("fs/promises", () => {
	const api = { readFile: vi.fn(), writeFile: vi.fn() }
	return { ...api, default: api }
})

vi.mock("../../../utils/export", () => ({
	resolveDefaultSaveUri: vi.fn(async (_proxy: unknown, _key: string, name: string) => ({ fsPath: `/dl/${name}` })),
	saveLastExportPath: vi.fn(),
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
	changeLanguage: vi.fn(),
}))

vi.mock("../ClineProvider", () => ({ ClineProvider: class {} }))

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { resolveDefaultSaveUri, saveLastExportPath } from "../../../utils/export"
import { webviewMessageHandler } from "../webviewMessageHandler"

function createProvider(globalState: Record<string, unknown> = {}) {
	const state = { ...globalState }
	return {
		state,
		contextProxy: {
			getValue: vi.fn((key: string) => state[key]),
			setValue: vi.fn(async (key: string, value: unknown) => {
				state[key] = value
			}),
		},
		customModesManager: {
			exportModeWithRules: vi.fn().mockResolvedValue({ success: true, yaml: "slug: code\n" }),
			importModeWithRules: vi.fn().mockResolvedValue({ success: true, slug: "imported" }),
			getCustomModes: vi.fn().mockResolvedValue([{ slug: "imported" }]),
		},
		postMessageToWebview: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		log: vi.fn(),
	}
}

const send = (provider: unknown, message: Record<string, unknown>) =>
	webviewMessageHandler(provider as any, message as unknown as WebviewMessage)

beforeEach(() => {
	vi.clearAllMocks()
})

describe("webviewMessageHandler: exportMode", () => {
	it("does nothing without a slug", async () => {
		const provider = createProvider()
		await send(provider, { type: "exportMode" })
		expect(provider.customModesManager.exportModeWithRules).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("exports the mode with its customized prompt and writes the chosen file", async () => {
		const provider = createProvider({ customModePrompts: { code: { roleDefinition: "custom" } } })
		vi.mocked(vscode.window.showSaveDialog).mockResolvedValue({ fsPath: "/out/code.yaml" } as any)

		await send(provider, { type: "exportMode", slug: "code" })

		expect(provider.customModesManager.exportModeWithRules).toHaveBeenCalledWith("code", {
			roleDefinition: "custom",
		})
		expect(resolveDefaultSaveUri).toHaveBeenCalledWith(
			provider.contextProxy,
			"lastModeExportPath",
			"code-export.yaml",
			{ useWorkspace: true, fallbackDir: path.join(os.homedir(), "Downloads") },
		)
		expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
			defaultUri: { fsPath: "/dl/code-export.yaml" },
			filters: { "YAML files": ["yaml", "yml"] },
			title: "Save mode export",
		})
		expect(saveLastExportPath).toHaveBeenCalledWith(provider.contextProxy, "lastModeExportPath", {
			fsPath: "/out/code.yaml",
		})
		expect(fs.writeFile).toHaveBeenCalledWith("/out/code.yaml", "slug: code\n", "utf-8")
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "exportModeResult",
			success: true,
			slug: "code",
		})
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('common:info.mode_exported {"mode":"code"}')
	})

	it("passes an undefined prompt for a mode without customization", async () => {
		const provider = createProvider()
		await send(provider, { type: "exportMode", slug: "ask" })
		expect(provider.customModesManager.exportModeWithRules).toHaveBeenCalledWith("ask", undefined)
	})

	it("reports a cancelled save dialog", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined)

		await send(provider, { type: "exportMode", slug: "code" })

		expect(fs.writeFile).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "exportModeResult",
			success: false,
			error: "Export cancelled",
			slug: "code",
		})
	})

	it("forwards the export error from the modes manager", async () => {
		const provider = createProvider()
		provider.customModesManager.exportModeWithRules.mockResolvedValue({ success: false, error: "no such mode" })

		await send(provider, { type: "exportMode", slug: "nope" })

		expect(vscode.window.showSaveDialog).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "exportModeResult",
			success: false,
			error: "no such mode",
			slug: "nope",
		})
	})

	it("logs and reports a thrown error", async () => {
		const provider = createProvider()
		provider.customModesManager.exportModeWithRules.mockRejectedValue(new Error("boom"))

		await send(provider, { type: "exportMode", slug: "code" })

		expect(provider.log).toHaveBeenCalledWith("Failed to export mode code: boom")
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "exportModeResult",
			success: false,
			error: "boom",
			slug: "code",
		})
	})
})

describe("webviewMessageHandler: importMode", () => {
	it("opens the picker in the workspace and reports a cancelled dialog", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined)

		await send(provider, { type: "importMode" })

		expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			defaultUri: { fsPath: "/workspace" },
			filters: { "YAML files": ["yaml", "yml"] },
			title: "Select mode export file to import",
		})
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "importModeResult",
			success: false,
			error: "cancelled",
		})
	})

	it("starts the picker in the directory of the last import", async () => {
		const provider = createProvider({ lastModeImportPath: "/imports/old/mode.yaml" })
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined)

		await send(provider, { type: "importMode" })

		expect(vi.mocked(vscode.window.showOpenDialog).mock.calls[0][0]?.defaultUri).toEqual({
			fsPath: path.dirname("/imports/old/mode.yaml"),
		})
	})

	it("imports the chosen file at project level by default and refreshes the modes", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: "/in/mode.yaml" }] as any)
		vi.mocked(fs.readFile).mockResolvedValue("slug: imported\n" as any)

		await send(provider, { type: "importMode" })

		expect(provider.state.lastModeImportPath).toBe("/in/mode.yaml")
		expect(fs.readFile).toHaveBeenCalledWith("/in/mode.yaml", "utf-8")
		expect(provider.customModesManager.importModeWithRules).toHaveBeenCalledWith("slug: imported\n", "project")
		expect(provider.state.customModes).toEqual([{ slug: "imported" }])
		expect(provider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "importModeResult",
			success: true,
			slug: "imported",
		})
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:info.mode_imported")
	})

	it("honors an explicit global source", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: "/in/mode.yaml" }] as any)
		vi.mocked(fs.readFile).mockResolvedValue("yaml" as any)

		await send(provider, { type: "importMode", source: "global" })

		expect(provider.customModesManager.importModeWithRules).toHaveBeenCalledWith("yaml", "global")
	})

	it("reports a rejected import", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: "/in/mode.yaml" }] as any)
		vi.mocked(fs.readFile).mockResolvedValue("yaml" as any)
		provider.customModesManager.importModeWithRules.mockResolvedValue({ success: false, error: "invalid" })

		await send(provider, { type: "importMode" })

		expect(provider.postStateToWebview).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "importModeResult",
			success: false,
			error: "invalid",
		})
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'common:errors.mode_import_failed {"error":"invalid"}',
		)
	})

	it("logs and reports a thrown error", async () => {
		const provider = createProvider()
		vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: "/in/mode.yaml" }] as any)
		vi.mocked(fs.readFile).mockRejectedValue(new Error("EACCES"))

		await send(provider, { type: "importMode" })

		expect(provider.log).toHaveBeenCalledWith("Failed to import mode: EACCES")
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "importModeResult",
			success: false,
			error: "EACCES",
		})
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'common:errors.mode_import_failed {"error":"EACCES"}',
		)
	})
})
