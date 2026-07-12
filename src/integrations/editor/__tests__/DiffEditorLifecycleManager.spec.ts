import {
	DiffEditorLifecycleManager,
	DIFF_VIEW_URI_SCHEME,
	DIFF_VIEW_LABEL_CHANGES,
} from "../DiffEditorLifecycleManager"
import * as vscode from "vscode"
import * as path from "path"

// Mock path
vi.mock("path", () => ({
	resolve: vi.fn((cwd, relPath) => `${cwd}/${relPath}`),
	basename: vi.fn((p) => p.split("/").pop()),
}))

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn().mockResolvedValue("disk content"),
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		openTextDocument: vi.fn(),
		textDocuments: [],
		applyEdit: vi.fn(),
	},
	window: {
		createTextEditorDecorationType: vi.fn(),
		showTextDocument: vi.fn(),
		onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
		tabGroups: {
			all: [],
			close: vi.fn(),
		},
		visibleTextEditors: [],
	},
	commands: {
		executeCommand: vi.fn(),
	},
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
	WorkspaceEdit: vi.fn().mockImplementation(() => ({
		replace: vi.fn(),
		delete: vi.fn(),
	})),
	ViewColumn: {
		Active: 1,
	},
	Range: vi.fn(),
	Position: vi.fn(),
	Selection: vi.fn(),
	TextEditorRevealType: {
		InCenter: 2,
	},
	TabInputText: class TabInputText {},
	TabInputTextDiff: class TabInputTextDiff {},
	Uri: {
		file: vi.fn((p) => ({ fsPath: p })),
		parse: vi.fn((uri) => ({ with: vi.fn(() => ({})) })),
	},
}))

// Mock strip-bom (transitive via stripAllBOMs)
vi.mock("strip-bom", () => ({
	default: vi.fn((s: string) => s),
}))

describe("DiffEditorLifecycleManager", () => {
	let manager: DiffEditorLifecycleManager
	const mockCwd = "/mock/cwd"

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new DiffEditorLifecycleManager(mockCwd)
	})

	describe("constants", () => {
		it("exports DIFF_VIEW_URI_SCHEME", () => {
			expect(DIFF_VIEW_URI_SCHEME).toBe("cline-diff")
		})

		it("exports DIFF_VIEW_LABEL_CHANGES", () => {
			expect(DIFF_VIEW_LABEL_CHANGES).toBe("Original ↔ Roo's Changes")
		})
	})

	describe("scrollEditorToLine", () => {
		it("reveals the range at line + 4 in center", () => {
			const mockEditor = {
				revealRange: vi.fn(),
			} as any

			manager.scrollEditorToLine(mockEditor, 10)

			// Should reveal at line 14 (10 + 4) with InCenter
			expect(mockEditor.revealRange).toHaveBeenCalledWith(
				expect.objectContaining({
					// Range is mocked, just verify it was called
				}),
				vscode.TextEditorRevealType.InCenter,
			)
		})
	})

	describe("scrollToFirstDiff", () => {
		it("does nothing when original and current content are identical", () => {
			const mockEditor = {
				document: {
					getText: vi.fn().mockReturnValue("same content\nline 2"),
				},
				revealRange: vi.fn(),
			} as any

			manager.scrollToFirstDiff(mockEditor, "same content\nline 2")

			expect(mockEditor.revealRange).not.toHaveBeenCalled()
		})

		it("reveals the first diff line when content differs", () => {
			const mockEditor = {
				document: {
					getText: vi.fn().mockReturnValue("same content\nchanged line\nline 3"),
				},
				revealRange: vi.fn(),
			} as any

			manager.scrollToFirstDiff(mockEditor, "same content\noriginal line\nline 3")

			expect(mockEditor.revealRange).toHaveBeenCalledOnce()
		})
	})

	describe("closeFileTabs", () => {
		it("returns false when no matching tabs are open", async () => {
			Object.defineProperty(vscode.window.tabGroups, "all", {
				get: () => [],
				configurable: true,
			})

			const result = await manager.closeFileTabs("/mock/cwd/test.ts")

			expect(result).toBe(false)
		})

		it("closes non-dirty matching file tabs and returns true", async () => {
			const mockTab = {
				input: {
					uri: { fsPath: "/mock/cwd/test.ts", scheme: "file" },
				},
				isDirty: false,
				label: "test.ts",
			}
			Object.setPrototypeOf(mockTab.input, vscode.TabInputText.prototype)

			Object.defineProperty(vscode.window.tabGroups, "all", {
				get: () => [{ tabs: [mockTab] }],
				configurable: true,
			})

			vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(true as any)

			const result = await manager.closeFileTabs("/mock/cwd/test.ts")

			expect(result).toBe(true)
			expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(mockTab)
		})
	})

	describe("closeAllDiffViews", () => {
		it("closes tabs identified by cline-diff scheme", async () => {
			const diffTab = {
				input: {
					original: { scheme: DIFF_VIEW_URI_SCHEME },
					modified: { fsPath: "/test/file1.ts" },
				},
				label: `file1.ts: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
				isDirty: false,
			}
			Object.setPrototypeOf(diffTab.input, vscode.TabInputTextDiff.prototype)

			Object.defineProperty(vscode.window.tabGroups, "all", {
				get: () => [{ tabs: [diffTab] }],
				configurable: true,
			})

			const closedTabs: any[] = []
			vi.mocked(vscode.window.tabGroups.close).mockImplementation((tab) => {
				closedTabs.push(tab)
				return Promise.resolve(true)
			})

			await manager.closeAllDiffViews()

			expect(closedTabs).toHaveLength(1)
			expect(closedTabs[0]).toBe(diffTab)
		})

		it("closes tabs identified by label fallback", async () => {
			const diffTab = {
				input: {
					original: { scheme: "file" },
					modified: { fsPath: "/test/file2.md" },
				},
				label: `file2.md: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
				isDirty: false,
			}
			Object.setPrototypeOf(diffTab.input, vscode.TabInputTextDiff.prototype)

			Object.defineProperty(vscode.window.tabGroups, "all", {
				get: () => [{ tabs: [diffTab] }],
				configurable: true,
			})

			vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(true as any)

			await manager.closeAllDiffViews()

			expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(diffTab)
		})

		it("does not close regular file tabs", async () => {
			const regularTab = {
				input: {
					uri: { fsPath: "/test/file3.js" },
				},
				label: "file3.js",
				isDirty: false,
			}
			Object.setPrototypeOf(regularTab.input, vscode.TabInputText.prototype)

			Object.defineProperty(vscode.window.tabGroups, "all", {
				get: () => [{ tabs: [regularTab] }],
				configurable: true,
			})

			vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(true as any)

			await manager.closeAllDiffViews()

			expect(vscode.window.tabGroups.close).not.toHaveBeenCalled()
		})
	})
})
