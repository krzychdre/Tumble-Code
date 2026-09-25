// cd src && ./node_modules/.bin/vitest run core/assistant-message/__tests__/presentAssistantMessage-dispatch-table.spec.ts

// Characterization of how presentAssistantMessage dispatches a native tool call, measured for
// EVERY dispatchable tool name (CORE-R4 a+b):
//   1. which tool handler runs,
//   2. whether a checkpoint is saved before it runs,
//   3. the one-line description the task uses for it (the "Skipping tool [...]" result when the
//      user rejected an earlier tool, and the `toolDescription` callback of attempt_completion).
// The expectations are today's behaviour, written out by hand, so the move from a switch
// statement to a descriptor table can be proven neutral: this file must not change.

import { describe, it, expect, vi, beforeEach } from "vitest"

import { toolNames, type ToolName } from "@roo-code/types"

import { getModeBySlug, defaultModeSlug } from "../../../shared/modes"
import { presentAssistantMessage } from "../presentAssistantMessage"

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

type HandlerKey = keyof typeof handles

vi.mock("../../tools/ListFilesTool", () => ({ listFilesTool: handles.listFilesTool }))
vi.mock("../../tools/ReadFileTool", async (importOriginal) => {
	// The real read_file description helper is kept: the description is part of what is pinned.
	const actual = await importOriginal<typeof import("../../tools/ReadFileTool")>()
	handles.readFileTool = Object.assign(Object.create(Object.getPrototypeOf(actual.readFileTool)), {
		handle: handles.readFileTool.handle,
	})
	return { ...actual, readFileTool: handles.readFileTool }
})
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
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

interface DispatchCase {
	handler: HandlerKey
	checkpoint: boolean
	params?: Record<string, unknown>
	nativeArgs?: Record<string, unknown>
	description: string
}

const architectName = getModeBySlug("architect")!.name

// Today's dispatch, one row per dispatchable tool name. `custom_tool` is not a name a model
// calls (custom tools are called by their own registered names), so it is not dispatched.
const DISPATCH: Record<Exclude<ToolName, "custom_tool">, DispatchCase> = {
	execute_command: {
		handler: "executeCommandTool",
		checkpoint: false,
		params: { command: "ls -la" },
		description: "[execute_command for 'ls -la']",
	},
	read_file: {
		handler: "readFileTool",
		checkpoint: false,
		nativeArgs: { path: "src/a.ts" },
		description: "[read_file for 'src/a.ts']",
	},
	read_artifact: {
		handler: "readArtifactTool",
		checkpoint: false,
		params: { artifact_id: "cmd-1" },
		description: "[read_artifact for 'cmd-1']",
	},
	read_command_output: {
		handler: "readArtifactTool",
		checkpoint: false,
		params: { artifact_id: "cmd-2" },
		description: "[read_command_output for 'cmd-2']",
	},
	write_to_file: {
		handler: "writeToFileTool",
		checkpoint: true,
		params: { path: "out.txt" },
		description: "[write_to_file for 'out.txt']",
	},
	apply_diff: {
		handler: "applyDiffTool",
		checkpoint: true,
		params: { path: "src/b.ts" },
		description: "[apply_diff for 'src/b.ts']",
	},
	edit: {
		handler: "editTool",
		checkpoint: true,
		params: { file_path: "src/c.ts" },
		description: "[edit for 'src/c.ts']",
	},
	search_and_replace: {
		handler: "editTool",
		checkpoint: true,
		params: { file_path: "src/d.ts" },
		description: "[search_and_replace for 'src/d.ts']",
	},
	search_replace: {
		handler: "searchReplaceTool",
		checkpoint: true,
		params: { file_path: "src/e.ts" },
		description: "[search_replace for 'src/e.ts']",
	},
	edit_file: {
		handler: "editFileTool",
		checkpoint: true,
		params: { file_path: "src/f.ts" },
		description: "[edit_file for 'src/f.ts']",
	},
	apply_patch: {
		handler: "applyPatchTool",
		checkpoint: true,
		params: { patch: "*** Begin Patch" },
		description: "[apply_patch]",
	},
	search_files: {
		handler: "searchFilesTool",
		checkpoint: false,
		params: { regex: "TODO", file_pattern: "*.ts" },
		description: "[search_files for 'TODO' in '*.ts']",
	},
	search_task_history: {
		handler: "searchTaskHistoryTool",
		checkpoint: false,
		params: { query: "auth bug" },
		description: "[search_task_history for 'auth bug']",
	},
	list_files: {
		handler: "listFilesTool",
		checkpoint: false,
		params: { path: "src" },
		description: "[list_files for 'src']",
	},
	use_mcp_tool: {
		handler: "useMcpToolTool",
		checkpoint: false,
		params: { server_name: "srv", tool_name: "echo" },
		description: "[use_mcp_tool for 'srv']",
	},
	access_mcp_resource: {
		handler: "accessMcpResourceTool",
		checkpoint: false,
		params: { server_name: "docs", uri: "doc://x" },
		description: "[access_mcp_resource for 'docs']",
	},
	ask_followup_question: {
		handler: "askFollowupQuestionTool",
		checkpoint: false,
		params: { question: "Which one?" },
		description: "[ask_followup_question for 'Which one?']",
	},
	attempt_completion: {
		handler: "attemptCompletionTool",
		checkpoint: false,
		params: { result: "done" },
		description: "[attempt_completion]",
	},
	switch_mode: {
		handler: "switchModeTool",
		checkpoint: false,
		params: { mode_slug: "code", reason: "time to build" },
		description: "[switch_mode to 'code' because: time to build]",
	},
	new_task: {
		handler: "newTaskTool",
		checkpoint: true,
		params: { mode: "architect", message: "plan it" },
		description: `[new_task in ${architectName} mode: 'plan it']`,
	},
	codebase_search: {
		handler: "codebaseSearchTool",
		checkpoint: false,
		params: { query: "login flow" },
		description: "[codebase_search for 'login flow']",
	},
	update_todo_list: {
		handler: "updateTodoListTool",
		checkpoint: false,
		params: { todos: "[ ] a" },
		description: "[update_todo_list]",
	},
	run_slash_command: {
		handler: "runSlashCommandTool",
		checkpoint: false,
		params: { command: "init", args: "fast" },
		description: "[run_slash_command for 'init' with args: fast]",
	},
	skill: {
		handler: "skillTool",
		checkpoint: false,
		params: { skill: "deploy", args: "prod" },
		description: "[skill for 'deploy' with args: prod]",
	},
	generate_image: {
		handler: "generateImageTool",
		checkpoint: true,
		params: { path: "img/cat.png", prompt: "a cat" },
		description: "[generate_image for 'img/cat.png']",
	},
	tools_load: {
		handler: "toolsLoadTool",
		checkpoint: false,
		nativeArgs: { names: ["alpha", "beta"] },
		description: "[tools_load for alpha, beta]",
	},
	run_parallel_tasks: {
		handler: "runParallelTasksTool",
		checkpoint: false,
		nativeArgs: { subtasks: [{}, {}, {}] },
		description: "[run_parallel_tasks: 3 subtask(s)]",
	},
	web_search: {
		handler: "webSearchTool",
		checkpoint: false,
		nativeArgs: { queries: ["x", "y"] },
		description: "[web_search for 'x', 'y']",
	},
	web_fetch: {
		handler: "webFetchTool",
		checkpoint: false,
		nativeArgs: { url: "https://example.com" },
		description: "[web_fetch for 'https://example.com']",
	},
}

