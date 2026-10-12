// npx vitest core/environment/__tests__/getEnvironmentDetails.compact.spec.ts

import type { Mock } from "vitest"

import { getEnvironmentDetails } from "../getEnvironmentDetails"
import { getFullModeDetails } from "../../prompts/modeDetails"
import { consolidateTokenUsage } from "@tumble-code/core/browser"
import { listFiles } from "../../../services/glob/list-files"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { arePathsEqual } from "../../../utils/path"
import { formatResponse } from "../../prompts/responses"
import { getGitStatus } from "../../../utils/git"
import type { Task } from "../../task/Task"

const vscodeMock = vi.hoisted(() => {
	class TabInputText {
		constructor(public uri: { fsPath: string }) {}
	}
	return {
		TabInputText,
		window: {
			tabGroups: { all: [] as Array<{ tabs: Array<{ input: unknown }> }>, onDidChangeTabs: vi.fn() },
			visibleTextEditors: [] as Array<{ document: { uri: { fsPath: string } } }>,
		},
		env: { language: "en-US" },
	}
})

vi.mock("vscode", () => vscodeMock)
vi.mock("p-wait-for", () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock("execa", () => ({ execa: vi.fn() }))
vi.mock("../../prompts/modeDetails")
vi.mock("@tumble-code/core/browser", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tumble-code/core/browser")>()),
	consolidateTokenUsage: vi.fn(),
}))
vi.mock("../../../services/glob/list-files")
vi.mock("../../../integrations/terminal/TerminalRegistry")
vi.mock("../../../integrations/terminal/Terminal")
vi.mock("../../../utils/path")
vi.mock("../../../utils/git")
vi.mock("../../prompts/responses")
// Both time formats in a fixed zone, so the pinned strings do not depend on the machine.
vi.mock("../currentTime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../currentTime")>()
	return {
		formatCurrentTime: (now: Date) => actual.formatCurrentTime(now, "Europe/Warsaw"),
		formatCompactCurrentTime: (now: Date) => actual.formatCompactCurrentTime(now, "Europe/Warsaw"),
	}
})

const CWD = "/test/path"

function setEditors(visible: string[], tabs: string[]) {
	vscodeMock.window.visibleTextEditors = visible.map((p) => ({ document: { uri: { fsPath: `${CWD}/${p}` } } }))
	vscodeMock.window.tabGroups.all = [
		{ tabs: tabs.map((p) => ({ input: new vscodeMock.TabInputText({ fsPath: `${CWD}/${p}` }) })) },
	]
}

function makeTerminal(
	id: number,
	opts: { command: string; cwd?: string; processes?: Array<{ command: string; output: string }> },
) {
	return {
		id,
		getLastCommand: vi.fn().mockReturnValue(opts.command),
		getCurrentWorkingDirectory: vi.fn().mockReturnValue(opts.cwd ?? CWD),
		getProcessesWithOutput: vi
			.fn()
			.mockReturnValue(
				(opts.processes ?? []).map((p) => ({
					command: p.command,
					getUnretrievedOutput: vi.fn().mockReturnValue(p.output),
				})),
			),
		cleanCompletedProcessQueue: vi.fn(),
	}
}

