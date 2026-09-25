// cd src && ./node_modules/.bin/vitest run core/tools/__tests__/tool-policy-lists.spec.ts

// Pins every per-tool policy list to today's members (CORE-R4 a). The lists used to be typed
// out by hand in six files; the descriptor table derives them now, and this spec proves the
// derivation changed no membership. A deliberate change to a policy edits the expected list
// here together with the table.

import { describe, it, expect, vi } from "vitest"

import { toolNames } from "@roo-code/types"

import { PROTOCOL_TOOL_NAMES } from "../../../shared/tools"
import { CHECKPOINTED_TOOLS } from "../../checkpoints/checkpointedTools"
import { COMPACTABLE_TOOL_NAMES } from "../../context-management/microcompact"
import { SPILL_BYPASS_TOOLS } from "../../artifacts/spillPolicy"
import { SLIM_TOOLSET_ALLOWLIST, SLIM_TOOLSET_ALLOWSET } from "../../prompts/tools/filter-tools-for-mode"
import { FILE_MUTATION_TOOLS, FILE_READ_TOOLS } from "../../context-management/ledger/classify"
import { TaskStreamProcessor, type TaskStreamProcessorAccess } from "../../task/TaskStreamProcessor"

vi.mock("../../task/Task")
// Only the eager-checkpoint decision of the stream processor is measured here.
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

const sorted = (values: Iterable<string>) => [...values].sort()

const PROTOCOL = [
	"attempt_completion",
	"ask_followup_question",
	"update_todo_list",
	"switch_mode",
	"new_task",
	"run_parallel_tasks",
	"skill",
	"run_slash_command",
	"tools_load",
	"generate_image",
]

describe("per-tool policy lists (CORE-R4)", () => {
	it("checkpointed tools", () => {
		expect(sorted(CHECKPOINTED_TOOLS)).toEqual(
			sorted([
				"write_to_file",
				"apply_diff",
				"edit",
				"search_and_replace",
				"search_replace",
				"edit_file",
				"apply_patch",
				"new_task",
				"generate_image",
			]),
		)
	})

	it("workspace read-only tools (an earlier block that keeps the eager checkpoint allowed)", () => {
		const readOnly: string[] = []
		for (const name of toolNames) {
			const task = {
				checkpointSave: vi.fn().mockResolvedValue(undefined),
				pendingCheckpointSave: undefined as Promise<void> | undefined,
			}
			const earlier = { type: "tool_use", id: "call_0", name, params: {}, partial: false }
			const access = {
				taskId: "task-1",
				instanceId: "inst-1",
				abort: false,
				abandoned: false,
				apiConfiguration: { apiProvider: "anthropic" },
				clineMessages: [],
				assistantMessageContent: [earlier],
				streamingToolCallIndices: new Map<string, number>(),
				currentStreamingDidCheckpoint: false,
				userMessageContent: [],
				userMessageContentReady: false,
				didFinishAbortingStream: false,
				api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) },
				diffViewProvider: { reset: vi.fn().mockResolvedValue(undefined) },
				askSay: { say: vi.fn().mockResolvedValue(undefined) },
				history: {
					saveClineMessages: vi.fn().mockResolvedValue(undefined),
					updateClineMessage: vi.fn().mockResolvedValue(undefined),
				},
			} as unknown as TaskStreamProcessorAccess
			const processor = new TaskStreamProcessor(access, task as any)
			processor.processChunk(
				{ type: "tool_call_partial", index: 0, id: "call_1", name: "write_to_file", arguments: "" } as any,
				{} as any,
			)
			if (task.checkpointSave.mock.calls.length > 0) {
				readOnly.push(name)
			}
		}
		expect(sorted(readOnly)).toEqual(
			sorted([
				"read_file",
				"list_files",
				"search_files",
				"codebase_search",
				"read_artifact",
				"read_command_output",
				"web_search",
				"web_fetch",
				"search_task_history",
			]),
		)
	})

	it("compactable tools (microcompact)", () => {
		expect(sorted(COMPACTABLE_TOOL_NAMES)).toEqual(
			sorted([
				"read_file",
				"read_artifact",
				"read_command_output",
				"execute_command",
				"search_files",
				"list_files",
				"codebase_search",
				"use_mcp_tool",
				"access_mcp_resource",
				"write_to_file",
				"apply_diff",
				"apply_patch",
				"edit",
				"edit_file",
				"search_replace",
				"search_and_replace",
				"web_search",
				"web_fetch",
				"search_task_history",
			]),
		)
	})

	it("protocol tools", () => {
		expect(sorted(PROTOCOL_TOOL_NAMES)).toEqual(sorted(PROTOCOL))
	})

	it("spill-exempt tools (spillPolicy)", () => {
		expect(sorted(SPILL_BYPASS_TOOLS)).toEqual(
			sorted([
				...PROTOCOL,
				"read_file",
				"read_artifact",
				"read_command_output",
				"access_mcp_resource",
				"search_task_history",
			]),
		)
	})

	it("slim toolset", () => {
		const slim = [
			"read_file",
			"search_files",
			"list_files",
			"codebase_search",
			"apply_diff",
			"write_to_file",
			"execute_command",
			"read_artifact",
			"read_command_output",
			"web_search",
			"web_fetch",
			"ask_followup_question",
			"attempt_completion",
			"switch_mode",
			"new_task",
			"update_todo_list",
			"skill",
			"tools_load",
		]
		expect(sorted(SLIM_TOOLSET_ALLOWLIST)).toEqual(sorted(slim))
		// The lookup set adds the aliases whose target is allowed.
		expect(sorted(SLIM_TOOLSET_ALLOWSET)).toEqual(sorted([...slim, "write_file"]))
	})

	it("ledger file-mutation and file-read tools", () => {
		expect(sorted(FILE_MUTATION_TOOLS)).toEqual(
			sorted([
				"write_to_file",
				"apply_diff",
				"apply_patch",
				"edit",
				"edit_file",
				"search_replace",
				"search_and_replace",
				// Removed tool, still found in older histories.
				"insert_content",
			]),
		)
		expect(sorted(FILE_READ_TOOLS)).toEqual(sorted(["read_file", "list_files", "search_files", "codebase_search"]))
	})
})
