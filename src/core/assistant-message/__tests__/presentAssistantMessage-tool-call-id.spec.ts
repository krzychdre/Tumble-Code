// cd src && ./node_modules/.bin/vitest run core/assistant-message/__tests__/presentAssistantMessage-tool-call-id.spec.ts

// Since the dispatch became a table lookup (CORE-R4 b), every built-in tool gets the same
// callbacks, including the call id. Before, seven tools were handed no `toolCallId`; none of
// them reads it, so the change is invisible to them, and a tool that starts using it later
// no longer needs a dispatcher edit.

import { describe, it, expect, vi } from "vitest"

import { presentAssistantMessage } from "../presentAssistantMessage"

const handles = vi.hoisted(() => {
	const stub = () => ({ handle: vi.fn().mockResolvedValue(undefined) })
	return {
		execute_command: stub(),
		read_artifact: stub(),
		use_mcp_tool: stub(),
		access_mcp_resource: stub(),
		ask_followup_question: stub(),
		generate_image: stub(),
		attempt_completion: stub(),
	}
})

vi.mock("../../tools/ExecuteCommandTool", () => ({ executeCommandTool: handles.execute_command }))
vi.mock("../../tools/ReadArtifactTool", () => ({ readArtifactTool: handles.read_artifact }))
vi.mock("../../tools/UseMcpToolTool", () => ({ useMcpToolTool: handles.use_mcp_tool }))
vi.mock("../../tools/accessMcpResourceTool", () => ({ accessMcpResourceTool: handles.access_mcp_resource }))
vi.mock("../../tools/AskFollowupQuestionTool", () => ({ askFollowupQuestionTool: handles.ask_followup_question }))
vi.mock("../../tools/GenerateImageTool", () => ({ generateImageTool: handles.generate_image }))
vi.mock("../../tools/AttemptCompletionTool", () => ({ attemptCompletionTool: handles.attempt_completion }))

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

function makeTask(name: string) {
	return {
		taskId: "t",
		instanceId: "i",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		assistantMessageContent: [
			{ type: "tool_use", id: `call_${name}`, name, params: {}, nativeArgs: {}, partial: false },
		],
		userMessageContent: [],
		didCompleteReadingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		apiConfiguration: { apiProvider: "openai" },
		api: { getModel: () => ({ id: "m", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: { deref: () => ({ getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }) }) },
		askSay: { ask: vi.fn(), say: vi.fn().mockResolvedValue(undefined) },
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
	} as any
}

describe("toolCallId for every built-in tool (CORE-R4)", () => {
	it.each(Object.keys(handles) as Array<keyof typeof handles>)(
		"%s now receives the block's call id",
		async (name) => {
			await presentAssistantMessage(makeTask(name))

			expect(handles[name].handle).toHaveBeenCalledTimes(1)
			expect(handles[name].handle.mock.calls[0][2].toolCallId).toBe(`call_${name}`)
		},
	)
})
