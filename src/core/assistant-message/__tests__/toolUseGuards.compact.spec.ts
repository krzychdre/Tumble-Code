// cd src && npx vitest run core/assistant-message/__tests__/toolUseGuards.compact.spec.ts
//
// Dispatch of the compact `edit` verb. The compact toolset advertises `edit` in
// every mode with the edit group, but `edit` is an opt-in tool of that group,
// which dispatch normally accepts only from a model's `includedTools`. Under a
// compact profile (the task's own) rejectInvalidToolUse accepts it the same
// way, and nowhere else: a mode without the edit group still rejects it, and the
// group's fileRegex still applies through file_path.

import type { ProviderSettings } from "@tumble-code/types"

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import { rejectInvalidToolUse, type ToolUseValidationContext } from "../steps/toolUseGuards"

function makeTask(apiConfiguration: Partial<ProviderSettings>) {
	return {
		apiConfiguration,
		api: { getModel: () => ({ id: "qwen3.5-4b", info: { contextWindow: 40960, supportsPromptCache: false } }) },
		cwd: "/test/path",
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		pushToolResultToUserContent: vi.fn(),
	}
}

function editCall(filePath: string): ToolUse {
	const args = { file_path: filePath, old_string: "- a", new_string: "- a\n- b" }
	return {
		type: "tool_use",
		id: "call_1",
		name: "edit",
		params: args,
		nativeArgs: args,
		partial: false,
	} as unknown as ToolUse
}

function context(taskMode: string, disabledTools?: string[]): ToolUseValidationContext {
	return { taskMode, customModes: [], disabledTools, stateExperiments: {} }
}

/** Runs the guard; returns the error text it pushed, or undefined when the call may run. */
async function guard(
	profile: Partial<ProviderSettings>,
	mode: string,
	filePath: string,
	disabledTools?: string[],
): Promise<string | undefined> {
	const task = makeTask(profile)
	const rejected = await rejectInvalidToolUse(
		task as unknown as Task,
		editCall(filePath),
		"call_1",
		context(mode, disabledTools),
	)
	if (!rejected) {
		expect(task.pushToolResultToUserContent).not.toHaveBeenCalled()
		return undefined
	}
	const result = task.pushToolResultToUserContent.mock.calls[0][0] as { content: string; is_error: boolean }
	expect(result.is_error).toBe(true)
	return result.content
}

const compact = { compactProfile: true }

describe("rejectInvalidToolUse - edit under a compact profile", () => {
	it("lets edit run in code mode", async () => {
		expect(await guard(compact, "code", "src/app.ts")).toBeUndefined()
	})

	it("rejects edit in ask mode, which has no edit group", async () => {
		expect(await guard(compact, "ask", "notes.md")).toContain("is not allowed in ask mode")
	})

	it("lets architect edit markdown only", async () => {
		expect(await guard(compact, "architect", "plan.md")).toBeUndefined()
		expect(await guard(compact, "architect", "src/app.ts")).toMatch(/can only edit files matching pattern/)
	})

	it("still honours disabledTools, aliases included", async () => {
		expect(await guard(compact, "code", "src/app.ts", ["edit"])).toContain("is not allowed in code mode")
		expect(await guard(compact, "code", "src/app.ts", ["search_and_replace"])).toContain(
			"is not allowed in code mode",
		)
	})

	it.each([{}, { compactProfile: false }])("keeps today's rejection without the flag (%j)", async (profile) => {
		expect(await guard(profile, "code", "src/app.ts")).toContain("is not allowed in code mode")
	})
})
