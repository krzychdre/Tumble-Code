// SkillTool with the real approval message and result formatting; the task, its provider and the
// SkillsManager (tested in services/skills) are replaced.

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import { skillTool } from "../SkillTool"
import { formatResponse } from "../../prompts/responses"

const skill = {
	name: "create-mcp-server",
	description: "Instructions for creating MCP servers",
	source: "global",
	instructions: "Step 1: Create the server...",
}

function setup({ skillsManager = true, content = skill as typeof skill | null, approve = true } = {}) {
	const manager = {
		getSkillContent: vi.fn().mockResolvedValue(content),
		getSkillsForMode: vi.fn().mockReturnValue([{ name: "a" }, { name: "b" }]),
	}
	const task = {
		consecutiveMistakeCount: 2,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing skill"),
		ask: vi.fn().mockResolvedValue({}),
		getTaskMode: vi.fn().mockResolvedValue("architect"),
		providerRef: { deref: () => ({ getSkillsManager: () => (skillsManager ? manager : undefined) }) },
	}
	const callbacks = {
		askApproval: vi.fn().mockResolvedValue(approve),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		toolCallId: "call-1",
	}
	const run = (nativeArgs: Record<string, unknown>, partial = false) =>
		skillTool.handle(
			task as unknown as Task,
			{
				type: "tool_use",
				name: "skill",
				id: "call-1",
				params: nativeArgs,
				partial,
				nativeArgs,
			} as ToolUse<"skill">,
			callbacks,
		)
	return { manager, task, callbacks, run }
}

describe("skillTool", () => {
	it("reports a missing skill name and fails the turn", async () => {
		const { task, callbacks, run } = setup()

		await run({ skill: "" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing skill")
		expect(task.consecutiveMistakeCount).toBe(3)
		expect(task.didToolFailInCurrentTurn).toBe(true)
	})

	it.each([
		["no skills manager", { skillsManager: false }, "Skills Manager not available"],
		[
			"an unknown skill, listing the mode's skills",
			{ content: null },
			"Skill 'nope' not found. Available skills: a, b",
		],
	])("refuses with %s", async (_, options, error) => {
		const { task, callbacks, run } = setup(options)

		await run({ skill: "nope" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(formatResponse.toolError(error))
		expect(task.recordToolError).toHaveBeenCalledWith("skill")
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(callbacks.askApproval).not.toHaveBeenCalled()
	})

	it("lists (none) when the mode has no skills", async () => {
		const { manager, callbacks, run } = setup({ content: null })
		manager.getSkillsForMode.mockReturnValue([])

		await run({ skill: "nope" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolError("Skill 'nope' not found. Available skills: (none)"),
		)
	})

	it.each([
		[undefined, ""],
		["--fast", "\nProvided arguments: --fast"],
	])("loads the skill of the task's own mode with args %j after approval", async (args, argsLine) => {
		const { manager, task, callbacks, run } = setup()

		await run({ skill: "create-mcp-server", args })

		// The task's mode, not the provider's: a background subagent may run in another mode.
		expect(manager.getSkillContent).toHaveBeenCalledWith("create-mcp-server", "architect")
		expect(JSON.parse(callbacks.askApproval.mock.calls[0][1])).toEqual({
			tool: "skill",
			skill: "create-mcp-server",
			...(args ? { args } : {}),
			source: "global",
			description: skill.description,
			toolCallId: "call-1",
		})
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			`Skill: create-mcp-server\nDescription: ${skill.description}${argsLine}\nSource: global\n\n--- Skill Instructions ---\n\n${skill.instructions}`,
		)
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("returns nothing when the user rejects", async () => {
		const { callbacks, run } = setup({ approve: false })

		await run({ skill: "create-mcp-server" })

		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("hands a failed lookup to handleError", async () => {
		const { manager, callbacks, run } = setup()
		const failure = new Error("unreadable SKILL.md")
		manager.getSkillContent.mockRejectedValue(failure)

		await run({ skill: "create-mcp-server" })

		expect(callbacks.handleError).toHaveBeenCalledWith("executing skill", failure, "skill")
	})

	it("shows the skill and its args while streaming", async () => {
		const { task, run } = setup()

		await run({ skill: "create-mcp", args: "--f" }, true)

		expect(task.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "skill", skill: "create-mcp", args: "--f", toolCallId: "call-1" }),
			true,
		)
	})
})
