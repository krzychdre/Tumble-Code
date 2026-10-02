import type { Mock } from "vitest"
/**
 * The approval, diff view and save sequence of `write_to_file` and
 * `apply_diff`: the side-effect order in the diff editor and in the
 * direct-write mode, the rejection path, the approval card (key order
 * included), the arguments of the save and the text of the result.
 *
 * Both tools ran their own copy of this sequence and now share
 * `applyComputedEdit` with the other edit tools (editPipeline.spec.ts). The
 * tests marked "Shared step:" pin where their copies had drifted from it.
 */

import fs from "fs/promises"
import path from "path"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { pauseForPlanReviewIfNeeded } from "../../plan-review/planReviewPause"
import { pushToolWriteResult } from "../helpers/toolWriteResult"
import { writeToFileTool } from "../WriteToFileTool"
import { applyDiffTool } from "../ApplyDiffTool"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
	createDirectoriesForFile: vi.fn().mockResolvedValue([]),
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn((_cwd: string, relPath: string) => `readable:${relPath}`),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		rooIgnoreError: vi.fn((p: string) => `Access denied: ${p}`),
		// Empty when nothing changed, like the real createPrettyPatch.
		createPrettyPatch: vi.fn((relPath: string, before: string, after: string) =>
			before === after ? "" : `diff ${relPath}`,
		),
	},
}))

vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff: string) => `sanitized(${diff})`),
	computeDiffStats: vi.fn(() => ({ added: 1, removed: 1 })),
	convertNewFileToUnifiedDiff: vi.fn((_content: string, relPath: string) => `new-file-diff ${relPath}`),
}))

vi.mock("../helpers/toolWriteResult", () => ({
	pushToolWriteResult: vi.fn(),
}))

vi.mock("../../plan-review/planReviewPause", () => ({
	pauseForPlanReviewIfNeeded: vi.fn(),
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	env: { openExternal: vi.fn() },
	Uri: { parse: vi.fn(), file: vi.fn() },
}))

const CWD = "/ws"
const abs = (relPath: string) => path.resolve(CWD, relPath)

const mockedReadFile = fs.readFile as unknown as MockedFunction<(p: string, enc: string) => Promise<string>>
const mockedFileExists = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
const mockedPause = pauseForPlanReviewIfNeeded as MockedFunction<typeof pauseForPlanReviewIfNeeded>
const mockedPushToolWriteResult = pushToolWriteResult as MockedFunction<typeof pushToolWriteResult>

const ORIGINAL = "const a = 1\nconst b = 2\n"
const SEARCH_REPLACE = "<<<<<<< SEARCH\nconst b = 2\n=======\nconst b = 3\n>>>>>>> REPLACE"
const PATCHED = "const a = 1\nconst b = 3\n"

let disk: Record<string, string>
let log: string[]
let task: any
let askApproval: Mock
let pushToolResult: Mock
let handleError: Mock
let experiments: Record<string, boolean>

