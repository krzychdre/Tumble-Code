// cd src && ./node_modules/.bin/vitest run core/assistant-message/__tests__/presentAssistantMessage-steps.spec.ts

// Characterization of the steps presentAssistantMessage runs for one block, for the paths the
// other presentAssistantMessage-*.spec files do not reach: the text block, a rejected MCP call,
// the deferred-tool answers, the validation failure, the legacy read_file telemetry, the
// repetition stop and the order of the steps before a tool handler runs.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { presentAssistantMessage } from "../presentAssistantMessage"
import { getToolHandler } from "../toolHandlers"
import { isValidToolName, validateToolUse } from "../../tools/validateToolUse"
import { tryAutoMaterializeDirectCall } from "../../task/deferred-tools-resolver"

vi.mock("../../task/Task")
vi.mock("../toolHandlers", () => ({ getToolHandler: vi.fn() }))
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("../../task/deferred-tools-resolver", () => ({ tryAutoMaterializeDirectCall: vi.fn(() => null) }))
vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: { capture: vi.fn(), captureEvent: vi.fn(), captureException: vi.fn() },
	},
}))

let log: string[]
let task: any
let experiments: Record<string, boolean>

function makeTask() {
	const t: any = {
		taskId: "task-1",
		instanceId: "i-1",
		cwd: "/ws",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [],
		userMessageContent: [],
		didCompleteReadingStream: true,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		consecutiveMistakeLimit: 3,
		currentStreamingDidCheckpoint: false,
		apiConfiguration: { apiProvider: "anthropic" },
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		recordToolUsage: vi.fn((name: string) => void log.push(`recordToolUsage:${name}`)),
		recordToolError: vi.fn(),
		toolRepetitionDetector: {
			check: vi.fn(() => {
				log.push("repetitionCheck")
				return { allowExecution: true }
			}),
		},
		checkpointSave: vi.fn(async () => void log.push("checkpointSave")),
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: {
			deref: () => ({
				getState: vi.fn(async () => ({ mode: "code", customModes: [], experiments })),
				getMcpHub: () => undefined,
			}),
		},
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
	}
	t.pushToolResultToUserContent = vi.fn((result: any) => {
		log.push("pushToolResult")
		t.userMessageContent.push(result)
		return true
	})
	return t
}

const toolResult = () => task.userMessageContent.find((b: any) => b.type === "tool_result")

beforeEach(() => {
	vi.clearAllMocks()
	log = []
	experiments = {}
	task = makeTask()
	vi.mocked(isValidToolName).mockReturnValue(true)
	vi.mocked(validateToolUse).mockImplementation(() => void log.push("validateToolUse"))
	vi.mocked(tryAutoMaterializeDirectCall).mockReturnValue(null)
	vi.mocked(getToolHandler).mockReturnValue(undefined)
})

describe("text block", () => {
	it("strips streamed <thinking> tags and says the text with its partial flag", async () => {
		task.assistantMessageContent = [{ type: "text", content: "<thinking> plan </thinking> answer", partial: true }]

		await presentAssistantMessage(task)

		expect(task.askSay.say).toHaveBeenCalledWith("text", "plan answer", undefined, true)
		// A partial block stays current.
		expect(task.currentStreamingContentIndex).toBe(0)
	})

	it("is skipped after a tool already ran in this message", async () => {
		task.didAlreadyUseTool = true
		task.assistantMessageContent = [{ type: "text", content: "more", partial: false }]

		await presentAssistantMessage(task)

		expect(task.askSay.say).not.toHaveBeenCalled()
		expect(task.currentStreamingContentIndex).toBe(1)
		expect(task.userMessageContentReady).toBe(true)
	})
})

describe("mcp_tool_use after a rejected tool", () => {
	it.each([
		[false, "Skipping MCP tool mcp_srv_t due to user rejecting a previous tool."],
		[true, "MCP tool mcp_srv_t was interrupted and not executed due to user rejecting a previous tool."],
	])("partial=%s answers with an error result", async (partial, message) => {
		task.didRejectTool = true
		task.assistantMessageContent = [
			{ type: "mcp_tool_use", id: "call-1", name: "mcp_srv_t", serverName: "srv", toolName: "t", partial },
		]

		await presentAssistantMessage(task)

		expect(toolResult()).toEqual({ type: "tool_result", tool_use_id: "call-1", content: message, is_error: true })
	})
})

