// Test for TE-8: orphaned tool_call_end silently drops the tool call.
//
// When a duplicate tool_call_start is deduped (guard in handleToolCallEvents),
// the parser's rawChunkTracker still has TWO entries with the same id. On
// finish_reason / finalizeRawChunks, TWO tool_call_end events are emitted for
// that id. The first end is handled normally; the second end finds
// finalizeStreamingToolCall returns null (parser entry already consumed) AND
// streamingToolCallIndices.get(id) returns undefined (already deleted by the
// first end). Pre-fix, neither branch runs and the event is silently swallowed.
// Post-fix, the handler must either repair a still-partial content block or
// log an explicit warning — never silently drop.

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
		taskId: "task-orphaned-end-test",
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

describe("TaskStreamProcessor orphaned tool_call_end handling (TE-8)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("duplicate tool_call_start deduped, then finish_reason emits two tool_call_end events — second end must not be silently swallowed", () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)
		const modelInfo = makeModelInfo()

		// Step 1: Send a tool_call_partial chunk with id + name + valid arguments.
		// This creates a rawChunkTracker entry at index=0 with id="call_dup_001".
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_dup_001",
				name: "read_file",
				arguments: '{"path":"src/test.ts"}',
			},
			modelInfo,
		)

		// The tool_call_start event should have created a partial tool_use at index 0.
		expect(access.assistantMessageContent).toHaveLength(1)
		const toolUse = access.assistantMessageContent[0] as any
		expect(toolUse.type).toBe("tool_use")
		expect(toolUse.partial).toBe(true)
		expect(toolUse.id).toBe("call_dup_001")
		expect(access.streamingToolCallIndices.get("call_dup_001")).toBe(0)

		// Step 2: Send a DUPLICATE tool_call_partial with a DIFFERENT index but the
		// SAME id. The rawChunkTracker creates a new entry at index=1 with the same
		// id. processRawChunk emits another tool_call_start for "call_dup_001".
		// The dedup guard in handleToolCallEvents catches it (streamingToolCallIndices
		// already has "call_dup_001") and logs a warning, ignoring the duplicate start.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 1,
				id: "call_dup_001",
				name: "read_file",
				arguments: '{"path":"other.ts"}',
			},
			modelInfo,
		)
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Ignoring duplicate tool_call_start for ID: call_dup_001"),
		)
		warnSpy.mockRestore()

		// No second tool_use block should have been added.
		expect(access.assistantMessageContent).toHaveLength(1)

		// Step 3: Send finish_reason. The parser's processFinishReason iterates BOTH
		// rawChunkTracker entries (index=0 and index=1), emitting TWO tool_call_end
		// events for "call_dup_001".
		processor.processChunk(
			{
				type: "finish_reason",
				finishReason: "tool_calls",
			},
			modelInfo,
		)

		// Post-fix assertions:
		// 1. The tool_use block should be finalized (partial=false) — either by the
		//    first end (which found the index) or by the second end (which found a
		//    still-partial block by scanning assistantMessageContent).
		const finalizedBlock = access.assistantMessageContent[0] as any
		expect(finalizedBlock.type).toBe("tool_use")
		expect(finalizedBlock.partial).toBe(false)

		// 2. streamingToolCallIndices should be cleaned up.
		expect(access.streamingToolCallIndices.has("call_dup_001")).toBe(false)

		// 3. presentAssistantMessage should have been called (at least for the start
		//    and the first end; the second end may or may not call it depending on
		//    whether the block was already non-partial).
		expect(presentAssistantMessage).toHaveBeenCalled()
	})

	it("orphaned tool_call_end with malformed args — block must be marked non-partial, not left partial forever", () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)
		const modelInfo = makeModelInfo()

		// Start a tool call with truncated/malformed JSON arguments so that
		// finalizeStreamingToolCall returns null (JSON.parse fails).
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_bad_args",
				name: "read_file",
				arguments: '{"path":', // truncated JSON — will fail JSON.parse
			},
			modelInfo,
		)

		expect(access.assistantMessageContent).toHaveLength(1)
		expect((access.assistantMessageContent[0] as any).partial).toBe(true)

		// Send a DUPLICATE start (different index, same id) — gets deduped.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 1,
				id: "call_bad_args",
				name: "read_file",
				arguments: '{"path":"other.ts"}',
			},
			modelInfo,
		)
		warnSpy.mockRestore()

		// finish_reason → two tool_call_end events for "call_bad_args".
		// First end: finalizeStreamingToolCall returns null (bad JSON),
		//   toolUseIndex=0 (defined) → existing branch marks partial=false.
		// Second end: finalizeStreamingToolCall returns null (parser entry gone),
		//   toolUseIndex=undefined → TE-8 fix must not silently swallow.
		processor.processChunk(
			{
				type: "finish_reason",
				finishReason: "tool_calls",
			},
			modelInfo,
		)

		// The block must be non-partial (either the first or second end repaired it).
		const block = access.assistantMessageContent[0] as any
		expect(block.partial).toBe(false)

		// Tracking must be clean.
		expect(access.streamingToolCallIndices.has("call_bad_args")).toBe(false)
	})

	it("orphaned tool_call_end with no content block at all — must log explicit error, not silently swallow", () => {
		const access = makeAccess()
		const processor = new TaskStreamProcessor(access, {} as any)
		const modelInfo = makeModelInfo()

		// This scenario is not reachable through normal parser event flow (the parser
		// only emits tool_call_end for started tool calls, and a start always creates
		// a content block). But we verify the safety net: if somehow an end arrives
		// for an id with no tracking and no content block, an error is logged.
		//
		// We simulate by starting a tool call, then manually clearing the external
		// tracking and content (as if a first end already processed and cleaned up),
		// while the parser's internal streamingToolCalls entry is also already
		// consumed (so finalizeStreamingToolCall returns null). We use malformed
		// arguments so the parser returns null on finalize.

		// Start a tool call with malformed JSON arguments.
		processor.processChunk(
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_orphan",
				name: "read_file",
				arguments: '{"path":', // truncated JSON — will fail JSON.parse
			},
			modelInfo,
		)

		// Manually clear streamingToolCallIndices and content (simulates the first
		// end having already been processed and cleaned up).
		access.streamingToolCallIndices.clear()
		access.assistantMessageContent.length = 0

		// Also manually consume the parser's streamingToolCalls entry so
		// finalizeStreamingToolCall returns null (simulating a prior finalize).
		// We do this by calling finalizeStreamingToolCall directly.
		processor["toolCallParser"].finalizeStreamingToolCall("call_orphan")

		// Now finish_reason will emit tool_call_end for "call_orphan", but
		// streamingToolCallIndices is empty, assistantMessageContent is empty,
		// and finalizeStreamingToolCall returns null.
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		processor.processChunk(
			{
				type: "finish_reason",
				finishReason: "tool_calls",
			},
			modelInfo,
		)

		// Post-fix: an error must be logged (not silently swallowed).
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("call_orphan"))
		errorSpy.mockRestore()
	})
})
