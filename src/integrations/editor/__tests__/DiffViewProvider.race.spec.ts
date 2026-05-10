import * as vscode from "vscode"
import * as fs from "fs/promises"

import { DiffViewProvider } from "../DiffViewProvider"

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

vi.mock("fs/promises", () => ({
	readFile: vi.fn().mockResolvedValue(""),
	writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/fs", () => ({
	createDirectoriesForFile: vi.fn().mockResolvedValue([]),
}))

vi.mock("path", () => ({
	resolve: vi.fn((cwd: string, relPath: string) => `${cwd}/${relPath}`),
	basename: vi.fn((p: string) => p.split("/").pop()),
}))

vi.mock("vscode", () => ({
	workspace: {
		applyEdit: vi.fn(),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		textDocuments: [],
	},
	window: {
		createTextEditorDecorationType: vi.fn(),
		showTextDocument: vi.fn(),
		onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
		tabGroups: { all: [], close: vi.fn() },
		visibleTextEditors: [],
	},
	commands: { executeCommand: vi.fn() },
	languages: { getDiagnostics: vi.fn(() => []) },
	DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
	WorkspaceEdit: vi.fn().mockImplementation(() => ({ replace: vi.fn(), delete: vi.fn() })),
	Range: vi.fn(),
	Position: vi.fn(),
	Selection: vi.fn(),
	TextEditorRevealType: { InCenter: 2 },
	TabInputTextDiff: class TabInputTextDiff {},
	Uri: { file: vi.fn((p: string) => ({ fsPath: p })), parse: vi.fn() },
	ViewColumn: { Active: 1 },
}))

const mockTask = {
	providerRef: {
		deref: () => ({
			getState: vi.fn().mockResolvedValue({
				includeDiagnosticMessages: true,
				maxDiagnosticMessages: 50,
			}),
		}),
	},
} as any

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
	let resolveFn!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolveFn = r
	})
	return { promise, resolve: resolveFn }
}

function installFakeSession(provider: DiffViewProvider) {
	const fadedOverlayClear = vi.fn()
	const activeLineClear = vi.fn()
	const fadedOverlay = {
		updateOverlayAfterLine: vi.fn(),
		addLines: vi.fn(),
		clear: fadedOverlayClear,
	}
	const activeLine = { setActiveLine: vi.fn(), clear: activeLineClear }
	const session = {
		id: 1,
		relPath: "test.ts",
		diffEditor: {
			document: { uri: { fsPath: "/cwd/test.ts" }, lineCount: 5 },
			selection: { active: { line: 0, character: 0 }, anchor: { line: 0, character: 0 } },
			visibleRanges: [],
			revealRange: vi.fn(),
		},
		fadedOverlay,
		activeLine,
		preDiagnostics: [],
		documentWasOpen: false,
		createdDirs: [],
		streamedLines: [],
		newContent: undefined,
		isStale: false,
	}
	;(provider as any).activeEdit = session
	return { session, fadedOverlayClear, activeLineClear }
}

describe("DiffViewProvider race-condition safety", () => {
	let provider: DiffViewProvider

	beforeEach(() => {
		vi.clearAllMocks()
		provider = new DiffViewProvider("/cwd", mockTask)
	})

	it("update() that races with reset() does not throw and does not touch the editor after reset", async () => {
		const { session, fadedOverlayClear, activeLineClear } = installFakeSession(provider)

		// First applyEdit resolves immediately so update() reaches the isFinal block.
		// Second applyEdit (the trim, only fires if streamedLines < lineCount=5) returns a deferred.
		// Third applyEdit (the final replace) returns another deferred.
		const trimDeferred = deferred<boolean>()
		const finalDeferred = deferred<boolean>()
		vi.mocked(vscode.workspace.applyEdit)
			.mockResolvedValueOnce(true)
			.mockReturnValueOnce(trimDeferred.promise as any)
			.mockReturnValueOnce(finalDeferred.promise as any)

		const updatePromise = provider.update("a\nb\nc\n", true)

		// Yield once so update reaches its first await.
		await Promise.resolve()
		await Promise.resolve()

		// Concurrent reset — what TaskStreamProcessor does at start-of-turn.
		const resetPromise = provider.reset()
		await resetPromise
		expect(session.isStale).toBe(true)

		// Now release the in-flight applyEdits.
		trimDeferred.resolve(true)
		finalDeferred.resolve(true)

		// update() must finish without throwing — the original bug threw
		// "Cannot read properties of undefined (reading 'clear')" here.
		await expect(updatePromise).resolves.toBeUndefined()

		// And it must not have touched the (now-detached) decoration controllers
		// after reset — that would scribble on a closed editor.
		expect(fadedOverlayClear).not.toHaveBeenCalled()
		expect(activeLineClear).not.toHaveBeenCalled()
	})

	it("a fresh session installed after reset does not reuse stale state", async () => {
		const first = installFakeSession(provider)
		await provider.reset()
		expect(first.session.isStale).toBe(true)
		expect((provider as any).activeEdit).toBeUndefined()

		const second = installFakeSession(provider)
		expect(second.session.isStale).toBe(false)
		expect((provider as any).activeEdit).toBe(second.session)
		expect(first.session).not.toBe(second.session)
	})

	it("update() throws cleanly when no session is installed", async () => {
		await expect(provider.update("anything", true)).rejects.toThrow("Required values not set")
	})

	it("saveChanges() persists approved buffered content to disk when reset() detached the diff session before save", async () => {
		// Reproduces the silent-save-loss bug: TaskStreamProcessor.resetStreamingState()
		// fires diffViewProvider.reset() between askApproval() and saveChanges() in
		// WriteToFileTool.execute(). activeEdit is nulled, but the user already
		// approved the change — the buffered content MUST still reach disk.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		installFakeSession(provider)
		vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true)

		// Tool buffers the final, user-visible content via update(isFinal=true).
		await provider.update("approved\n", true)

		// resetStreamingState() races between approval and saveChanges().
		await provider.reset()
		expect((provider as any).activeEdit).toBeUndefined()

		// User had already clicked "Approve" — saveChanges must persist the content.
		const result = await provider.saveChanges(false, 0)

		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")
		expect(result.userEdits).toBeUndefined()
		expect((provider as any).lastEditedRelPath).toBe("test.ts")
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0]?.[0]).toContain("test.ts")

		warnSpy.mockRestore()
	})
})
