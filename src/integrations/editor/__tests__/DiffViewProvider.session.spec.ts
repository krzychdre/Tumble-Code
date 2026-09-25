import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { DiffViewProvider } from "../DiffViewProvider"

/**
 * A whole diff session through the public API (open, update, saveChanges,
 * revertChanges) on a real temporary directory. Only the VS Code editor side
 * is faked: the lifecycle manager (tabs, diff editor), the decorations and the
 * diagnostics.
 */

const lifecycle = vi.hoisted(() => ({
	closeFileTabs: vi.fn(),
	openDiffEditor: vi.fn(),
	scrollEditorToLine: vi.fn(),
	scrollToFirstDiff: vi.fn(),
	closeAllDiffViews: vi.fn(),
}))

vi.mock("../DiffEditorLifecycleManager", async (importOriginal) => ({
	...(await importOriginal<typeof import("../DiffEditorLifecycleManager")>()),
	DiffEditorLifecycleManager: vi.fn().mockImplementation(() => lifecycle),
}))

vi.mock("../DecorationController", () => ({
	DecorationController: vi.fn().mockImplementation(() => ({
		addLines: vi.fn(),
		clear: vi.fn(),
		setActiveLine: vi.fn(),
		updateOverlayAfterLine: vi.fn(),
	})),
}))

vi.mock("../DiagnosticsCollector", () => ({
	DiagnosticsCollector: vi.fn().mockImplementation(() => ({
		capturePreDiagnostics: vi.fn().mockReturnValue([]),
		collectPostSaveDiagnostics: vi.fn().mockResolvedValue(""),
	})),
}))

interface Replacement {
	text: string
}

const applied = vi.hoisted(() => ({ replacements: [] as Replacement[] }))

vi.mock("vscode", () => ({
	workspace: {
		textDocuments: [],
		applyEdit: vi.fn().mockResolvedValue(true),
	},
	window: {
		showTextDocument: vi.fn().mockResolvedValue(undefined),
	},
	WorkspaceEdit: vi.fn().mockImplementation(() => ({
		replace: vi.fn((_uri: unknown, _range: unknown, text: string) => applied.replacements.push({ text })),
		delete: vi.fn(),
	})),
	Range: vi.fn(),
	Position: vi.fn(),
	Selection: vi.fn(),
	Uri: { file: vi.fn((p: string) => ({ fsPath: p, scheme: "file" })) },
}))

/** The diff editor's right-hand document; its text is what the user sees and may edit. */
function fakeEditor(absolutePath: string) {
	const document = {
		uri: { fsPath: absolutePath, scheme: "file" },
		text: "",
		isDirty: true,
		lineCount: 1,
		getText() {
			return this.text
		},
		positionAt: vi.fn((offset: number) => ({ offset })),
		save: vi.fn().mockResolvedValue(true),
	}
	return { document, selection: undefined, visibleRanges: [] }
}

const task = {
	providerRef: new WeakRef({ getState: async () => ({}) }),
	say: vi.fn(),
}

