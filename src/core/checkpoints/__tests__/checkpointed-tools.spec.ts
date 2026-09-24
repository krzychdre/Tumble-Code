// cd src && ./node_modules/.bin/vitest run core/checkpoints/__tests__/checkpointed-tools.spec.ts

// Two places decide that a tool gets a pre-tool checkpoint:
//  1. presentAssistantMessage, which saves the checkpoint right before the tool runs
//     (the call site that actually protects the workspace), and
//  2. TaskStreamProcessor, which starts the same checkpoint early, at tool_call_start,
//     so it overlaps the streaming of the tool's arguments.
// They used to keep two hand-written lists that drifted apart (DEF-C7): `new_task` and
// `generate_image` were checkpointed by (1) but never started early by (2). This spec
// measures both behaviours for every known tool name and requires them to agree, so a
// tool added to one place and not the other fails here.

import { describe, it, expect, vi } from "vitest"

import { toolNames, type ToolName } from "@roo-code/types"

import { presentAssistantMessage } from "../../assistant-message/presentAssistantMessage"
import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../../task/TaskStreamProcessor"

const handles = vi.hoisted(() => {
	const stub = () => ({ handle: vi.fn().mockResolvedValue(undefined) })
	return {
		listFilesTool: stub(),
		readFileTool: stub(),
		readArtifactTool: stub(),
		searchTaskHistoryTool: stub(),
		writeToFileTool: stub(),
		editTool: stub(),
		searchReplaceTool: stub(),
		editFileTool: stub(),
		applyPatchTool: stub(),
		searchFilesTool: stub(),
		executeCommandTool: stub(),
		useMcpToolTool: stub(),
		accessMcpResourceTool: stub(),
		askFollowupQuestionTool: stub(),
		switchModeTool: stub(),
		attemptCompletionTool: stub(),
		newTaskTool: stub(),
		runParallelTasksTool: stub(),
		updateTodoListTool: stub(),
		runSlashCommandTool: stub(),
		skillTool: stub(),
		toolsLoadTool: stub(),
		generateImageTool: stub(),
		applyDiffTool: stub(),
		codebaseSearchTool: stub(),
		webSearchTool: stub(),
		webFetchTool: stub(),
	}
})

// Every tool is a no-op: only the checkpoint decision around it is under test.
vi.mock("../../tools/ListFilesTool", () => ({ listFilesTool: handles.listFilesTool }))
vi.mock("../../tools/ReadFileTool", () => ({ readFileTool: handles.readFileTool }))
vi.mock("../../tools/ReadArtifactTool", () => ({ readArtifactTool: handles.readArtifactTool }))
vi.mock("../../tools/SearchTaskHistoryTool", () => ({ searchTaskHistoryTool: handles.searchTaskHistoryTool }))
vi.mock("../../tools/WriteToFileTool", () => ({ writeToFileTool: handles.writeToFileTool }))
vi.mock("../../tools/EditTool", () => ({ editTool: handles.editTool }))
vi.mock("../../tools/SearchReplaceTool", () => ({ searchReplaceTool: handles.searchReplaceTool }))
vi.mock("../../tools/EditFileTool", () => ({ editFileTool: handles.editFileTool }))
vi.mock("../../tools/ApplyPatchTool", () => ({ applyPatchTool: handles.applyPatchTool }))
vi.mock("../../tools/SearchFilesTool", () => ({ searchFilesTool: handles.searchFilesTool }))
vi.mock("../../tools/ExecuteCommandTool", () => ({ executeCommandTool: handles.executeCommandTool }))
vi.mock("../../tools/UseMcpToolTool", () => ({ useMcpToolTool: handles.useMcpToolTool }))
vi.mock("../../tools/accessMcpResourceTool", () => ({ accessMcpResourceTool: handles.accessMcpResourceTool }))
vi.mock("../../tools/AskFollowupQuestionTool", () => ({ askFollowupQuestionTool: handles.askFollowupQuestionTool }))
vi.mock("../../tools/SwitchModeTool", () => ({ switchModeTool: handles.switchModeTool }))
vi.mock("../../tools/AttemptCompletionTool", () => ({ attemptCompletionTool: handles.attemptCompletionTool }))
vi.mock("../../tools/NewTaskTool", () => ({ newTaskTool: handles.newTaskTool }))
vi.mock("../../tools/RunParallelTasksTool", () => ({ runParallelTasksTool: handles.runParallelTasksTool }))
vi.mock("../../tools/UpdateTodoListTool", () => ({ updateTodoListTool: handles.updateTodoListTool }))
vi.mock("../../tools/RunSlashCommandTool", () => ({ runSlashCommandTool: handles.runSlashCommandTool }))
vi.mock("../../tools/SkillTool", () => ({ skillTool: handles.skillTool }))
vi.mock("../../tools/ToolsLoadTool", () => ({ toolsLoadTool: handles.toolsLoadTool }))
vi.mock("../../tools/GenerateImageTool", () => ({ generateImageTool: handles.generateImageTool }))
vi.mock("../../tools/ApplyDiffTool", () => ({ applyDiffTool: handles.applyDiffTool }))
vi.mock("../../tools/CodebaseSearchTool", () => ({ codebaseSearchTool: handles.codebaseSearchTool }))
vi.mock("../../tools/WebSearchTool", () => ({ webSearchTool: handles.webSearchTool }))
vi.mock("../../tools/WebFetchTool", () => ({ webFetchTool: handles.webFetchTool }))

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
// TaskStreamProcessor presents each streamed block; only its eager-checkpoint
// kickoff is measured here, so presenting is a no-op for that half.
vi.mock("../../assistant-message", () => ({
	presentAssistantMessage: vi.fn(),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
			captureLlmCompletion: vi.fn(),
		},
	},
}))