describe("tool_use steps", () => {
	const block = (overrides: Record<string, unknown> = {}) => ({
		type: "tool_use",
		id: "call-1",
		name: "write_to_file",
		params: { path: "a.ts", content: "x" },
		nativeArgs: { path: "a.ts", content: "x" },
		partial: false,
		...overrides,
	})

	it("runs usage, validation, repetition check and checkpoint before the handler, in that order", async () => {
		const handle = vi.fn(async () => void log.push("handle"))
		vi.mocked(getToolHandler).mockReturnValue({ handle } as any)
		task.assistantMessageContent = [block()]

		await presentAssistantMessage(task)

		expect(log).toEqual([
			"recordToolUsage:write_to_file",
			"validateToolUse",
			"repetitionCheck",
			"checkpointSave",
			"handle",
		])
		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.TOOL_USED, {
			taskId: "task-1",
			tool: "write_to_file",
		})
		expect(task.currentStreamingDidCheckpoint).toBe(true)
	})

	it("runs only the handler for a partial block", async () => {
		const handle = vi.fn(async () => void log.push("handle"))
		vi.mocked(getToolHandler).mockReturnValue({ handle } as any)
		task.assistantMessageContent = [block({ partial: true })]

		await presentAssistantMessage(task)

		// The checkpoint step does not look at `partial`.
		expect(log).toEqual(["checkpointSave", "handle"])
		expect(task.currentStreamingContentIndex).toBe(0)
	})

	it("answers a deferred tool called without arguments with the resolver's guidance", async () => {
		experiments = { deferredTools: true }
		vi.mocked(tryAutoMaterializeDirectCall).mockReturnValue({ kind: "guidance", payload: "GUIDANCE" } as any)
		task.assistantMessageContent = [block({ nativeArgs: undefined })]

		await presentAssistantMessage(task)

		expect(toolResult()).toEqual({ type: "tool_result", tool_use_id: "call-1", content: "GUIDANCE" })
		expect(task.recordToolUsage).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("records usage, then answers a failed validation with an error result for a valid tool name", async () => {
		vi.mocked(validateToolUse).mockImplementation(() => {
			throw new Error("not allowed in this mode")
		})
		task.assistantMessageContent = [block()]

		await presentAssistantMessage(task)

		expect(task.recordToolUsage).toHaveBeenCalledWith("write_to_file")
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.recordToolError).toHaveBeenCalledWith("write_to_file", "not allowed in this mode")
		expect(toolResult().is_error).toBe(true)
		expect(toolResult().content).toContain("not allowed in this mode")
		expect(task.toolRepetitionDetector.check).not.toHaveBeenCalled()
		expect(task.checkpointSave).not.toHaveBeenCalled()
		expect(task.didAlreadyUseTool).toBe(false)
	})

	it("does not record an invalid tool name after a failed validation", async () => {
		vi.mocked(isValidToolName).mockReturnValue(false)
		vi.mocked(validateToolUse).mockImplementation(() => {
			throw new Error("unknown tool")
		})
		task.assistantMessageContent = [block({ name: "made_up_tool" })]

		await presentAssistantMessage(task)

		expect(task.recordToolError).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(toolResult().is_error).toBe(true)
	})

	it("reports a legacy read_file call to telemetry", async () => {
		task.assistantMessageContent = [
			block({ name: "read_file", params: {}, nativeArgs: { files: [] }, usedLegacyFormat: true }),
		]

		await presentAssistantMessage(task)

		expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
			TelemetryEventName.READ_FILE_LEGACY_FORMAT_USED,
			{ taskId: "task-1", model: "test-model" },
		)
	})

	it("stops a repeated call with the user's feedback and an error result", async () => {
		const handle = vi.fn()
		vi.mocked(getToolHandler).mockReturnValue({ handle } as any)
		task.toolRepetitionDetector.check.mockReturnValue({
			allowExecution: false,
			askUser: { messageKey: "mistake_limit_reached", messageDetail: "Repeated {toolName}" },
		})
		task.askSay.ask.mockResolvedValue({ response: "messageResponse", text: "try else", images: undefined })
		task.assistantMessageContent = [block()]

		await presentAssistantMessage(task)

		expect(task.askSay.ask).toHaveBeenCalledWith("mistake_limit_reached", "Repeated write_to_file")
		expect(task.userMessageContent[0]).toEqual({
			type: "text",
			text: "Tool repetition limit reached. User feedback: try else",
		})
		expect(task.askSay.say).toHaveBeenCalledWith("user_feedback", "try else", undefined)
		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR, {
			taskId: "task-1",
		})
		expect(TelemetryService.instance.captureException).toHaveBeenCalledTimes(1)
		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({
				tool_use_id: "call-1",
				content: expect.stringContaining("Tool call repetition limit reached for write_to_file"),
			}),
			{ toolName: "write_to_file" },
		)
		expect(task.checkpointSave).not.toHaveBeenCalled()
		expect(handle).not.toHaveBeenCalled()
	})

	it("tells the model a deferred tool it called directly is available next turn", async () => {
		experiments = { deferredTools: true }
		vi.mocked(tryAutoMaterializeDirectCall).mockReturnValue({ kind: "ready" } as any)
		task.assistantMessageContent = [block({ name: "deferred_tool" })]

		await presentAssistantMessage(task)

		expect(toolResult()).toEqual({
			type: "tool_result",
			tool_use_id: "call-1",
			content:
				"Tool `deferred_tool` was deferred but is now available. Its full schema will be in your tools list next turn \u2014 retry it then.",
		})
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("lets a partial block of an unknown tool stream without a result", async () => {
		task.assistantMessageContent = [block({ name: "made_up_tool", partial: true })]

		await presentAssistantMessage(task)

		expect(task.userMessageContent).toEqual([])
		expect(task.currentStreamingContentIndex).toBe(0)
	})
})