// Descriptions for argument shapes the table above does not cover: missing optional parts
// and fallbacks.
const EXTRA_DESCRIPTIONS: Array<{
	name: string
	params?: Record<string, unknown>
	nativeArgs?: Record<string, unknown>
	description: string
}> = [
	{ name: "read_file", params: { path: "legacy.ts" }, description: "[read_file for 'legacy.ts']" },
	{ name: "read_file", nativeArgs: {}, description: "[read_file with missing path]" },
	{ name: "apply_diff", params: {}, description: "[apply_diff]" },
	{ name: "search_files", params: { regex: "x" }, description: "[search_files for 'x']" },
	{ name: "switch_mode", params: { mode_slug: "ask" }, description: "[switch_mode to 'ask']" },
	{ name: "run_slash_command", params: { command: "init" }, description: "[run_slash_command for 'init']" },
	{ name: "skill", params: { skill: "deploy" }, description: "[skill for 'deploy']" },
	{
		name: "new_task",
		params: {},
		description: `[new_task in ${getModeBySlug(defaultModeSlug)!.name} mode: '(no message)']`,
	},
	{ name: "new_task", params: { mode: "my-mode", message: "m" }, description: "[new_task in My Mode mode: 'm']" },
	{ name: "new_task", params: { mode: "nope", message: "m" }, description: "[new_task in nope mode: 'm']" },
	{ name: "tools_load", nativeArgs: {}, description: "[tools_load for (no names)]" },
	{ name: "run_parallel_tasks", nativeArgs: {}, description: "[run_parallel_tasks: 0 subtask(s)]" },
	{ name: "web_search", nativeArgs: { queries: [] }, description: "[web_search]" },
	{ name: "web_fetch", nativeArgs: {}, description: "[web_fetch]" },
	{ name: "not_a_tool", params: {}, description: "[not_a_tool]" },
]

const CUSTOM_MODES = [{ slug: "my-mode", name: "My Mode", roleDefinition: "r", groups: [] }]

function makeTask(block: Record<string, unknown>, opts: { didRejectTool?: boolean } = {}) {
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
		assistantMessageContent: [block],
		userMessageContent: [],
		didCompleteReadingStream: false,
		didRejectTool: opts.didRejectTool ?? false,
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
				getState: vi.fn().mockResolvedValue({ mode: "code", customModes: CUSTOM_MODES }),
			}),
		},
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
	}
	return task
}