// The owner's decision (refactor plan, decision 9): every workspace-writing tool plus
// `new_task` and `generate_image`.
const EXPECTED_CHECKPOINTED_TOOLS: ToolName[] = [
	"write_to_file",
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	"new_task",
	"generate_image",
]

function makePresentTask(toolName: string) {
	const task: any = {
		taskId: "test-task-id",
		instanceId: "test-instance",
		abort: false,
		abandoned: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: false,
		pendingCheckpointSave: undefined,
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		assistantMessageContent: [
			{
				type: "tool_use",
				id: `call_${toolName}`,
				name: toolName,
				params: {},
				nativeArgs: {},
				partial: false,
			},
		],
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
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }),
			}),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
	}
	return task
}

/** Tools for which presentAssistantMessage saves a checkpoint before running them. */
async function toolsCheckpointedAtExecution(): Promise<string[]> {
	const result: string[] = []
	for (const name of toolNames) {
		const task = makePresentTask(name)
		await presentAssistantMessage(task)
		if (task.checkpointSave.mock.calls.length > 0) {
			result.push(name)
		}
	}
	return result.sort()
}

function makeStreamAccess(
	assistantMessageContent: TaskStreamProcessorAccess["assistantMessageContent"] = [],
): TaskStreamProcessorAccess {
	return {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "anthropic" } as any,
		clineMessages: [],
		assistantMessageContent,
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
	} as unknown as TaskStreamProcessorAccess
}

function makeStreamTask() {
	return {
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		pendingCheckpointSave: undefined as Promise<void> | undefined,
	}
}

function startToolCall(name: string, id = "call_1") {
	return { type: "tool_call_partial", index: 0, id, name, arguments: "" }
}

/** Tools for which TaskStreamProcessor starts the checkpoint early, at tool_call_start. */
function toolsCheckpointedEagerly(): string[] {
	const result: string[] = []
	for (const name of toolNames) {
		const task = makeStreamTask()
		const processor = new TaskStreamProcessor(makeStreamAccess(), task as any)
		processor.processChunk(startToolCall(name) as any, {} as any)
		if (task.checkpointSave.mock.calls.length > 0) {
			result.push(name)
		}
	}
	return result.sort()
}

describe("checkpointed tool set (DEF-C7)", () => {
	it("presentAssistantMessage checkpoints exactly the decided tools", async () => {
		expect(await toolsCheckpointedAtExecution()).toEqual([...EXPECTED_CHECKPOINTED_TOOLS].sort())
	})

	it("TaskStreamProcessor starts the early checkpoint for exactly the tools checkpointed at execution", async () => {
		expect(toolsCheckpointedEagerly()).toEqual(await toolsCheckpointedAtExecution())
	})

	it("starts the early checkpoint for new_task and generate_image", () => {
		for (const name of ["new_task", "generate_image"]) {
			const task = makeStreamTask()
			const processor = new TaskStreamProcessor(makeStreamAccess(), task as any)
			processor.processChunk(startToolCall(name) as any, {} as any)
			expect(task.checkpointSave, name).toHaveBeenCalledWith(true)
			expect(task.pendingCheckpointSave, name).toBeDefined()
		}
	})

	it("does not treat the removed list_code_definition_names tool as a known read-only tool", () => {
		// An earlier block the processor does not recognise as read-only must keep the
		// early checkpoint off (it falls back to the save at execution time).
		const task = makeStreamTask()
		const earlier = { type: "tool_use", name: "list_code_definition_names", params: {}, partial: false } as any
		const processor = new TaskStreamProcessor(makeStreamAccess([earlier]), task as any)
		processor.processChunk(startToolCall("write_to_file", "call_2") as any, {} as any)
		expect(task.checkpointSave).not.toHaveBeenCalled()
	})
})
