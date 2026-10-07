// cd src && ./node_modules/.bin/vitest run core/prompts/__tests__/system-prompt-input.spec.ts
//
// TOOLS IN THIS MODE suggests new_task and switch_mode only when the request's
// tool array carries them. The array drops them through `disabledTools`
// (computed by getRequestDisabledTools) and the model's `excludedTools`, so the
// prompt input has to see the same removals.

import type * as vscode from "vscode"

import { buildSystemPromptInput, getRequestDisabledTools } from "../system-prompt-input"

const context = {} as vscode.ExtensionContext

describe("getRequestDisabledTools", () => {
	it("keeps the user's list as is for a foreground task with parallel tasks on", () => {
		const disabled = ["switch_mode"]
		expect(getRequestDisabledTools({ disabledTools: disabled, parallelTasksMaxConcurrency: 4 }, false)).toBe(
			disabled,
		)
	})

	it("removes the delegation tools from a background task", () => {
		expect(getRequestDisabledTools({ parallelTasksMaxConcurrency: 4 }, true)).toEqual([
			"new_task",
			"run_parallel_tasks",
		])
	})

	it("removes run_parallel_tasks when the concurrency cap turns the feature off", () => {
		expect(getRequestDisabledTools({ disabledTools: ["x"], parallelTasksMaxConcurrency: 1 }, false)).toEqual([
			"x",
			"run_parallel_tasks",
		])
	})
})

describe("buildSystemPromptInput removedTools", () => {
	it("carries the background removal of new_task", () => {
		const input = buildSystemPromptInput({
			context,
			cwd: "/test/path",
			mode: "orchestrator",
			state: { parallelTasksMaxConcurrency: 4 },
			isBackground: true,
		})

		expect(input.settings?.removedTools).toContain("new_task")
	})

	it("carries the user's disabledTools and the model's excludedTools", () => {
		const input = buildSystemPromptInput({
			context,
			cwd: "/test/path",
			mode: "orchestrator",
			state: { disabledTools: ["switch_mode"], parallelTasksMaxConcurrency: 4 },
			modelInfo: { excludedTools: ["apply_diff"] },
		})

		expect(input.settings?.removedTools).toEqual(["switch_mode", "apply_diff"])
	})
})
