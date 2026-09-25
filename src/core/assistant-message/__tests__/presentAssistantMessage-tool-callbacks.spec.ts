// npx vitest run src/core/assistant-message/__tests__/presentAssistantMessage-tool-callbacks.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { formatResponse } from "../../prompts/responses"
import { presentAssistantMessage } from "../presentAssistantMessage"

/**
 * Characterization of the tool callbacks (`askApproval`, `pushToolResult`, `handleError`)
 * that `presentAssistantMessage` hands to a tool, pinned for BOTH block kinds that build
 * them: a native `tool_use` block and a dynamic MCP `mcp_tool_use` block. The two kinds
 * used to build the callbacks in two hand-copied clones; these tests pin that both kinds
 * behave the same, so one shared factory can replace the clones without anyone noticing.
 *
 * Both kinds end up in `useMcpToolTool.handle` (the `tool_use` block is literally a
 * `use_mcp_tool` call, the `mcp_tool_use` block is rewritten to one), so a single mock
 * decides what "the tool" does with the callbacks it receives.
 */

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

const useMcpToolHandle = vi.fn()

vi.mock("../../tools/UseMcpToolTool", () => ({
	useMcpToolTool: {
		handle: (...args: unknown[]) => useMcpToolHandle(...args),
	},
}))

const FEEDBACK_IMAGE = "data:image/png;base64,ZmVlZGJhY2s="
const TOOL_IMAGE_BLOCK = {
	type: "image" as const,
	source: { type: "base64" as const, media_type: "image/png" as const, data: "dG9vbA==" },
}

type BlockKind = "tool_use" | "mcp_tool_use"

function makeBlock(kind: BlockKind, id: string | undefined) {
	if (kind === "tool_use") {
		return {
			type: "tool_use",
			id,
			name: "use_mcp_tool",
			params: { server_name: "srv", tool_name: "echo", arguments: "{}" },
			nativeArgs: { server_name: "srv", tool_name: "echo", arguments: {} },
			partial: false,
		}
	}
	return {
		type: "mcp_tool_use",
		id,
		name: "mcp--srv--echo",
		serverName: "srv",
		toolName: "echo",
		arguments: {},
		partial: false,
	}
}

