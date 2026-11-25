// cd src && ./node_modules/.bin/vitest run core/prompts/__tests__/system-prompt-input.spec.ts
//
// TOOLS IN THIS MODE suggests new_task and switch_mode only when the request's
// tool array carries them. The array drops them through `disabledTools`
// (computed by getRequestDisabledTools) and the model's `excludedTools`, so the
// prompt input has to see the same removals.

import type * as vscode from "vscode"

import { PARALLEL_TASKS_NO_LIMIT } from "@tumble-code/types"

import { buildSystemPromptInput, getRequestDisabledTools, taskOrigin } from "../system-prompt-input"

const context = {} as vscode.ExtensionContext

/** The source fields every test leaves at their plain value. */
const source = { context, memoryIndex: "", cwd: "/test/path", mode: "orchestrator", origin: "user" as const }

describe("taskOrigin", () => {
	it.each([
		[{ isBackground: false }, "user"],
		[{ isBackground: false, parentTaskId: "parent" }, "new_task"],
		[{ isBackground: true }, "subagent"],
	] as const)("%j is %s", (task, origin) => {
		expect(taskOrigin(task)).toBe(origin)
	})
})

describe("getRequestDisabledTools", () => {
	it.each([4, PARALLEL_TASKS_NO_LIMIT])(
		"keeps the user's list as is for a task the user started, parallel tasks on (cap %j)",
		(cap) => {
			expect(
				getRequestDisabledTools({ disabledTools: ["switch_mode"], parallelTasksMaxConcurrency: cap }, "user"),
			).toEqual(["switch_mode"])
		},
	)

	it.each([
		["new_task", ["switch_mode"]],
		["subagent", ["switch_mode", "new_task", "run_parallel_tasks", "wait_for_subagents"]],
	] as const)("removes what a %s task never gets", (origin, removed) => {
		expect(getRequestDisabledTools({ parallelTasksMaxConcurrency: 4 }, origin)).toEqual(removed)
	})

	it("removes the subagent tools when the concurrency cap turns the feature off", () => {
		expect(getRequestDisabledTools({ disabledTools: ["x"], parallelTasksMaxConcurrency: 1 }, "new_task")).toEqual([
			"x",
			"switch_mode",
			"run_parallel_tasks",
			"wait_for_subagents",
		])
	})
})

describe("buildSystemPromptInput", () => {
	it("carries the origin's removals and the subtask flag", () => {
		const input = buildSystemPromptInput({
			...source,
			state: { parallelTasksMaxConcurrency: 4 },
			origin: "subagent",
		})

		expect(input.settings?.removedTools).toContain("new_task")
		expect(input.settings?.isSubtask).toBe(true)
	})

	it("carries the user's disabledTools and the model's excludedTools", () => {
		const input = buildSystemPromptInput({
			...source,
			state: { disabledTools: ["switch_mode"], parallelTasksMaxConcurrency: 4 },
			modelInfo: { excludedTools: ["apply_diff"] },
		})

		expect(input.settings?.removedTools).toEqual(["switch_mode", "apply_diff"])
		expect(input.settings?.isSubtask).toBe(false)
	})
})

describe("buildSystemPromptInput cliDisplay", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("takes what the CLI's terminal UI shows from ROO_CLI_DISPLAY", () => {
		vi.stubEnv("ROO_CLI_DISPLAY", "images")
		const input = buildSystemPromptInput({ ...source, mode: "code", state: {} })

		expect(input.settings?.cliDisplay).toBe("images")
	})

	it("leaves it unset in VS Code", () => {
		vi.stubEnv("ROO_CLI_DISPLAY", "")
		const input = buildSystemPromptInput({ ...source, mode: "code", state: {} })

		expect(input.settings?.cliDisplay).toBeUndefined()
	})
})