describe("getEnvironmentDetails under the compact profile", () => {
	let state: Record<string, unknown>
	let task: Partial<Task> & { apiConfiguration: Record<string, unknown> }

	const makeTask = (apiConfiguration: Record<string, unknown>) =>
		({
			cwd: CWD,
			taskId: "task-1",
			didEditFile: false,
			apiConfiguration,
			fileContextTracker: { getAndClearRecentlyModifiedFiles: vi.fn().mockReturnValue([]) },
			rooIgnoreController: { filterPaths: vi.fn((paths: string[]) => paths.join("\n")) },
			clineMessages: [],
			todoList: [{ id: "1", content: "write the tests", status: "pending" }],
			api: { getModel: vi.fn().mockReturnValue({ id: "qwen3.5-4b-q4_k_m", info: { contextWindow: 40960 } }) },
			providerRef: { deref: () => ({ getState: vi.fn(async () => state) }) },
			getTaskMode: vi.fn().mockResolvedValue("code"),
		}) as unknown as Partial<Task> & { apiConfiguration: Record<string, unknown> }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date("2026-10-10T18:15:42.000Z"))
		setEditors([], [])

		state = {
			maxWorkspaceFiles: 200,
			maxOpenTabsContext: 20,
			customModes: [],
			experiments: {},
			language: "en",
			showRooIgnoredFiles: false,
		}
		task = makeTask({ compactProfile: true })
		;(consolidateTokenUsage as Mock).mockReturnValue({ contextTokens: 1000, totalCost: 0.25 })
		;(getFullModeDetails as Mock).mockResolvedValue({ name: "Code", roleDefinition: "", customInstructions: "" })
		;(listFiles as Mock).mockResolvedValue([["src/", "src/a.ts", "README.md"], false])
		;(formatResponse.formatFilesList as Mock).mockReturnValue("src/\nsrc/a.ts\nREADME.md")
		;(arePathsEqual as Mock).mockReturnValue(false)
		;(Terminal.compressTerminalOutput as Mock).mockImplementation((output: string) => output)
		;(TerminalRegistry.getTerminals as Mock).mockReturnValue([])
		;(TerminalRegistry.getBackgroundTerminals as Mock).mockReturnValue([])
		;(TerminalRegistry.isProcessHot as Mock).mockReturnValue(false)
		;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("")
		;(getGitStatus as Mock).mockResolvedValue("## main")
	})

	afterEach(() => {
		vi.useRealTimers()
		setEditors([], [])
	})

	describe("flag off: today's block, byte for byte", () => {
		/** A busy workspace: every section of the regular block has something to say. */
		function busyWorkspace(t: typeof task) {
			setEditors(["src/a.ts"], ["src/a.ts", "README.md"])
			state = { ...state, maxGitStatusFiles: 5 }
			;(t.fileContextTracker!.getAndClearRecentlyModifiedFiles as Mock).mockReturnValue(["src/b.ts"])
			const busy = makeTerminal(1, { command: "npm run watch" })
			const inactive = makeTerminal(2, {
				command: "npm test",
				cwd: "/test/path/pkg",
				processes: [{ command: "npm test", output: "1 passed" }],
			})
			;(TerminalRegistry.getTerminals as Mock).mockImplementation((active: boolean) =>
				active ? [busy] : [inactive],
			)
			;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("rebuilt in 20 ms")
		}

		/** First turn, then a later turn with the terminals and the modified file gone quiet. */
		async function firstAndLater(apiConfiguration: Record<string, unknown>) {
			const t = makeTask(apiConfiguration)
			busyWorkspace(t)
			const first = await getEnvironmentDetails(t as Task, true)
			;(TerminalRegistry.getTerminals as Mock).mockReturnValue([])
			;(t.fileContextTracker!.getAndClearRecentlyModifiedFiles as Mock).mockReturnValue([])
			const later = await getEnvironmentDetails(t as Task)
			return { first, later }
		}

		// Pinned against the implementation before the compact branch existed.
		it("keeps today's first and later turn with the flag absent", async () => {
			const { first, later } = await firstAndLater({})
			expect(first).toMatchInlineSnapshot(`
				"<environment_details>
				# VSCode Visible Files
				src/a.ts

				# VSCode Open Tabs
				src/a.ts
				README.md

				# Recently Modified Files
				These files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):
				src/b.ts

				# Actively Running Terminals
				## Terminal 1 (Active)
				### Working Directory: \`/test/path\`
				### Original command: \`npm run watch\`
				### New Output
				rebuilt in 20 ms

				# Inactive Terminals with Completed Process Output
				## Terminal 2 (Inactive)
				### Working Directory: \`/test/path/pkg\`
				### New Output
				Command: \`npm test\`
				1 passed

				# Current Time
				Local time: 2026-10-10 20:15:42 (Saturday), time zone Europe/Warsaw (UTC+02:00)
				Same moment in UTC: 2026-10-10T18:15:42Z
				Today in local time runs from 2026-10-09T22:00:00Z to 2026-10-10T22:00:00Z (UTC).
				Logs and databases usually store UTC: convert before reporting, and use the local day above for "today".

				# Git Status
				## main

				# Current Cost
				$0.25

				# Current Mode
				<slug>code</slug>
				<name>Code</name>
				<model>qwen3.5-4b-q4_k_m</model>


				# Current Workspace Directory (/test/path) Files
				src/
				src/a.ts
				README.md
				====

				REMINDERS

				Below is your current list of reminders for this task. Keep them updated as you progress.

				| # | Content | Status |
				|---|---------|--------|
				| 1 | write the tests | Pending |


				IMPORTANT: When task status changes, remember to call the \`update_todo_list\` tool to update your progress.

				</environment_details>"
			`)
			expect(later).toMatchInlineSnapshot(`
				"<environment_details>
				# Current Time
				Local time: 2026-10-10 20:15:42 (Saturday), time zone Europe/Warsaw (UTC+02:00)
				Same moment in UTC: 2026-10-10T18:15:42Z
				Today in local time runs from 2026-10-09T22:00:00Z to 2026-10-10T22:00:00Z (UTC).
				Logs and databases usually store UTC: convert before reporting, and use the local day above for "today".

				# Git Status
				## main

				# Current Cost
				$0.25
				====

				REMINDERS

				Below is your current list of reminders for this task. Keep them updated as you progress.

				| # | Content | Status |
				|---|---------|--------|
				| 1 | write the tests | Pending |


				IMPORTANT: When task status changes, remember to call the \`update_todo_list\` tool to update your progress.

				</environment_details>"
			`)
		})

		it("gives the same bytes with the flag saved as false", async () => {
			const absent = await firstAndLater({})
			const explicitFalse = await firstAndLater({ compactProfile: false })
			expect(explicitFalse).toEqual(absent)
		})
	})

	describe("flag on", () => {
		const longPath = (i: number) =>
			`packages/some-long-package-name/src/components/deeply/nested/folder/file-${i}.tsx`

		it("first turn: time line, mode, editors, short listing; no cost, no reminder; at most 2,500 chars", async () => {
			setEditors(["notes/coffee.md"], ["notes/coffee.md", "README.md"])

			const first = await getEnvironmentDetails(task as Task, true)

			expect(first).toBe(
				[
					"<environment_details>",
					"Current time: 2026-10-10 20:15 (Saturday), Europe/Warsaw",
					"Current mode: code",
					"Visible files: notes/coffee.md",
					"Open tabs: notes/coffee.md, README.md",
					"Workspace files (/test/path):",
					"src/",
					"src/a.ts",
					"README.md",
					"</environment_details>",
				].join("\n"),
			)
			expect(first.length).toBeLessThanOrEqual(2_500)
			expect(consolidateTokenUsage).not.toHaveBeenCalled()
			expect(getFullModeDetails).not.toHaveBeenCalled()
			expect(listFiles).toHaveBeenCalledWith(CWD, true, 50)
		})

		it("first turn stays within 2,500 chars with long paths, many tabs and a truncated listing", async () => {
			const files = Array.from({ length: 60 }, (_, i) => longPath(i))
			;(listFiles as Mock).mockResolvedValue([files.slice(0, 50), true])
			;(formatResponse.formatFilesList as Mock).mockReturnValue(files.slice(0, 50).join("\n"))
			setEditors([longPath(1), longPath(2)], files.slice(0, 12))

			const first = await getEnvironmentDetails(task as Task, true)

			expect(first.length).toBeLessThanOrEqual(2_500)
			expect(first).toMatch(/\nOpen tabs: .* \(\+\d+ more\)\n/)
			expect(first).toMatch(/\n\(First \d+ entries shown\. Use list_files on a subdirectory to see more\.\)\n/)
			// The listing is cut at a line boundary: every listed line is a whole path.
			const listing = first.split("Workspace files (/test/path):\n")[1].split("\n(First")[0]
			for (const line of listing.split("\n")) {
				expect(files).toContain(line)
			}
		})

		it("later turn in a quiet workspace is the time line alone, at most 200 chars", async () => {
			setEditors(["notes/coffee.md"], ["notes/coffee.md"])
			await getEnvironmentDetails(task as Task, true)

			const later = await getEnvironmentDetails(task as Task)

			expect(later).toBe(
				"<environment_details>\nCurrent time: 2026-10-10 20:15 (Saturday), Europe/Warsaw\n</environment_details>",
			)
			expect(later.length).toBeLessThanOrEqual(200)
		})

		it("re-emits the mode line only after a mode switch", async () => {
			await getEnvironmentDetails(task as Task, true)
			expect(await getEnvironmentDetails(task as Task)).not.toContain("Current mode:")

			vi.mocked(task.getTaskMode!).mockResolvedValue("ask")
			expect(await getEnvironmentDetails(task as Task)).toContain("\nCurrent mode: ask\n")
		})

		it("shows at most 5 open tabs and says when they are all closed", async () => {
			setEditors([], ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"])
			const first = await getEnvironmentDetails(task as Task, true)
			expect(first).toContain("\nOpen tabs: a.md, b.md, c.md, d.md, e.md (+2 more)\n")

			setEditors([], [])
			expect(await getEnvironmentDetails(task as Task)).toContain("\nOpen tabs: none\n")
		})

		it("lists recently modified files on one line", async () => {
			;(task.fileContextTracker!.getAndClearRecentlyModifiedFiles as Mock).mockReturnValue(["a.md", "b.md"])
			const result = await getEnvironmentDetails(task as Task)
			expect(result).toContain("\nChanged since you last read them (re-read before editing): a.md, b.md\n")
		})

		it("keeps terminal sections but only the last 800 characters of each output, from a line start", async () => {
			const longOutput = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
			const busy = makeTerminal(1, { command: "npm run watch" })
			const inactive = makeTerminal(2, {
				command: "npm test",
				cwd: "/test/path/pkg",
				processes: [{ command: "npm test", output: longOutput }],
			})
			;(TerminalRegistry.getTerminals as Mock).mockImplementation((active: boolean) =>
				active ? [busy] : [inactive],
			)
			;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("rebuilt in 20 ms")

			const result = await getEnvironmentDetails(task as Task)

			expect(result).toContain("\nTerminal 1 running `npm run watch`:\nrebuilt in 20 ms\n")
			const section = result
				.split("Terminal 2 finished `npm test` in /test/path/pkg:\n")[1]
				.split("\n</environment_details>")[0]
			expect(section).toMatch(/^\(\d+ earlier characters cut\)\nline \d+\n/)
			expect(section.endsWith("line 199")).toBe(true)
			expect(section.length).toBeLessThanOrEqual(800 + 40)
			expect(inactive.cleanCompletedProcessQueue).toHaveBeenCalled()
		})

		it("keeps git status when the user turned it on, capped at 10 files", async () => {
			state = { ...state, maxGitStatusFiles: 50 }
			const result = await getEnvironmentDetails(task as Task)
			expect(result).toContain("\nGit status:\n## main")
			expect(getGitStatus).toHaveBeenCalledWith(CWD, 10)
		})

		it("respects includeCurrentTime: off means the time line only on full emissions", async () => {
			state = { ...state, includeCurrentTime: false }
			expect(await getEnvironmentDetails(task as Task, true)).toContain("Current time:")
			expect(await getEnvironmentDetails(task as Task)).toBe("<environment_details>\n</environment_details>")
		})

		it("points at the earlier listing when the workspace did not change", async () => {
			await getEnvironmentDetails(task as Task, true)
			const again = await getEnvironmentDetails(task as Task, true)
			expect(again).toContain("Workspace files (/test/path): (Unchanged since the listing earlier")
		})

		it("never reads the flag from the panel state, only from the task's profile", async () => {
			const t = makeTask({})
			state = { ...state, apiConfiguration: { compactProfile: true } }
			const result = await getEnvironmentDetails(t as Task, true)
			expect(result).toContain("# Current Mode")
			expect(result).not.toContain("Current mode: code")
		})
	})
})
