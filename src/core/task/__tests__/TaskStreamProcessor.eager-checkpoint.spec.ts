// Eager pre-edit checkpoint: when a write tool's call starts streaming, the
// checkpoint begins immediately so it overlaps argument streaming instead of
// blocking tool execution in checkpointSaveAndMark. See
// ai_plans/2026-07-12_glm-agent-loop-efficiency-implementation.md (WS-3).

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../TaskStreamProcessor"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureLlmCompletion: vi.fn(),
		},
	},
}))

// presentAssistantMessage drives the full tool pipeline; the eager checkpoint
// fires before it, so a no-op keeps these tests focused on the kickoff logic.
vi.mock("../../assistant-message", () => ({
	presentAssistantMessage: vi.fn(),
}))

function makeAccess(overrides: Partial<TaskStreamProcessorAccess> = {}): TaskStreamProcessorAccess {
	return {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "anthropic" } as any,
		clineMessages: [],
		assistantMessageContent: [],
		streamingToolCallIndices: new Map<string, number>(),
		currentStreamingDidCheckpoint: false,
		userMessageContent: [],
		userMessageContentReady: false,
		didFinishAbortingStream: false,
		api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) } as any,
		diffViewProvider: { reset: vi.fn().mockResolvedValue(undefined) } as any,
		askSay: { say: vi.fn().mockResolvedValue(undefined) } as any,
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		} as any,
		...overrides,
	} as unknown as TaskStreamProcessorAccess
}

function makeTask() {
	return {
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		pendingCheckpointSave: undefined as Promise<void> | undefined,
	}
}

function startToolCallChunk(name: string, id = "call_1") {
	return { type: "tool_call_partial", index: 0, id, name, arguments: "" }
}

describe("TaskStreamProcessor eager pre-edit checkpoint", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("starts the checkpoint when a write tool call starts streaming", () => {
		const access = makeAccess()
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("apply_diff"), {} as any)

		expect(task.checkpointSave).toHaveBeenCalledTimes(1)
		expect(task.checkpointSave).toHaveBeenCalledWith(true)
		expect(task.pendingCheckpointSave).toBeDefined()
	})

	it("does not checkpoint for read-only tools", () => {
		const access = makeAccess()
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("read_file"), {} as any)

		expect(task.checkpointSave).not.toHaveBeenCalled()
		expect(task.pendingCheckpointSave).toBeUndefined()
	})

	it("skips the eager path when an earlier tool this turn may mutate the workspace", () => {
		const access = makeAccess({
			assistantMessageContent: [{ type: "tool_use", name: "execute_command", params: {}, partial: false } as any],
		})
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("apply_diff"), {} as any)

		expect(task.checkpointSave).not.toHaveBeenCalled()
	})

	it("still fires when earlier tools are workspace-read-only", () => {
		const access = makeAccess({
			assistantMessageContent: [
				{ type: "text", content: "reading", partial: false } as any,
				{ type: "tool_use", name: "read_file", params: {}, partial: false } as any,
			],
		})
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("write_to_file"), {} as any)

		expect(task.checkpointSave).toHaveBeenCalledTimes(1)
	})

	it("does not start a second checkpoint when one is already pending or done", () => {
		const access = makeAccess()
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("apply_diff", "call_1"), {} as any)
		processor.processChunk(startToolCallChunk("edit_file", "call_2"), {} as any)

		expect(task.checkpointSave).toHaveBeenCalledTimes(1)
	})

	it("clears a stale pending checkpoint on resetStreamingState", async () => {
		const access = makeAccess()
		const task = makeTask()
		const processor = new TaskStreamProcessor(access, task as any)

		processor.processChunk(startToolCallChunk("apply_diff"), {} as any)
		expect(task.pendingCheckpointSave).toBeDefined()

		await processor.resetStreamingState()
		expect(task.pendingCheckpointSave).toBeUndefined()
	})
})
