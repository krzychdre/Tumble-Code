/**
 * CORE-R8: characterization tests of the shared edit pipeline.
 *
 * `edit`, `search_replace`, `edit_file` and `apply_patch` (add and update)
 * all end in the same approval, diff view and save sequence. These tests pin
 * that sequence, the approval card, the plan-review gate and the literal
 * handling of `$` patterns for every tool, so the tools can share one
 * implementation without changing what the user or the model sees.
 *
 * The "drift resolutions" block pins the places where the copies had drifted
 * apart and the shared implementation settles on one behavior.
 */

import fs from "fs/promises"
import path from "path"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { pauseForPlanReviewIfNeeded } from "../../plan-review/planReviewPause"
import { editTool } from "../EditTool"
import { searchReplaceTool } from "../SearchReplaceTool"
import { editFileTool } from "../EditFileTool"
import { applyPatchTool } from "../ApplyPatchTool"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		unlink: vi.fn().mockResolvedValue(undefined),
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
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
}))

vi.mock("../../plan-review/planReviewPause", () => ({
	pauseForPlanReviewIfNeeded: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	env: { openExternal: vi.fn() },
	Uri: { parse: vi.fn(), file: vi.fn() },
}))

const CWD = "/ws"

const mockedReadFile = fs.readFile as unknown as MockedFunction<(p: string, enc: string) => Promise<string>>
const mockedFileExists = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
const mockedPause = pauseForPlanReviewIfNeeded as MockedFunction<typeof pauseForPlanReviewIfNeeded>

/** Files on the fake disk, keyed by absolute path. */
let disk: Record<string, string>
/** Ordered log of the side effects the pipeline performs. */
let log: string[]
let task: any
let askApproval: ReturnType<typeof vi.fn>
let pushToolResult: ReturnType<typeof vi.fn>
let handleError: ReturnType<typeof vi.fn>
let experiments: Record<string, boolean>

function makeTask() {
	const record =
		<T>(name: string, value?: T) =>
		(..._args: unknown[]) => {
			log.push(name)
			return value
		}
	return {
		cwd: CWD,
		taskId: "task-1",
		consecutiveMistakeCount: 0,
		consecutiveMistakeCountForEditFile: new Map<string, number>(),
		didEditFile: false,
		didToolFailInCurrentTurn: false,
		silentWrites: false,
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
		diffViewProvider: {
			editType: undefined as string | undefined,
			originalContent: undefined as string | undefined,
			open: vi.fn(async () => void log.push("open")),
			update: vi.fn(async () => void log.push("update")),
			scrollToFirstDiff: vi.fn(record("scrollToFirstDiff")),
			revertChanges: vi.fn(async () => void log.push("revertChanges")),
			saveChanges: vi.fn(async () => void log.push("saveChanges")),
			saveDirectly: vi.fn(async () => void log.push("saveDirectly")),
			pushToolWriteResult: vi.fn(async () => {
				log.push("pushToolWriteResult")
				return "WRITE_RESULT"
			}),
			reset: vi.fn(async () => void log.push("reset")),
		},
		fileContextTracker: {
			trackFileContext: vi.fn(async () => void log.push("trackFileContext")),
		},
		say: vi.fn(async () => undefined),
		ask: vi.fn(async () => undefined),
		recordToolError: vi.fn(),
		recordToolUsage: vi.fn(record("recordToolUsage")),
		processQueuedMessages: vi.fn(record("processQueuedMessages")),
		sayAndCreateMissingParamError: vi.fn(async () => "missing param"),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	disk = {
		[`${CWD}/src/a.ts`]: "const a = 1\nconst b = 2\n",
		[`${CWD}/plans/plan.md`]: "# Plan\nstep one\n",
	}
	log = []
	experiments = {}
	mockedReadFile.mockImplementation(async (p: string) => {
		if (!(p in disk)) throw new Error(`ENOENT ${p}`)
		return disk[p]
	})
	mockedFileExists.mockImplementation(async (p: string) => p in disk)
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
	editTool.resetPartialState()
	searchReplaceTool.resetPartialState()
	editFileTool.resetPartialState()
	applyPatchTool.resetPartialState()
})

const callbacks = () => ({ askApproval, pushToolResult, handleError, toolCallId: "call-1" })

type Case = {
	name: string
	run: () => Promise<void>
	/** Path the pipeline edits (relative to the workspace). */
	relPath: string
	isNewFile: boolean
	newContent: string
	/** Tail after the shared sequence (differs per tool on purpose). */
	tail: string[]
}

const updatePatch = (file: string, body: string, extra = "") =>
	`*** Begin Patch\n*** Update File: ${file}\n${extra}@@\n${body}\n*** End Patch`

