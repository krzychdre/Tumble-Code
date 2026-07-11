// Test for TL-1: finish_reason chunk handling in TaskStreamProcessor.
//
// Providers now yield { type: "finish_reason", finishReason } instead of
// calling NativeToolCallParser.processFinishReason directly. TaskStreamProcessor
// must handle this chunk type, call the per-task parser's processFinishReason,
// and process the resulting tool_call_end events to finalize tool calls.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../TaskStreamProcessor"
import type { ToolName } from "@roo-code/types"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureLlmCompletion: vi.fn(),
			captureConversationMessage: vi.fn(),
		},
	},
}))

vi.mock("../../assistant-message", () => ({
	presentAssistantMessage: vi.fn(),
}))

import { presentAssistantMessage } from "../../assistant-message"

function makeAccess(overrides: Partial<TaskStreamProcessorAccess> = {}): TaskStreamProcessorAccess {
	return {
		taskId: "task-finish-reason-test",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "openrouter" } as any,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		assistantMessageContent: [],
		didCompleteReadingStream: false,
		userMessageContent: [],
		userMessageContentReady: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		didToolFailInCurrentTurn: false,
		assistantMessageSavedToHistory: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		streamingToolCallIndices: new Map<string, number>(),
		isStreaming: false,
		isWaitingForFirstChunk: false,
		clineMessages: [],
		didFinishAbortingStream: false,
		consecutiveNoAssistantMessagesCount: 0,
		api: { getModel: () => ({ id: "test-model", info: { maxTokens: 8192, contextWindow: 200000 } }) } as any,
		askSay: { say: vi.fn() } as any,
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
			addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		} as any,
		providerRef: { deref: () => ({ postStateToWebviewWithoutTaskHistory: vi.fn() }) } as any,
		emit: vi.fn(),
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		diffViewProvider: { reset: vi.fn().mockResolvedValue(undefined), isEditing: false } as any,
		...overrides,
	} as unknown as TaskStreamProcessorAccess
}

function makeModelInfo() {
	return {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	} as any
}

describe("TaskStreamProcessor finish_reason chunk handling (TL-1)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("finish_reason chunk after tool_call_partial finalizes the started tool call", () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)
		const modelInfo = makeModelInfo()

		// Step 1: Send a tool_call_partial chunk with id + name + partial arguments
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_test_001",
				name: "read_file",
				arguments: '{"path":"src/test.ts"}',
			},
			modelInfo,
		)

		// The tool_call_start event should have created a partial tool_use in assistantMessageContent
		expect(access.assistantMessageContent).toHaveLength(1)
		const toolUse = access.assistantMessageContent[0] as any
		expect(toolUse.type).toBe("tool_use")
		expect(toolUse.name).toBe("read_file")
		expect(toolUse.partial).toBe(true)
		expect(toolUse.id).toBe("call_test_001")
		expect(access.streamingToolCallIndices.get("call_test_001")).toBe(0)

		// Step 2: Send a finish_reason chunk (even "stop" should finalize via finalizeStream,
		// but "tool_calls" directly emits tool_call_end events)
		processor.processChunk(
			{
				type: "finish_reason",
				finishReason: "tool_calls",
			},
			modelInfo,
		)

		// The finish_reason → processFinishReason → tool_call_end → finalizeStreamingToolCall
		// should have finalized the tool call
		const finalizedToolUse = access.assistantMessageContent[0] as any
		expect(finalizedToolUse.type).toBe("tool_use")
		expect(finalizedToolUse.partial).toBe(false)
		// streamingToolCallIndices should be cleaned up
		expect(access.streamingToolCallIndices.has("call_test_001")).toBe(false)

		// presentAssistantMessage should have been called (for start + finalize)
		expect(presentAssistantMessage).toHaveBeenCalled()
	})

	it("finish_reason 'stop' does not emit tool_call_end (processFinishReason only acts on 'tool_calls')", () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)
		const modelInfo = makeModelInfo()

		// Start a tool call
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_test_002",
				name: "write_to_file",
				arguments: '{"path":"out.ts","content":"x"}',
			},
			modelInfo,
		)

		expect(access.assistantMessageContent).toHaveLength(1)
		expect(access.streamingToolCallIndices.has("call_test_002")).toBe(true)

		// Send finish_reason "stop" — processFinishReason returns no events for non-"tool_calls"
		processor.processChunk(
			{
				type: "finish_reason",
				finishReason: "stop",
			},
			modelInfo,
		)

		// Tool call should still be partial (not finalized by finish_reason "stop")
		const toolUse = access.assistantMessageContent[0] as any
		expect(toolUse.partial).toBe(true)
		expect(access.streamingToolCallIndices.has("call_test_002")).toBe(true)
	})
})