function makeTask() {
	let session: { relPath: string; editType: "create" | "modify" } | undefined
	const diffViewProvider = {
		isEditing: false,
		originalContent: undefined as string | undefined,
		open: vi.fn(async (relPath: string, editType: "create" | "modify") => {
			log.push("open")
			session = { relPath, editType }
			diffViewProvider.isEditing = true
			diffViewProvider.originalContent = editType === "modify" ? disk[abs(relPath)] : ""
		}),
		editTypeOf: vi.fn((relPath: string) => (session?.relPath === relPath ? session.editType : undefined)),
		update: vi.fn(async () => void log.push("update")),
		scrollToFirstDiff: vi.fn(() => void log.push("scrollToFirstDiff")),
		revertChanges: vi.fn(async () => {
			log.push("revertChanges")
			session = undefined
			diffViewProvider.isEditing = false
		}),
		saveChanges: vi.fn(async () => void log.push("saveChanges")),
		saveDirectly: vi.fn(async () => void log.push("saveDirectly")),
		reset: vi.fn(async () => {
			log.push("reset")
			session = undefined
			diffViewProvider.isEditing = false
		}),
	}
	return {
		cwd: CWD,
		taskId: "task-1",
		consecutiveMistakeCount: 0,
		consecutiveMistakeCountForApplyDiff: new Map<string, number>(),
		didEditFile: false,
		didToolFailInCurrentTurn: false,
		api: { getModel: () => ({ id: "claude-test" }) },
		providerRef: {
			deref: () => ({
				getState: vi.fn(async () => {
					log.push("getState")
					return { diagnosticsEnabled: true, writeDelayMs: 50, experiments }
				}),
			}),
		},
		rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
		rooProtectedController: { isWriteProtected: vi.fn().mockReturnValue(false) },
		diffViewProvider,
		diffStrategy: {
			applyDiff: vi.fn(async () => ({ success: true, content: PATCHED, failParts: [] })),
			getProgressStatus: vi.fn(() => ({ icon: "diff-multiple", text: "1" })),
		},
		fileContextTracker: {
			trackFileContext: vi.fn(async () => void log.push("trackFileContext")),
		},
		say: vi.fn(async () => undefined),
		ask: vi.fn(async (_type: string, _text: string, partial?: boolean) => {
			log.push(partial ? "askPartial" : "ask")
			return undefined
		}),
		recordToolError: vi.fn(),
		recordToolUsage: vi.fn(),
		processQueuedMessages: vi.fn(() => void log.push("processQueuedMessages")),
		sayAndCreateMissingParamError: vi.fn(async () => "missing param"),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	disk = { [abs("src/a.ts")]: ORIGINAL }
	log = []
	experiments = {}
	mockedReadFile.mockImplementation(async (p: string) => {
		if (!(p in disk)) throw new Error(`ENOENT ${p}`)
		return disk[p]
	})
	mockedFileExists.mockImplementation(async (p: string) => p in disk)
	mockedPushToolWriteResult.mockImplementation(async () => {
		log.push("pushToolWriteResult")
		return "WRITE_RESULT"
	})
	mockedPause.mockImplementation(async () => {
		log.push("pauseForPlanReview")
		return undefined
	})
	task = makeTask()
	askApproval = vi.fn(async () => {
		log.push("askApproval")
		return true
	})
	pushToolResult = vi.fn(() => void log.push("pushToolResult"))
	handleError = vi.fn(async () => undefined)
	writeToFileTool.resetPartialState(task)
	applyDiffTool.resetPartialState(task)
})

const callbacks = () => ({ askApproval, pushToolResult, handleError, toolCallId: "call-1" })

const writeFile = (relPath: string, content: string) =>
	writeToFileTool.execute({ path: relPath, content }, task, callbacks())

const applyDiff = (diff = SEARCH_REPLACE) => applyDiffTool.execute({ path: "src/a.ts", diff }, task, callbacks())

const rejectApproval = () =>
	askApproval.mockImplementation(async () => {
		log.push("askApproval")
		return false
	})