const CASES: Case[] = [
	{
		name: "edit",
		run: () =>
			editTool.execute(
				{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
				task,
				callbacks(),
			),
		relPath: "src/a.ts",
		isNewFile: false,
		newContent: "const a = 1\nconst b = 3\n",
		tail: ["recordToolUsage", "reset", "processQueuedMessages"],
	},
	{
		name: "search_replace",
		run: () =>
			searchReplaceTool.execute(
				{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
				task,
				callbacks(),
			),
		relPath: "src/a.ts",
		isNewFile: false,
		newContent: "const a = 1\nconst b = 3\n",
		tail: ["recordToolUsage", "reset", "processQueuedMessages"],
	},
	{
		name: "edit_file (modify)",
		run: () =>
			editFileTool.execute(
				{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
				task,
				callbacks(),
			),
		relPath: "src/a.ts",
		isNewFile: false,
		newContent: "const a = 1\nconst b = 3\n",
		tail: ["recordToolUsage", "reset", "processQueuedMessages"],
	},
	{
		name: "edit_file (create)",
		run: () =>
			editFileTool.execute(
				{ file_path: "src/new.ts", old_string: "", new_string: "export {}\n" },
				task,
				callbacks(),
			),
		relPath: "src/new.ts",
		isNewFile: true,
		newContent: "export {}\n",
		tail: ["recordToolUsage", "reset", "processQueuedMessages"],
	},
	{
		name: "apply_patch (update)",
		run: () =>
			applyPatchTool.execute(
				{ patch: updatePatch("src/a.ts", " const a = 1\n-const b = 2\n+const b = 3") },
				task,
				callbacks(),
			),
		relPath: "src/a.ts",
		isNewFile: false,
		newContent: "const a = 1\nconst b = 3\n",
		tail: ["reset", "processQueuedMessages", "recordToolUsage"],
	},
	{
		name: "apply_patch (add)",
		run: () =>
			applyPatchTool.execute(
				{ patch: "*** Begin Patch\n*** Add File: src/new.ts\n+export {}\n*** End Patch" },
				task,
				callbacks(),
			),
		relPath: "src/new.ts",
		isNewFile: true,
		newContent: "export {}\n",
		tail: ["reset", "processQueuedMessages", "recordToolUsage"],
	},
]

describe("edit pipeline: approval, diff view and save sequence", () => {
	describe.each(CASES)("$name", (c) => {
		it("shows the diff view, asks, saves, tracks, reports, then runs the gate", async () => {
			await c.run()

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
				...c.tail,
			])
			expect(task.diffViewProvider.editType).toBe(c.isNewFile ? "create" : "modify")
			expect(task.diffViewProvider.open).toHaveBeenCalledWith(c.relPath)
			expect(task.diffViewProvider.update).toHaveBeenCalledWith(c.newContent, true)
			expect(task.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 50)
			expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith(c.relPath, "roo_edited")
			expect(task.diffViewProvider.pushToolWriteResult).toHaveBeenCalledWith(task, CWD, c.isNewFile)
			expect(mockedPause).toHaveBeenCalledWith(task, c.relPath)
			expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT")
			expect(task.didEditFile).toBe(true)
		})

		it("writes directly without a diff view when focus-disruption prevention is on", async () => {
			experiments = { preventFocusDisruption: true }

			await c.run()

			expect(log).toEqual([
				"getState",
				"askApproval",
				"saveDirectly",
				"trackFileContext",
				"pushToolWriteResult",
				"pauseForPlanReview",
				"pushToolResult",
				...c.tail,
			])
			expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith(
				c.relPath,
				c.newContent,
				c.isNewFile,
				true,
				50,
			)
		})

		it("reverts, reports the rejection and never saves or pauses when the user rejects", async () => {
			askApproval.mockImplementation(async () => {
				log.push("askApproval")
				return false
			})

			await c.run()

			expect(log.slice(0, 8)).toEqual([
				"getState",
				"open",
				"update",
				"scrollToFirstDiff",
				"askApproval",
				"revertChanges",
				"pushToolResult",
				"reset",
			])
			expect(pushToolResult).toHaveBeenCalledWith("Changes were rejected by the user.")
			expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
			expect(task.diffViewProvider.saveDirectly).not.toHaveBeenCalled()
			expect(mockedPause).not.toHaveBeenCalled()
			expect(task.didEditFile).toBe(false)
		})

		it("passes the write-protection flag to the approval", async () => {
			task.rooProtectedController.isWriteProtected.mockReturnValue(true)

			await c.run()

			const [type, message, progress, isProtected] = askApproval.mock.calls[0]
			expect(type).toBe("tool")
			expect(progress).toBeUndefined()
			expect(isProtected).toBe(true)
			expect(JSON.parse(message as string).isProtected).toBe(true)
		})
	})

	it("pins the approval card of each tool (key order included)", async () => {
		const cards: Record<string, string> = {}
		for (const c of CASES) {
			askApproval.mockClear()
			task = makeTask()
			await c.run()
			cards[c.name] = askApproval.mock.calls[0][1] as string
		}

		const modify = {
			tool: "appliedDiff",
			path: "readable:src/a.ts",
			diff: "sanitized(diff src/a.ts)",
			isOutsideWorkspace: false,
			toolCallId: "call-1",
			content: "sanitized(diff src/a.ts)",
			isProtected: false,
			diffStats: { added: 1, removed: 1 },
		}
		const create = (tool: string) => ({
			tool,
			path: "readable:src/new.ts",
			diff: "sanitized(diff src/new.ts)",
			isOutsideWorkspace: false,
			toolCallId: "call-1",
			content: "sanitized(diff src/new.ts)",
			isProtected: false,
			diffStats: { added: 1, removed: 1 },
		})

		expect(cards["edit"]).toBe(JSON.stringify(modify))
		expect(cards["search_replace"]).toBe(JSON.stringify(modify))
		expect(cards["edit_file (modify)"]).toBe(JSON.stringify(modify))
		// edit_file announces a created file with its own card type.
		expect(cards["edit_file (create)"]).toBe(JSON.stringify(create("newFileCreated")))
		// apply_patch keeps "appliedDiff" for an added file.
		expect(cards["apply_patch (add)"]).toBe(JSON.stringify(create("appliedDiff")))
		// apply_patch is the only one that sends the original content on update.
		expect(cards["apply_patch (update)"]).toBe(
			JSON.stringify({
				tool: "appliedDiff",
				path: "readable:src/a.ts",
				diff: "sanitized(diff src/a.ts)",
				originalContent: "const a = 1\nconst b = 2\n",
				isOutsideWorkspace: false,
				toolCallId: "call-1",
				content: "sanitized(diff src/a.ts)",
				isProtected: false,
				diffStats: { added: 1, removed: 1 },
			}),
		)
	})

	it("keeps the original content each tool hands to the diff view", async () => {
		const seen: Record<string, unknown> = {}
		for (const c of CASES) {
			task = makeTask()
			await c.run()
			seen[c.name] = task.diffViewProvider.originalContent
		}
		expect(seen).toEqual({
			edit: "const a = 1\nconst b = 2\n",
			search_replace: "const a = 1\nconst b = 2\n",
			"edit_file (modify)": "const a = 1\nconst b = 2\n",
			"edit_file (create)": "",
			"apply_patch (update)": "const a = 1\nconst b = 2\n",
			"apply_patch (add)": undefined,
		})
	})
})

describe("edit pipeline: plan-review gate for every edit tool", () => {
	it.each([
		[
			"edit",
			() =>
				editTool.execute(
					{ file_path: "plans/plan.md", old_string: "step one", new_string: "step two" },
					task,
					callbacks(),
				),
		],
		[
			"search_replace",
			() =>
				searchReplaceTool.execute(
					{ file_path: "plans/plan.md", old_string: "step one", new_string: "step two" },
					task,
					callbacks(),
				),
		],
		[
			"edit_file",
			() =>
				editFileTool.execute(
					{ file_path: "plans/plan.md", old_string: "step one", new_string: "step two" },
					task,
					callbacks(),
				),
		],
		[
			"apply_patch",
			() =>
				applyPatchTool.execute(
					{ patch: updatePatch("plans/plan.md", " # Plan\n-step one\n+step two") },
					task,
					callbacks(),
				),
		],
	])("%s pauses after the save and appends the review note", async (_name, run) => {
		mockedPause.mockImplementation(async () => {
			log.push("pauseForPlanReview")
			return "REVIEW_NOTE"
		})

		await run()

		expect(mockedPause).toHaveBeenCalledTimes(1)
		expect(mockedPause).toHaveBeenCalledWith(task, "plans/plan.md")
		expect(log.indexOf("pauseForPlanReview")).toBeGreaterThan(log.indexOf("saveChanges"))
		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT\n\nREVIEW_NOTE")
	})

	it("apply_patch pauses on the destination of a move", async () => {
		mockedPause.mockResolvedValue("REVIEW_NOTE")

		await applyPatchTool.execute(
			{
				patch: updatePatch(
					"src/a.ts",
					" const a = 1\n-const b = 2\n+const b = 3",
					"*** Move to: plans/moved.md\n",
				),
			},
			task,
			callbacks(),
		)

		expect(handleError).not.toHaveBeenCalled()
		expect(mockedPause).toHaveBeenCalledWith(task, "plans/moved.md")
		expect(fs.writeFile).toHaveBeenCalledWith(`${CWD}/plans/moved.md`, "const a = 1\nconst b = 3\n", "utf8")
		expect(fs.unlink).toHaveBeenCalledWith(`${CWD}/src/a.ts`)
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith("plans/moved.md", "roo_edited")
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT\n\nREVIEW_NOTE")
	})

	it("edit_file puts the replacement count before the review note", async () => {
		disk[`${CWD}/plans/plan.md`] = "# Plan\nstep one\nstep one\n"
		mockedPause.mockResolvedValue("REVIEW_NOTE")

		await editFileTool.execute(
			{ file_path: "plans/plan.md", old_string: "step one", new_string: "step two", expected_replacements: 2 },
			task,
			callbacks(),
		)

		expect(pushToolResult).toHaveBeenCalledWith("WRITE_RESULT (2 replacements)\n\nREVIEW_NOTE")
	})
})

describe("edit pipeline: `$` patterns in the replacement stay literal", () => {
	const DOLLAR = "x = `$&` + '$1' + \"$$\" + $` + $' + $<name>"
	const FILE = "before\nTARGET\nafter\n"
	const expected = `before\n${DOLLAR}\nafter\n`

	beforeEach(() => {
		disk[`${CWD}/src/a.ts`] = FILE
	})

	const written = () => task.diffViewProvider.update.mock.calls[0][0]

	it("edit (single occurrence)", async () => {
		await editTool.execute({ file_path: "src/a.ts", old_string: "TARGET", new_string: DOLLAR }, task, callbacks())
		expect(written()).toBe(expected)
	})

	it("edit (replace_all)", async () => {
		disk[`${CWD}/src/a.ts`] = "TARGET\nTARGET\n"
		await editTool.execute(
			{ file_path: "src/a.ts", old_string: "TARGET", new_string: DOLLAR, replace_all: true },
			task,
			callbacks(),
		)
		expect(written()).toBe(`${DOLLAR}\n${DOLLAR}\n`)
	})

	it("search_replace", async () => {
		await searchReplaceTool.execute(
			{ file_path: "src/a.ts", old_string: "TARGET", new_string: DOLLAR },
			task,
			callbacks(),
		)
		expect(written()).toBe(expected)
	})

	it("edit_file (exact match)", async () => {
		await editFileTool.execute(
			{ file_path: "src/a.ts", old_string: "TARGET", new_string: DOLLAR },
			task,
			callbacks(),
		)
		expect(written()).toBe(expected)
	})

	it("edit_file (whitespace-tolerant match)", async () => {
		disk[`${CWD}/src/a.ts`] = "before\nfoo   bar\nafter\n"
		await editFileTool.execute(
			{ file_path: "src/a.ts", old_string: "foo bar", new_string: DOLLAR },
			task,
			callbacks(),
		)
		expect(written()).toBe(expected)
	})

	it("edit_file (token match)", async () => {
		disk[`${CWD}/src/a.ts`] = "before\nfoo\n  bar\nafter\n"
		await editFileTool.execute(
			{ file_path: "src/a.ts", old_string: "foo bar", new_string: DOLLAR },
			task,
			callbacks(),
		)
		expect(written()).toBe(expected)
	})

	it("apply_patch", async () => {
		await applyPatchTool.execute(
			{ patch: updatePatch("src/a.ts", " before\n-TARGET\n+" + DOLLAR) },
			task,
			callbacks(),
		)
		expect(written()).toBe(expected)
	})
})

describe("edit pipeline: drift resolutions", () => {
	it.each([
		[
			"edit",
			() =>
				editTool.execute(
					{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
					task,
					callbacks(),
				),
		],
		[
			"search_replace",
			() =>
				searchReplaceTool.execute(
					{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
					task,
					callbacks(),
				),
		],
		[
			"edit_file",
			() =>
				editFileTool.execute(
					{ file_path: "src/a.ts", old_string: "const b = 2", new_string: "const b = 3" },
					task,
					callbacks(),
				),
		],
		[
			"apply_patch",
			() =>
				applyPatchTool.execute(
					{ patch: updatePatch("src/a.ts", " const a = 1\n-const b = 2\n+const b = 3") },
					task,
					callbacks(),
				),
		],
	])("%s keeps a silent-writes (background memory) task off-screen", async (_name, run) => {
		task.silentWrites = true

		await run()

		expect(task.diffViewProvider.open).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith(
			"src/a.ts",
			"const a = 1\nconst b = 3\n",
			false,
			true,
			50,
		)
	})

	it("edit turns an absolute path inside the workspace into a relative one, like search_replace", async () => {
		for (const tool of [editTool, searchReplaceTool]) {
			task = makeTask()
			await tool.execute(
				{ file_path: path.join(CWD, "src/a.ts"), old_string: "const b = 2", new_string: "const b = 3" },
				task,
				callbacks(),
			)
			expect(task.diffViewProvider.open).toHaveBeenCalledWith("src/a.ts")
			expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith("src/a.ts", "roo_edited")
			expect(mockedPause).toHaveBeenLastCalledWith(task, "src/a.ts")
		}
	})
})