function makeBlock(name: string, row: { params?: Record<string, unknown>; nativeArgs?: Record<string, unknown> }) {
	return {
		type: "tool_use",
		id: `call_${name}`,
		name,
		params: row.params ?? {},
		nativeArgs: row.nativeArgs ?? row.params ?? {},
		partial: false,
	}
}

/** The description the task uses for a block: read back from the rejected-tool result. */
async function describeBlock(block: Record<string, unknown>): Promise<string> {
	const task = makeTask(block, { didRejectTool: true })
	await presentAssistantMessage(task)
	const content: string = task.pushToolResultToUserContent.mock.calls[0][0].content
	const match = /^Skipping tool (.*) due to user rejecting a previous tool\.$/s.exec(content)
	expect(match, content).not.toBeNull()
	return match![1]
}

function calledHandlers(): HandlerKey[] {
	return (Object.keys(handles) as HandlerKey[]).filter((key) => handles[key].handle.mock.calls.length > 0)
}

const dispatchable = toolNames.filter((name): name is Exclude<ToolName, "custom_tool"> => name !== "custom_tool")

describe("presentAssistantMessage dispatch table (CORE-R4)", () => {
	beforeEach(() => {
		for (const key of Object.keys(handles) as HandlerKey[]) {
			handles[key].handle.mockClear()
		}
	})

	it("covers every dispatchable tool name", () => {
		expect(Object.keys(DISPATCH).sort()).toEqual([...dispatchable].sort())
	})

	it.each(dispatchable)("%s runs its handler once with the block and the task callbacks", async (name) => {
		const row = DISPATCH[name]
		const block = makeBlock(name, row)
		const task = makeTask(block)

		await presentAssistantMessage(task)

		expect(calledHandlers()).toEqual([row.handler])
		const handle = handles[row.handler].handle
		expect(handle).toHaveBeenCalledTimes(1)
		const [calledTask, calledBlock, callbacks] = handle.mock.calls[0]
		expect(calledTask).toBe(task)
		expect(calledBlock).toMatchObject({ id: `call_${name}`, name })
		expect(typeof callbacks.askApproval).toBe("function")
		expect(typeof callbacks.handleError).toBe("function")
		expect(typeof callbacks.pushToolResult).toBe("function")
		// When a tool gets a call id, it is the block's id (never another one).
		if (callbacks.toolCallId !== undefined) {
			expect(callbacks.toolCallId).toBe(`call_${name}`)
		}
	})

	it.each(dispatchable)("%s saves a checkpoint before it runs only when it is a checkpointed tool", async (name) => {
		const row = DISPATCH[name]
		const task = makeTask(makeBlock(name, row))
		const order: string[] = []
		task.checkpointSave.mockImplementation(async () => {
			order.push("checkpoint")
		})
		handles[row.handler].handle.mockImplementationOnce(async () => {
			order.push("tool")
		})

		await presentAssistantMessage(task)

		expect(order).toEqual(row.checkpoint ? ["checkpoint", "tool"] : ["tool"])
	})

	it.each(dispatchable)("%s is described the same way as before", async (name) => {
		const row = DISPATCH[name]
		expect(await describeBlock(makeBlock(name, row))).toBe(row.description)
	})

	it.each(EXTRA_DESCRIPTIONS)("describes $name with $description", async (row) => {
		expect(await describeBlock(makeBlock(row.name, row))).toBe(row.description)
	})

	it("hands attempt_completion the sub-task approval and its own description", async () => {
		const task = makeTask(makeBlock("attempt_completion", DISPATCH.attempt_completion))

		await presentAssistantMessage(task)

		const callbacks = handles.attemptCompletionTool.handle.mock.calls[0][2]
		expect(typeof callbacks.askFinishSubTaskApproval).toBe("function")
		expect(callbacks.toolDescription()).toBe("[attempt_completion]")
	})

	it("never checkpoints or dispatches a partial block before it is complete for a non-handler name", async () => {
		const task = makeTask({ ...makeBlock("not_a_tool", {}), partial: true })

		await presentAssistantMessage(task)

		expect(calledHandlers()).toEqual([])
		expect(task.checkpointSave).not.toHaveBeenCalled()
		expect(task.pushToolResultToUserContent).not.toHaveBeenCalled()
	})

	// Model-supplied names are arbitrary strings. Names that exist on every JavaScript object
	// must still be treated as unknown tools, not looked up as handlers.
	it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "not_a_tool"])(
		"answers %s with the unknown-tool error and runs no handler",
		async (name) => {
			const task = makeTask(makeBlock(name, {}))

			await presentAssistantMessage(task)

			expect(calledHandlers()).toEqual([])
			expect(task.checkpointSave).not.toHaveBeenCalled()
			expect(task.pushToolResultToUserContent).toHaveBeenCalledTimes(1)
			const result = task.pushToolResultToUserContent.mock.calls[0][0]
			expect(result.tool_use_id).toBe(`call_${name}`)
			expect(result.is_error).toBe(true)
			expect(JSON.parse(result.content).error).toContain(`Unknown tool "${name}"`)
		},
	)
})