describe("DiffViewProvider session on disk (SVC-17)", () => {
	let cwd: string
	let provider: DiffViewProvider
	let editor: ReturnType<typeof fakeEditor>

	beforeEach(async () => {
		vi.clearAllMocks()
		applied.replacements = []
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "svc17-diffview-"))
		lifecycle.closeFileTabs.mockResolvedValue(false)
		lifecycle.closeAllDiffViews.mockResolvedValue(undefined)
		lifecycle.openDiffEditor.mockImplementation(async (relPath: string) => {
			editor = fakeEditor(path.resolve(cwd, relPath))
			return editor
		})
		provider = new DiffViewProvider(cwd, task)
	})

	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	describe("open(relPath, editType)", () => {
		it("takes the create/modify decision as a parameter and passes it to the diff editor", async () => {
			await fs.writeFile(path.join(cwd, "existing.ts"), "original\n")

			await provider.open("existing.ts", "modify")

			expect(provider.originalContent).toBe("original\n")
			expect(lifecycle.openDiffEditor).toHaveBeenCalledWith("existing.ts", "modify", "original\n")
		})

		it("creates an empty file for a new file without reading it", async () => {
			await provider.open("fresh.ts", "create")

			expect(provider.originalContent).toBe("")
			expect(await fs.readFile(path.join(cwd, "fresh.ts"), "utf-8")).toBe("")
			expect(lifecycle.openDiffEditor).toHaveBeenCalledWith("fresh.ts", "create", "")
		})

		it("has no editType property to set before open() any more", () => {
			expect("editType" in provider).toBe(false)
		})
	})

	describe("revertChanges", () => {
		it("new file: deletes the file and only the directories open() created, deepest first, then resets", async () => {
			await fs.mkdir(path.join(cwd, "keep"))

			await provider.open(path.join("keep", "made", "deeper", "new.ts"), "create")
			const absolutePath = path.join(cwd, "keep", "made", "deeper", "new.ts")
			expect(await fs.readFile(absolutePath, "utf-8")).toBe("")

			await provider.update("streamed content\n", true)
			await provider.revertChanges()

			expect(editor.document.save).toHaveBeenCalledTimes(1)
			await expect(fs.stat(absolutePath)).rejects.toThrow()
			await expect(fs.stat(path.join(cwd, "keep", "made"))).rejects.toThrow()
			expect((await fs.stat(path.join(cwd, "keep"))).isDirectory()).toBe(true)
			expect(lifecycle.closeAllDiffViews).toHaveBeenCalled()
			expect(provider.isEditing).toBe(false)
			expect(provider.originalContent).toBeUndefined()
		})

		it("existing file: writes the BOM-stripped original back through the editor, keeps the file, reopens a tab that was open", async () => {
			const absolutePath = path.join(cwd, "app.ts")
			await fs.writeFile(absolutePath, "\uFEFForiginal\n")
			lifecycle.closeFileTabs.mockResolvedValue(true)

			await provider.open("app.ts", "modify")
			await provider.update("changed\n", true)
			applied.replacements = []
			await provider.revertChanges()

			expect(applied.replacements.map((r) => r.text)).toEqual(["original\n"])
			expect(editor.document.save).toHaveBeenCalledTimes(1)
			expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
				expect.objectContaining({ fsPath: absolutePath }),
				{ preview: false, preserveFocus: true },
			)
			expect(await fs.readFile(absolutePath, "utf-8")).toBe("\uFEFForiginal\n")
			expect(lifecycle.closeAllDiffViews).toHaveBeenCalled()
			expect(provider.isEditing).toBe(false)
		})

		it("existing file: does not reopen a tab that was not open before", async () => {
			await fs.writeFile(path.join(cwd, "app.ts"), "original\n")

			await provider.open("app.ts", "modify")
			await provider.revertChanges()

			expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
		})

		it("a rejected write cannot be resurrected by a later save", async () => {
			await fs.writeFile(path.join(cwd, "app.ts"), "original\n")

			await provider.open("app.ts", "modify")
			await provider.update("rejected\n", true)
			await provider.revertChanges()

			expect(await provider.saveChanges(false, 0)).toEqual({
				newProblemsMessage: undefined,
				userEdits: undefined,
				finalContent: undefined,
			})
			expect(await fs.readFile(path.join(cwd, "app.ts"), "utf-8")).toBe("original\n")
		})
	})

	describe("saveChanges user-edit patch with CRLF content", () => {
		beforeEach(async () => {
			await fs.writeFile(path.join(cwd, "app.ts"), "line1\r\nline2\r\n")
			await provider.open("app.ts", "modify")
			await provider.update("line1\r\nline2 changed\r\n", true)
		})

		it("reports what the user typed, compared after EOL normalization to the model's CRLF", async () => {
			// The user added a line in the diff editor; the editor hands back LF.
			editor.document.text = "line1\nline2 changed\nuser line\n"

			const result = await provider.saveChanges(false, 0)

			const expectedPatch = "@@ -1,2 +1,3 @@\n line1\r\n line2 changed\r\n+user line\r\n"
			expect(result).toEqual({
				newProblemsMessage: "",
				userEdits: expectedPatch,
				finalContent: "line1\r\nline2 changed\r\nuser line\r\n",
			})
			expect(provider.userEdits).toBe(expectedPatch)
		})

		it("reports no user edits when only the line endings differ", async () => {
			editor.document.text = "line1\nline2 changed\n"

			const result = await provider.saveChanges(false, 0)

			expect(result.userEdits).toBeUndefined()
			expect(result.finalContent).toBe("line1\r\nline2 changed\r\n")
			expect(provider.userEdits).toBeUndefined()
		})
	})
})