describe.each<BlockKind>(["tool_use", "mcp_tool_use"])("tool callbacks for a %s block", (kind) => {
	const toolCallId = `call_${kind}`
	let mockTask: any

	beforeEach(() => {
		useMcpToolHandle.mockReset()

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			abandoned: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [makeBlock(kind, toolCallId)],
			userMessageContent: [],
			didCompleteReadingStream: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			consecutiveMistakeCount: 0,
			consecutiveMistakeLimit: 3,
			clineMessages: [],
			apiConfiguration: { apiProvider: "openai" },
			api: { getModel: () => ({ id: "test-model", info: {} }) },
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			getTaskMode: vi.fn().mockResolvedValue("code"),
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }),
					getMcpHub: () => undefined,
				}),
			},
			askSay: {
				ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
				say: vi.fn().mockResolvedValue(undefined),
			},
		}

		// Records every push, duplicates included, so the tests see what the callbacks sent.
		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	function toolResults() {
		return mockTask.userMessageContent.filter((item: any) => item.type === "tool_result")
	}

	it("merges approval feedback text and images into the one tool result, feedback images first", async () => {
		mockTask.askSay.ask.mockResolvedValue({
			response: "yesButtonClicked",
			text: "use the staging server",
			images: [FEEDBACK_IMAGE],
		})
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			expect(await callbacks.askApproval("use_mcp_server", "{}")).toBe(true)
			callbacks.pushToolResult([{ type: "text", text: "tool output" }, TOOL_IMAGE_BLOCK])
		})

		await presentAssistantMessage(mockTask)

		expect(mockTask.askSay.say).toHaveBeenCalledWith("user_feedback", "use the staging server", [FEEDBACK_IMAGE])
		expect(toolResults()).toEqual([
			{
				type: "tool_result",
				tool_use_id: toolCallId,
				content: `${formatResponse.toolApprovedWithFeedback("use the staging server")}\n\ntool output`,
			},
		])
		expect(mockTask.pushToolResultToUserContent).toHaveBeenCalledWith(expect.anything(), {
			toolName: "use_mcp_tool",
		})
		const images = mockTask.userMessageContent.filter((item: any) => item.type === "image")
		expect(images).toEqual([...formatResponse.imageBlocks([FEEDBACK_IMAGE]), TOOL_IMAGE_BLOCK])
		expect(mockTask.didRejectTool).toBe(false)
	})

	it("reports an empty result as '(tool did not return anything)'", async () => {
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			callbacks.pushToolResult("")
		})

		await presentAssistantMessage(mockTask)

		expect(toolResults()).toEqual([
			{ type: "tool_result", tool_use_id: toolCallId, content: "(tool did not return anything)" },
		])
	})

	it("delivers only the first result for a block and warns about the duplicate", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			callbacks.pushToolResult("first")
			callbacks.pushToolResult("second")
		})

		await presentAssistantMessage(mockTask)

		expect(toolResults()).toEqual([{ type: "tool_result", tool_use_id: toolCallId, content: "first" }])
		const label = kind === "mcp_tool_use" ? "mcp_tool_use" : "tool_use_id"
		expect(warn).toHaveBeenCalledWith(
			`[presentAssistantMessage] Skipping duplicate tool_result for ${label}: ${toolCallId}`,
		)
	})

	it("turns a denial with feedback into a denied result carrying the feedback images", async () => {
		mockTask.askSay.ask.mockResolvedValue({
			response: "noButtonClicked",
			text: "not now",
			images: [FEEDBACK_IMAGE],
		})
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			expect(await callbacks.askApproval("use_mcp_server", "{}")).toBe(false)
		})

		await presentAssistantMessage(mockTask)

		expect(mockTask.didRejectTool).toBe(true)
		expect(toolResults()).toEqual([
			{ type: "tool_result", tool_use_id: toolCallId, content: formatResponse.toolDeniedWithFeedback("not now") },
		])
		const images = mockTask.userMessageContent.filter((item: any) => item.type === "image")
		expect(images).toEqual(formatResponse.imageBlocks([FEEDBACK_IMAGE]))
	})

	it("turns a plain denial into the standard denied result", async () => {
		mockTask.askSay.ask.mockResolvedValue({ response: "noButtonClicked" })
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			await callbacks.askApproval("use_mcp_server", "{}")
		})

		await presentAssistantMessage(mockTask)

		expect(mockTask.didRejectTool).toBe(true)
		expect(toolResults()).toEqual([
			{ type: "tool_result", tool_use_id: toolCallId, content: formatResponse.toolDenied() },
		])
	})

	it("counts a runtime failure before the result as a mistake and reports it", async () => {
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			await callbacks.handleError("calling the MCP tool", new Error("boom"), "use_mcp_tool")
		})

		await presentAssistantMessage(mockTask)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("use_mcp_tool", "boom")
		expect(mockTask.askSay.say).toHaveBeenCalledWith("error", "Error calling the MCP tool:\nboom")
		const results = toolResults()
		expect(results).toHaveLength(1)
		expect(results[0].content).toContain("boom")
	})

	it("does not count a failure that happens after the result was delivered (trailing cleanup)", async () => {
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			callbacks.pushToolResult("ok")
			await callbacks.handleError("cleaning up", new Error("late"), "use_mcp_tool")
		})

		await presentAssistantMessage(mockTask)

		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(mockTask.recordToolError).not.toHaveBeenCalled()
		expect(toolResults()).toEqual([{ type: "tool_result", tool_use_id: toolCallId, content: "ok" }])
	})
})

describe("an mcp_tool_use block without an id", () => {
	it("runs the tool but pushes no tool_result (there is no tool_use_id to answer)", async () => {
		useMcpToolHandle.mockReset()
		useMcpToolHandle.mockImplementation(async (_task: any, _block: any, callbacks: any) => {
			callbacks.pushToolResult("result nobody can pair")
		})
		const mockTask: any = {
			taskId: "t",
			instanceId: "i",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [makeBlock("mcp_tool_use", undefined)],
			userMessageContent: [],
			didCompleteReadingStream: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			consecutiveMistakeCount: 0,
			recordToolUsage: vi.fn(),
			providerRef: { deref: () => ({ getState: vi.fn().mockResolvedValue({}), getMcpHub: () => undefined }) },
			askSay: { ask: vi.fn(), say: vi.fn() },
			pushToolResultToUserContent: vi.fn(),
		}

		await presentAssistantMessage(mockTask)

		expect(useMcpToolHandle).toHaveBeenCalledTimes(1)
		expect(mockTask.pushToolResultToUserContent).not.toHaveBeenCalled()
		expect(mockTask.userMessageContent).toEqual([])
	})
})
