// npx vitest core/webview/__tests__/webviewMessageHandler.readFileContent.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../api/providers/fetchers/modelCache")

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showTextDocument: vi.fn(),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
		openTextDocument: vi.fn().mockResolvedValue({}),
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

vi.mock("fs/promises", () => {
	const readFile = vi.fn().mockResolvedValue("file content here")
	return {
		default: {
			rm: vi.fn(),
			mkdir: vi.fn(),
			readFile,
			writeFile: vi.fn(),
		},
		rm: vi.fn(),
		mkdir: vi.fn(),
		readFile,
		writeFile: vi.fn(),
	}
})

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn((filePath: string) => {
		const nodePath = require("path")
		const normalized = nodePath.resolve(filePath)
		const workspaceRoot = nodePath.resolve("/mock/workspace")
		// Path is inside workspace if it equals or is under workspace root
		if (normalized === workspaceRoot) return false
		if (normalized.startsWith(workspaceRoot + nodePath.sep)) return false
		return true
	}),
}))

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({
		text,
		images: [...(images ?? [])],
	})),
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import * as fs from "fs/promises"

const MOCK_CWD = "/mock/workspace/project"

const mockProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
	},
	contextProxy: {
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
	},
	postStateToWebview: vi.fn(),
	getCurrentTask: vi.fn().mockReturnValue({ cwd: MOCK_CWD }),
	getTaskWithId: vi.fn(),
	createTaskWithHistoryItem: vi.fn(),
	cwd: MOCK_CWD,
} as unknown as ClineProvider

describe("webviewMessageHandler - readFileContent path traversal prevention", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(fs.readFile).mockResolvedValue("file content here")
		vi.mocked(mockProvider.getCurrentTask).mockReturnValue({ cwd: MOCK_CWD } as any)
	})

	it.each([
		["a relative path", "src/index.ts"],
		["an absolute path", `${MOCK_CWD}/src/index.ts`],
	])("reads a file inside the workspace given %s", async (_name, text) => {
		await webviewMessageHandler(mockProvider, { type: "readFileContent", text })

		expect(fs.readFile).toHaveBeenCalled()
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileContent",
			fileContent: { path: text, content: "file content here" },
		})
	})

	it.each([
		["a ../ traversal", "../../../etc/passwd", "Path is outside workspace"],
		["an absolute path outside the workspace", "/etc/shadow", "Path is outside workspace"],
		["a traversal in the middle of a path", "src/../../../../etc/passwd", "Path is outside workspace"],
		["no path", "", "No path provided"],
	])("refuses %s without reading anything", async (_name, text, error) => {
		await webviewMessageHandler(mockProvider, { type: "readFileContent", text })

		expect(fs.readFile).not.toHaveBeenCalled()
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileContent",
			fileContent: expect.objectContaining({ content: null, error }),
		})
	})
})