describe("write_to_file", () => {
	// Shared step: no 300 ms sleep between the final update and the scroll
	// (update() has applied the final content once it resolves).
	it("modify: opens the diff view, scrolls, asks, saves, reports, then runs the gate", async () => {
		await writeFile("src/a.ts", PATCHED)

		expect(handleError).not.toHaveBeenCalled()
		expect(log).toEqual([
			"getState",
			"askPartial",
			"open",
			"update",
			"scrollToFirstDiff",
			"askApproval",
			"saveChanges",
			"trackFileContext",
			"pushToolWriteResult",
			"pauseForPlanReview",
			"pushToolResult",
			"reset",
			"processQueuedMessages",
		])
		expect(task.diffViewProvider.open).toHaveBeenCalledWith("src/a.ts", "modify")
		expect(task.diffViewProvider.update).toHaveBeenCalledWith(PATCHED, true)
		expect(task.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 50)
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith("src/a.ts", "roo_edited")
		expect(mockedPushToolWriteResult).toHaveBeenCalledWith(task, false)
		expect(mockedPause).toHaveBeenCalledWith(task, "src/a.ts")
		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT")
		expect(task.didEditFile).toBe(true)
	})

	it("reuses the diff session the streaming preview opened for the same path", async () => {
		await task.diffViewProvider.open("src/a.ts", "modify")
		log = []

		await writeFile("src/a.ts", PATCHED)

		expect(log.slice(0, 3)).toEqual(["getState", "update", "scrollToFirstDiff"])
		expect(task.diffViewProvider.open).toHaveBeenCalledTimes(1)
		expect(task.ask).not.toHaveBeenCalled()
	})

	it("create: opens the diff view as a create and reports a new file", async () => {
		await writeFile("src/new.ts", "export {}\n")

		expect(task.diffViewProvider.open).toHaveBeenCalledWith("src/new.ts", "create")
		expect(mockedPushToolWriteResult).toHaveBeenCalledWith(task, true)
	})

	it("writes directly without a diff view and without showing the file when focus-disruption prevention is on", async () => {
		experiments = { preventFocusDisruption: true }

		await writeFile("src/a.ts", PATCHED)

		expect(log).toEqual([
			"getState",
			"askApproval",
			"saveDirectly",
			"trackFileContext",
			"pushToolWriteResult",
			"pauseForPlanReview",
			"pushToolResult",
			"reset",
			"processQueuedMessages",
		])
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith("src/a.ts", PATCHED, false, true, 50)
		expect(task.diffViewProvider.originalContent).toBe(ORIGINAL)
	})

	it("writes a new file directly without showing it", async () => {
		experiments = { preventFocusDisruption: true }

		await writeFile("src/new.ts", "export {}\n")

		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith("src/new.ts", "export {}\n", false, true, 50)
		expect(mockedPushToolWriteResult).toHaveBeenCalledWith(task, true)
	})

	// Shared step: the rejection result is pushed (a duplicate the real callback
	// drops after askApproval's own denial result) and the diff view is reset.
	it("reverts and stops when the user rejects in the diff view", async () => {
		rejectApproval()

		await writeFile("src/a.ts", PATCHED)

		expect(log.slice(log.indexOf("askApproval"))).toEqual([
			"askApproval",
			"revertChanges",
			"pushToolResult",
			"reset",
		])
		expect(pushToolResult).toHaveBeenCalledWith("Changes were rejected by the user.")
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(mockedPause).not.toHaveBeenCalled()
		expect(task.didEditFile).toBe(false)
	})

	it("stops without a revert when the user rejects a direct write", async () => {
		experiments = { preventFocusDisruption: true }
		rejectApproval()

		await writeFile("src/a.ts", PATCHED)

		expect(log).toEqual(["getState", "askApproval", "pushToolResult", "reset"])
		expect(task.diffViewProvider.saveDirectly).not.toHaveBeenCalled()
	})

	// Shared step: the card also carries the patch under `diff` (the files-changed
	// panel reads `diff ?? content`, so it shows the same patch) and its keys
	// come in the shared order.
	it("pins the approval card of a modify and of a create (key order included)", async () => {
		task.rooProtectedController.isWriteProtected.mockReturnValue(true)
		await writeFile("src/a.ts", PATCHED)
		const [type, modifyCard, progress, isProtected] = askApproval.mock.calls[0]

		expect(type).toBe("tool")
		expect(progress).toBeUndefined()
		expect(isProtected).toBe(true)
		expect(modifyCard).toBe(
			JSON.stringify({
				tool: "editedExistingFile",
				path: "readable:src/a.ts",
				diff: "sanitized(diff src/a.ts)",
				isOutsideWorkspace: false,
				toolCallId: "call-1",
				content: "sanitized(diff src/a.ts)",
				isProtected: true,
				diffStats: { added: 1, removed: 1 },
			}),
		)

		task = makeTask()
		askApproval.mockClear()
		await writeFile("src/new.ts", "export {}\n")
		expect(askApproval.mock.calls[0][1]).toBe(
			JSON.stringify({
				tool: "newFileCreated",
				path: "readable:src/new.ts",
				diff: "sanitized(new-file-diff src/new.ts)",
				isOutsideWorkspace: false,
				toolCallId: "call-1",
				content: "sanitized(new-file-diff src/new.ts)",
				isProtected: false,
				diffStats: { added: 1, removed: 1 },
			}),
		)
	})

	// Shared step: one content for the card, the diff view and the save, so a
	// direct write no longer saves the line numbers the diff view stripped.
	it("strips line numbers in the diff view and in a direct write", async () => {
		await writeFile("src/a.ts", "1 | const a = 1\n2 | const b = 3")
		expect(task.diffViewProvider.update).toHaveBeenCalledWith("const a = 1\nconst b = 3", true)

		task = makeTask()
		experiments = { preventFocusDisruption: true }
		await writeFile("src/a.ts", "1 | const a = 1\n2 | const b = 3")
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith(
			"src/a.ts",
			"const a = 1\nconst b = 3",
			false,
			true,
			50,
		)
	})

	// Shared step: an unchanged existing file is reported without an approval.
	it("reports an unchanged file without asking or saving", async () => {
		await writeFile("src/a.ts", ORIGINAL)

		expect(askApproval).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith("No changes needed for 'src/a.ts'")
	})

	it("appends the plan-review note to the result", async () => {
		mockedPause.mockResolvedValue("REVIEW_NOTE")

		await writeFile("src/a.ts", PATCHED)

		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT\n\nREVIEW_NOTE")
	})
})

