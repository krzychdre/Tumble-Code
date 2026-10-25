// SwitchModeTool with the real mode table; the task, its provider and the post-switch delay
// (the clock) are replaced.

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { SwitchModeTool } from "../SwitchModeTool"
import { formatResponse } from "../../prompts/responses"

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

const customMode = { slug: "reviewer", name: "Reviewer", roleDefinition: "r", groups: ["read"] }

function makeTask(taskMode = "code") {
	const provider = {
		getState: vi.fn().mockResolvedValue({ mode: "architect", customModes: [customMode] }),
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
	}
	const task = {
		consecutiveMistakeCount: 2,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing mode_slug"),
		ask: vi.fn().mockResolvedValue({}),
		getTaskMode: vi.fn().mockResolvedValue(taskMode),
		providerRef: { deref: () => provider },
	} as unknown as Task & Record<"ask" | "recordToolError", ReturnType<typeof vi.fn>>
	return { task, provider }
}

async function run(params: Record<string, unknown>, taskMode?: string, approve = true) {
	const { task, provider } = makeTask(taskMode)
	const callbacks = {
		askApproval: vi.fn().mockResolvedValue(approve),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		toolCallId: "call-1",
	} as unknown as ToolCallbacks & Record<"askApproval" | "handleError" | "pushToolResult", ReturnType<typeof vi.fn>>
	await new SwitchModeTool().execute(params as any, task, callbacks)
	return { task, provider, callbacks }
}

describe("SwitchModeTool", () => {
	it("reports a missing mode_slug", async () => {
		const { task, callbacks } = await run({ reason: "x" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing mode_slug")
		expect(task.consecutiveMistakeCount).toBe(3)
		expect(task.recordToolError).toHaveBeenCalledWith("switch_mode")
	})

	it.each([
		["an unknown mode", { mode_slug: "nope" }, formatResponse.toolError("Invalid mode: nope")],
		// The task's own mode decides, not the provider's (which holds the focused task's mode).
		["the task's own mode", { mode_slug: "code" }, "Already in 💻 Code mode."],
	])("refuses %s and fails the turn", async (_, params, result) => {
		const { task, provider, callbacks } = await run(params, "code")

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(result)
		expect(task.recordToolError).toHaveBeenCalledWith("switch_mode")
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(provider.handleModeSwitch).not.toHaveBeenCalled()
	})

	it.each([
		[
			"architect",
			"plan first",
			"Successfully switched from 💻 Code mode to 🏗️ Architect mode because: plan first.",
		],
		["reviewer", undefined, "Successfully switched from 💻 Code mode to Reviewer mode."],
	])("switches to %s after approval", async (mode, reason, result) => {
		const { task, provider, callbacks } = await run({ mode_slug: mode, reason }, "code")

		expect(JSON.parse(callbacks.askApproval.mock.calls[0][1])).toEqual({
			tool: "switchMode",
			mode,
			...(reason ? { reason } : {}),
			toolCallId: "call-1",
		})
		expect(provider.handleModeSwitch).toHaveBeenCalledWith(mode)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(result)
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("names a task mode the table does not know by its slug", async () => {
		const { callbacks } = await run({ mode_slug: "ask" }, "retired-mode")

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			"Successfully switched from retired-mode mode to ❓ Ask mode.",
		)
	})

	it("does not switch when the user rejects", async () => {
		const { provider, callbacks } = await run({ mode_slug: "ask" }, "code", false)

		expect(provider.handleModeSwitch).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("hands a failed switch to handleError", async () => {
		const { task, provider } = makeTask()
		const failure = new Error("switch failed")
		provider.handleModeSwitch.mockRejectedValue(failure)
		const callbacks = { askApproval: async () => true, handleError: vi.fn(), pushToolResult: vi.fn() }

		await new SwitchModeTool().execute({ mode_slug: "ask", reason: "" }, task, callbacks as any)

		expect(callbacks.handleError).toHaveBeenCalledWith("switching mode", failure, "switch_mode")
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it.each([
		[
			{ mode_slug: "ask", reason: "why" },
			{ mode: "ask", reason: "why" },
		],
		[{}, { mode: "", reason: "" }],
	])("shows a placeholder for %j while streaming", async (params, shown) => {
		const { task } = makeTask()
		const block = { type: "tool_use", name: "switch_mode", id: "call-2", params, partial: true }

		await new SwitchModeTool().handlePartial(task, block as unknown as ToolUse<"switch_mode">)

		expect(task.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "switchMode", ...shown, toolCallId: "call-2" }),
			true,
		)
	})
})
