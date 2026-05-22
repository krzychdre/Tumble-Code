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

	it("saveChanges() returns empty tuple when neither activeEdit nor pendingSave is set", async () => {
		// Pins the no-op fast path: a fresh provider with nothing buffered must
		// short-circuit cleanly — no fs.writeFile, no recovery warning.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		const result = await provider.saveChanges(false, 0)

		expect(result).toEqual({
			newProblemsMessage: undefined,
			userEdits: undefined,
			finalContent: undefined,
		})
		expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled()
		expect(warnSpy).not.toHaveBeenCalled()

		warnSpy.mockRestore()
	})

	it("reset() preserves pendingSave so a later saveChanges() can recover it", async () => {
		// The buffer must outlive reset() — that is the entire point of the fix.
		// reset() is what TaskStreamProcessor.resetStreamingState() fires; if it
		// drained pendingSave, an already-approved write would be silently lost.
		installFakeSession(provider)
		const buffered = { relPath: "test.ts", newContent: "approved\n" }
		;(provider as any).pendingSave = buffered

		await provider.reset()

		expect((provider as any).activeEdit).toBeUndefined()
		expect((provider as any).pendingSave).toEqual(buffered)
	})

	it("revertChanges() clears pendingSave even when no active session exists", async () => {
		// Reject path: a buffer that survived a reset() must be discarded when
		// the user later rejects, so a subsequent saveChanges() cannot resurrect
		// it. Exercises the no-session early-return branch in revertChanges().
		;(provider as any).pendingSave = { relPath: "rejected.ts", newContent: "should-not-survive" }

		await provider.revertChanges()

		expect((provider as any).pendingSave).toBeUndefined()
		expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled()
	})

	it("update(isFinal=true) racing reset() during its first applyEdit still buffers approved bytes for recovery", async () => {
		// Regression for the third reset() race window inside update(isFinal=true).
		// The prior two fixes (commit 09739193c) closed the windows AROUND
		// saveChanges(); this one is BEFORE it. update(isFinal=true) does up to
		// three sequential awaits (partial replace, optional trim, final replace),
		// each followed by `if (edit.isStale) return`. If reset() flips isStale
		// during ANY of those awaits, update() bails before it reaches the
		// pendingSave publication site at the tail of the isFinal block —
		// pendingSave stays undefined, saveChanges() takes its "nothing to save"
		// early-return without setting lastEditedRelPath, and the subsequent
		// pushToolWriteResult() throws "No file path available in DiffViewProvider".
		// Real-world trigger: TaskStreamProcessor.resetStreamingState() races
		// WriteToFileTool.execute() between its update(isFinal=true) and saveChanges().
		// The fix moves the pendingSave publication BEFORE any await in the isFinal
		// branch, so even a bail at the EARLIEST possible stale-check still leaves
		// the approved bytes in the recovery buffer.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { session } = installFakeSession(provider)

		// Arm the very first applyEdit (the partial replace at the top of update())
		// with a deferred, so we can race reset() during the worst-case window:
		// before update() has even entered the isFinal block.
		const partialDeferred = deferred<boolean>()
		vi.mocked(vscode.workspace.applyEdit).mockReturnValueOnce(partialDeferred.promise as any)

		const updatePromise = provider.update("approved\n", true)

		// Yield enough microtasks for update() to suspend on the partial applyEdit.
		await Promise.resolve()
		await Promise.resolve()

		// Mid-flight reset() flips isStale and detaches activeEdit.
		await provider.reset()
		expect(session.isStale).toBe(true)
		expect((provider as any).activeEdit).toBeUndefined()

		// Releasing the partial applyEdit lets update() resume — it hits its
		// first `if (edit.isStale) return` and exits BEFORE the trim/final
		// applyEdits and BEFORE the prior pendingSave publication site at the
		// tail of the isFinal block.
		partialDeferred.resolve(true)
		await expect(updatePromise).resolves.toBeUndefined()

		// The fix's load-bearing assertion: pendingSave was published BEFORE the
		// first await, so it survives the early bail.
		expect((provider as any).pendingSave).toEqual({
			relPath: "test.ts",
			newContent: "approved\n",
		})

		// And saveChanges() takes the recovery branch: writes the approved bytes
		// to disk via flushPendingSaveDirectly, sets lastEditedRelPath so the
		// subsequent pushToolWriteResult() won't throw.
		const result = await provider.saveChanges(false, 0)

		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")
		expect(result.userEdits).toBeUndefined()
		expect((provider as any).lastEditedRelPath).toBe("test.ts")
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0]?.[0]).toContain("test.ts")

		warnSpy.mockRestore()
	})

	it("saveChanges() recovers when reset() fires during the editor branch's document.save() await", async () => {
		// Narrower-window race: reset() fires AFTER saveChanges() has already
		// entered the editor branch (edit was valid at entry) but DURING one of
		// its awaits — here, updatedDocument.save(). Without the post-await
		// isStale recheck, the editor branch would keep operating on a detached
		// session and the approved bytes might never reach disk reliably.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { session } = installFakeSession(provider)

		// Arm document.save() with a deferred promise so we control when it
		// resolves — that's our race window.
		const saveDeferred = deferred<void>()
		;(session.diffEditor as any).document = {
			...session.diffEditor.document,
			isDirty: true,
			save: vi.fn().mockReturnValue(saveDeferred.promise),
			getText: vi.fn().mockReturnValue("approved\n"),
		}

		vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true)

		// update(isFinal=true) populates pendingSave AND edit.newContent.
		await provider.update("approved\n", true)
		expect(session.isStale).toBe(false)
		expect((provider as any).pendingSave).toEqual({ relPath: "test.ts", newContent: "approved\n" })

		// Start saveChanges; entry checks pass (edit valid, not stale) so it
		// enters the editor branch and awaits updatedDocument.save().
		const savePromise = provider.saveChanges(false, 0)

		// Yield enough microtasks for saveChanges to reach the save() await.
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		// reset() races us mid-save: nulls activeEdit, flips session.isStale.
		await provider.reset()
		expect(session.isStale).toBe(true)
		expect((provider as any).activeEdit).toBeUndefined()

		// Resolve the in-flight save() so saveChanges' post-await recheck fires.
		saveDeferred.resolve()

		const result = await savePromise

		// Recovery branch wrote the buffered bytes via fs.writeFile and emitted
		// the recovery warning — the file is on disk regardless of whether the
		// editor's own save() completed.
		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")
		expect(result.userEdits).toBeUndefined()
		expect((provider as any).lastEditedRelPath).toBe("test.ts")
		expect((provider as any).pendingSave).toBeUndefined()
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0]?.[0]).toContain("test.ts")

		warnSpy.mockRestore()
	})

	it("saveChanges() recovers when updatedDocument.save() returns false (silent VSCode refusal)", async () => {
		// Regression for the silent no-save symptom: VSCode's TextDocument.save()
		// returns Thenable<boolean> — false means the save was silently refused
		// (read-only document, disposed buffer, locked file, internal VS Code
		// error). The prior arrangement awaited save() and discarded its return
		// value, then drained pendingSave and reported success to the model.
		// Result: model thinks the file was written, user finds the file empty
		// or stale, no error anywhere — confirmed by the user manually pressing
		// Ctrl+S to save the buffer themselves. The fix captures save()'s return
		// and falls through to flushPendingSaveDirectly() when it's false, so the
		// user-approved bytes still land on disk.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { session } = installFakeSession(provider)

		// Make the document dirty, but arm save() to silently refuse (return false).
		;(session.diffEditor as any).document = {
			...session.diffEditor.document,
			isDirty: true,
			save: vi.fn().mockResolvedValue(false),
			getText: vi.fn().mockReturnValue("approved\n"),
		}

		vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true)

		// update(isFinal=true) populates pendingSave AND edit.newContent.
		await provider.update("approved\n", true)
		expect((provider as any).pendingSave).toEqual({ relPath: "test.ts", newContent: "approved\n" })

		const result = await provider.saveChanges(false, 0)

		// Editor save returned false — recovery branch MUST have written the
		// approved bytes to disk via fs.writeFile, NOT silently reported success.
		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")
		expect((provider as any).lastEditedRelPath).toBe("test.ts")
		expect((provider as any).pendingSave).toBeUndefined()
		expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("test.ts"))).toBe(true)

		warnSpy.mockRestore()
	})

	it("saveChanges() writes through pendingSave when document is not dirty but buffer is queued", async () => {
		// Defense against the !isDirty silent-skip path. updatedDocument.isDirty
		// can be false at saveChanges() time if (a) autosave fired between
		// update(isFinal=true) and saveChanges(), or (b) the user reverted the
		// editor manually. In either case, the prior arrangement skipped save()
		// entirely and trusted that disk already held the right bytes — but it
		// may not. With pendingSave populated by update(isFinal=true), the
		// flushPendingSaveDirectly() path is idempotent and guarantees the
		// user-approved bytes are on disk regardless of buffer state.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { session } = installFakeSession(provider)

		// Document is NOT dirty — editor branch would skip save() entirely.
		;(session.diffEditor as any).document = {
			...session.diffEditor.document,
			isDirty: false,
			save: vi.fn(),
			getText: vi.fn().mockReturnValue("approved\n"),
		}

		vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true)

		await provider.update("approved\n", true)
		expect((provider as any).pendingSave).toEqual({ relPath: "test.ts", newContent: "approved\n" })

		const result = await provider.saveChanges(false, 0)

		// save() was never called — but fs.writeFile must still have run to
		// guarantee the buffered bytes reach disk.
		expect((session.diffEditor as any).document.save).not.toHaveBeenCalled()
		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")
		expect((provider as any).lastEditedRelPath).toBe("test.ts")
		expect((provider as any).pendingSave).toBeUndefined()

		warnSpy.mockRestore()
	})

	it("flushPendingSaveDirectly() (stale-session recovery) closes the leftover dirty diff tab", async () => {
		// Regression for the user-reported symptom: after a stale-session recovery
		// the file is written to disk via fs.writeFile, but the diff editor tab was
		// left open and still dirty. flushPendingSaveDirectly() previously never
		// called closeAllDiffViews(), so the just-saved tab leaked. fs.writeFile
		// writes behind VS Code's back, so the in-memory diff document stays dirty
		// and the !isDirty filter in closeAllDiffViews() skipped it on the later
		// reset() too. The fix: flushPendingSaveDirectly() must tear the tab down,
		// and closeAllDiffViews() must be able to close a Roo-owned dirty tab.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		// A Roo diff tab whose modified-side document is still dirty.
		const diffTabSave = vi.fn().mockResolvedValue(true)
		const diffTabDocument = {
			uri: { scheme: "file", fsPath: "/cwd/test.ts" },
			isDirty: true,
			getText: vi.fn().mockReturnValue("approved\n"),
			positionAt: vi.fn((n: number) => ({ line: 0, character: n })),
			save: diffTabSave,
		}
		const diffTab = {
			input: { original: { scheme: "cline-diff" }, modified: { fsPath: "/cwd/test.ts" } },
			label: "test.ts: Original ↔ Roo's Changes (Editable)",
			isDirty: true,
		}
		Object.setPrototypeOf(diffTab.input, vscode.TabInputTextDiff.prototype)

		const closedTabs: any[] = []
		Object.defineProperty(vscode.window.tabGroups, "all", {
			get: () => [{ tabs: [diffTab] }],
			configurable: true,
		})
		vi.mocked(vscode.window.tabGroups.close).mockImplementation((tab: any) => {
			closedTabs.push(tab)
			return Promise.resolve(true)
		})
		;(vscode.workspace as any).textDocuments = [diffTabDocument]
		vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true)

		// Stale session: reset() detached activeEdit and flipped isStale, but
		// pendingSave survived (the user already approved the write).
		;(provider as any).pendingSave = { relPath: "test.ts", newContent: "approved\n" }

		const result = await provider.saveChanges(false, 0)

		// The bytes reached disk via the recovery path.
		expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith("/cwd/test.ts", "approved\n", "utf-8")
		expect(result.finalContent).toBe("approved\n")

		// The load-bearing assertion: the leftover dirty diff tab was closed.
		expect(closedTabs).toHaveLength(1)
		expect(closedTabs[0]).toBe(diffTab)

		warnSpy.mockRestore()
	})

	it("open() defensively clears any stale pendingSave from a prior unsuccessful sequence", async () => {
		// Protects against an exception path that left pendingSave populated
		// without a save — a new diff session must not inherit it. The clear
		// runs synchronously before open()'s first await, so we can observe it
		// before the rest of open() resolves.
		;(provider as any).pendingSave = { relPath: "stale.ts", newContent: "stale" }

		const openPromise = provider.open("test.ts").catch(() => {
			// Downstream open() steps need more vscode mocks than this suite
			// installs; we only care about the synchronous defensive clear.
		})

		expect((provider as any).pendingSave).toBeUndefined()

		await openPromise
	})
})
