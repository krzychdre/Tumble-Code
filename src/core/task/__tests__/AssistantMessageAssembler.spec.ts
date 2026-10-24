// npx vitest run core/task/__tests__/AssistantMessageAssembler.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import type { McpToolUse, ToolUse } from "../../../shared/tools"
import { logger } from "../../../utils/logging"
import { AssistantMessageAssembler, type AssistantMessageAssemblerAccess } from "../AssistantMessageAssembler"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

const NEW_TASK_ERROR =
	"This tool was not executed because new_task was called in the same message turn. The new_task tool must be the last tool in a message."

const tool = (name: string, id: string | undefined, extra: Partial<ToolUse> = {}): ToolUse =>
	({ type: "tool_use", name, id, params: { path: `${name}.txt` }, partial: false, ...extra }) as ToolUse
const mcpTool = (id: string): McpToolUse => ({
	type: "mcp_tool_use",
	id,
	name: "mcp_server_lookup",
	serverName: "server",
	toolName: "lookup",
	arguments: { q: "x" },
	partial: false,
})

function assemble(content: Array<ToolUse | McpToolUse | { type: "text"; content: string; partial: boolean }>) {
	const access = {
		taskId: "task-1",
		clineMessages: [],
		assistantMessageContent: [...content],
		assistantMessageSavedToHistory: false,
		consecutiveNoAssistantMessagesCount: 2,
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		askSay: { say: vi.fn().mockResolvedValue(undefined) },
		history: { addToApiConversationHistory: vi.fn().mockResolvedValue(undefined) },
	}
	const assembler = new AssistantMessageAssembler(access as unknown as AssistantMessageAssemblerAccess)
	/** The assistant content blocks saved to history. */
	const saved = () =>
		access.history.addToApiConversationHistory.mock.calls[0]?.[0].content as Anthropic.ContentBlockParam[]
	return { access, assembler, saved }
}

const draft = (text = "", extra: { reasoning?: string; groundingSources?: { title: string; url: string }[] } = {}) => ({
	text,
	reasoning: extra.reasoning ?? "",
	groundingSources: extra.groundingSources ?? [],
})

describe("AssistantMessageAssembler.assembleAndSave", () => {
	beforeEach(() => vi.clearAllMocks())
	afterEach(() => vi.restoreAllMocks())

	it("saves nothing and keeps the empty-answer streak for a turn without text or tools", async () => {
		const { access, assembler } = assemble([{ type: "text", content: "", partial: false }])

		await assembler.assembleAndSave(draft(""))

		expect(access.history.addToApiConversationHistory).not.toHaveBeenCalled()
		expect(access.consecutiveNoAssistantMessagesCount).toBe(2)
		expect(access.assistantMessageSavedToHistory).toBe(false)
	})

	it("saves the text and tool calls before the tools run, with reasoning, and resets the empty-answer streak", async () => {
		const { access, assembler, saved } = assemble([
			tool("read_file", "call.1", { nativeArgs: { path: "a.ts" } as never }),
			tool("edit", "call_2", { originalName: "edit_file" }),
			mcpTool("call_3"),
		])

		await assembler.assembleAndSave(draft("Let me look", { reasoning: "thinking" }))

		expect(saved()).toEqual([
			{ type: "text", text: "Let me look" },
			// Sanitized id; nativeArgs win over params.
			{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
			// The alias the model called stays in history.
			{ type: "tool_use", id: "call_2", name: "edit_file", input: { path: "edit.txt" } },
			{ type: "tool_use", id: "call_3", name: "mcp_server_lookup", input: { q: "x" } },
		])
		expect(access.history.addToApiConversationHistory.mock.calls[0][1]).toBe("thinking")
		expect(access.assistantMessageSavedToHistory).toBe(true)
		expect(access.consecutiveNoAssistantMessagesCount).toBe(0)
		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.TASK_CONVERSATION_MESSAGE, {
			taskId: "task-1",
			source: "assistant",
		})
	})

	it("drops a repeated tool call id (API 400 'tool_use ids must be unique') and calls without an id", async () => {
		vi.spyOn(logger, "warn").mockImplementation(() => {})
		const { assembler, saved } = assemble([
			tool("read_file", "toolu_abc"),
			tool("read_file", "toolu_abc"),
			tool("read_file", "toolu:abc"),
			tool("list_files", undefined),
			mcpTool("mcp_1"),
			mcpTool("mcp_1"),
		])

		await assembler.assembleAndSave(draft())

		expect(saved().map((b) => (b as Anthropic.ToolUseBlockParam).id)).toEqual(["toolu_abc", "mcp_1"])
	})

	it("shows the grounding sources as citation links", async () => {
		const { access, assembler } = assemble([])

		await assembler.assembleAndSave(
			draft("answer", {
				groundingSources: [
					{ title: "A", url: "https://a.example" },
					{ title: "B", url: "https://b.example" },
				],
			}),
		)

		expect(access.askSay.say).toHaveBeenCalledWith(
			"text",
			expect.stringMatching(/\[1\]\(https:\/\/a\.example\), \[2\]\(https:\/\/b\.example\)$/),
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	describe("new_task isolation", () => {
		it.each([
			["new_task is the only tool", [tool("new_task", "nt")]],
			["new_task is the last tool", [tool("read_file", "r1"), tool("new_task", "nt")]],
			["there is no new_task", [tool("read_file", "r1"), tool("list_files", "l1")]],
		])("keeps every call when %s", async (_label, calls) => {
			const { access, assembler, saved } = assemble(calls)

			await assembler.assembleAndSave(draft("text"))

			expect(saved()).toHaveLength(calls.length + 1)
			expect(access.assistantMessageContent).toHaveLength(calls.length)
			expect(access.pushToolResultToUserContent).not.toHaveBeenCalled()
		})

		it("cuts a single call right after new_task", async () => {
			const { access, assembler, saved } = assemble([tool("new_task", "nt"), tool("read_file", "r1")])

			await assembler.assembleAndSave(draft())

			expect(saved().map((b) => (b as Anthropic.ToolUseBlockParam).id)).toEqual(["nt"])
			expect(access.pushToolResultToUserContent).toHaveBeenCalledWith(
				expect.objectContaining({ tool_use_id: "r1" }),
			)
		})

		it("cuts every call after the first new_task from history and execution, and answers each with an error", async () => {
			const { access, assembler, saved } = assemble([
				{ type: "text", content: "delegating", partial: false },
				tool("read_file", "r1"),
				tool("new_task", "nt1"),
				tool("list_files", "l1"),
				tool("new_task", "nt2"),
			])

			await assembler.assembleAndSave(draft("delegating"))

			expect(saved().map((b) => (b.type === "tool_use" ? b.id : b.type))).toEqual(["text", "r1", "nt1"])
			expect(access.assistantMessageContent.map((b) => b.type)).toEqual(["text", "tool_use", "tool_use"])
			expect(access.pushToolResultToUserContent.mock.calls.map(([result]) => result)).toEqual(
				["l1", "nt2"].map((id) => ({
					type: "tool_result",
					tool_use_id: id,
					content: NEW_TASK_ERROR,
					is_error: true,
				})),
			)
		})
	})
})