describe("apply_diff", () => {
	it("opens the diff view, scrolls, asks with the progress status, saves, reports, then runs the gate", async () => {
		await applyDiff()

		expect(handleError).not.toHaveBeenCalled()
		expect(log).toEqual([
			"getState",
			"open",
			"update",
			"scrollToFirstDiff",
			"askApproval",
			"saveChanges",
			"trackFileContext",
			"pushToolWriteResult",
			"pauseForPlanReview",
			"pushToolResult",
			"reset",
			"processQueuedMessages",
		])
		expect(task.diffViewProvider.open).toHaveBeenCalledWith("src/a.ts", "modify")
		expect(task.diffViewProvider.update).toHaveBeenCalledWith(PATCHED, true)
		expect(task.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 50)
		expect(askApproval.mock.calls[0][2]).toEqual({ icon: "diff-multiple", text: "1" })
		expect(mockedPushToolWriteResult).toHaveBeenCalledWith(task, false)
		expect(mockedPause).toHaveBeenCalledWith(task, "src/a.ts")
		expect(task.didEditFile).toBe(true)
	})

	it("writes directly without a diff view when focus-disruption prevention is on", async () => {
		experiments = { preventFocusDisruption: true }

		await applyDiff()

		expect(log).toEqual([
			"getState",
			"askApproval",
			"saveDirectly",
			"trackFileContext",
			"pushToolWriteResult",
			"pauseForPlanReview",
			"pushToolResult",
			"reset",
			"processQueuedMessages",
		])
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith("src/a.ts", PATCHED, false, true, 50)
		expect(task.diffViewProvider.originalContent).toBe(ORIGINAL)
	})

	// Shared step: rejection result and reset as for write_to_file.
	it("reverts and processes the queue when the user rejects in the diff view", async () => {
		rejectApproval()

		await applyDiff()

		expect(log.slice(log.indexOf("askApproval"))).toEqual([
			"askApproval",
			"revertChanges",
			"pushToolResult",
			"reset",
			"processQueuedMessages",
		])
		expect(mockedPause).not.toHaveBeenCalled()
		expect(task.didEditFile).toBe(false)
	})

	// Shared step: a rejected direct write also processes the queue, as a
	// rejection in the diff view always did.
	it("stops when the user rejects a direct write", async () => {
		experiments = { preventFocusDisruption: true }
		rejectApproval()

		await applyDiff()

		expect(log).toEqual(["getState", "askApproval", "pushToolResult", "reset", "processQueuedMessages"])
	})

	// Shared step: the card says whether the file is outside the workspace, so
	// auto-approval applies the outside-workspace write setting to apply_diff too.
	it("pins the approval card (key order included)", async () => {
		await applyDiff()

		expect(askApproval.mock.calls[0][1]).toBe(
			JSON.stringify({
				tool: "appliedDiff",
				path: "readable:src/a.ts",
				diff: SEARCH_REPLACE,
				originalContent: ORIGINAL,
				isOutsideWorkspace: false,
				toolCallId: "call-1",
				content: "sanitized(diff src/a.ts)",
				isProtected: false,
				diffStats: { added: 1, removed: 1 },
			}),
		)
	})

	it("marks a file outside the workspace in the card", async () => {
		vi.mocked(isPathOutsideWorkspace).mockReturnValueOnce(true)

		await applyDiff()

		expect(JSON.parse(askApproval.mock.calls[0][1] as string).isOutsideWorkspace).toBe(true)
	})

	it("puts the part-failure hint first and the single-block notice and review note last", async () => {
		task.diffStrategy.applyDiff.mockResolvedValue({
			success: true,
			content: PATCHED,
			failParts: [{ success: false, error: "no match" }],
		})
		mockedPause.mockResolvedValue("REVIEW_NOTE")

		await applyDiff()

		expect(pushToolResult).toHaveBeenCalledWith(
			`But unable to apply all diff parts to file: ${abs("src/a.ts")}. Use the read_file tool to check the newest file version and re-apply diffs.\n` +
				"WRITE_RESULT" +
				"\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>" +
				"\n\nREVIEW_NOTE",
		)
	})

	it("leaves out the single-block notice for several blocks", async () => {
		await applyDiff(`${SEARCH_REPLACE}\n${SEARCH_REPLACE}`)

		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT")
	})
})
