import type { ClineSayTool, ModeConfig, ToolName } from "@roo-code/types"

import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import type { ToolParamName } from "../../shared/tools"

/**
 * One row per tool the model can call: every per-tool policy in one place.
 *
 * Before this table, adding a tool meant finding and editing about seven hand-written
 * lists (checkpoints, eager checkpoints, microcompact, spill policy, slim toolset, ledger,
 * the description switch) and they drifted (DEF-C7). Each of those lists is now derived
 * from this table, and the table is keyed by `DispatchableToolName`, so a tool added to
 * `toolNames` in `@roo-code/types` does not compile until it has a row here.
 *
 * What is deliberately NOT here:
 * - the tool implementation (`src/core/assistant-message/toolHandlers.ts`): the lists
 *   below are read by leaf modules (microcompact, spill policy, the prompt filter) that
 *   must not import every tool and, through them, VS Code and the Task class;
 * - argument parsing (CORE-R4 part c, a later item).
 *
 * Nothing here is sent to a model: tool names, schemas and descriptions are unchanged.
 */

/** Every tool name a model call can dispatch. `custom_tool` is only a usage-statistics bucket. */
export type DispatchableToolName = Exclude<ToolName, "custom_tool">

/** The parts of a tool_use block a description reads. */
export interface DescribableToolBlock {
	name: string
	params: Partial<Record<ToolParamName, string>>
	nativeArgs?: unknown
}

export interface ToolDescriptionContext {
	/** Custom modes of the current state, to name the mode of a `new_task`. */
	customModes?: ModeConfig[]
}

/**
 * How auto-approval (`src/core/auto-approval`) treats the approval ask a tool raises.
 * The categories answered from a "tool" ask need the actions (`ClineSayTool["tool"]`)
 * the tool sends, listed in `approvalActions`; the others are answered from the ask type.
 */
export type ToolApprovalCategory =
	/** "tool" ask: alwaysAllowReadOnly, plus alwaysAllowReadOnlyOutsideWorkspace outside the workspace. */
	| "readOnly"
	/** "tool" ask: alwaysAllowWrite, plus the outside-workspace and protected-file toggles. */
	| "write"
	/** "tool" ask: alwaysAllowModeSwitch, behind the plan-approval gate. */
	| "modeSwitch"
	/** "tool" ask: alwaysAllowSubtasks, behind the plan-approval gate. */
	| "subtask"
	/** "tool" ask returning control to the parent task: alwaysAllowSubtasks, no plan gate. */
	| "subtaskFinish"
	/** "tool" ask approved whenever auto-approval is on, no toggle. */
	| "alwaysAllowed"
	/** Not a tool: the plan-review pause after a write saved a plan (alwaysApprovePlan). */
	| "planReview"
	/** "command" ask: alwaysAllowExecute and the allowed/denied command lists. */
	| "execute"
	/** "use_mcp_server" ask: alwaysAllowMcp (and the tool's own alwaysAllow for use_mcp_tool). */
	| "mcp"
	/** "followup" ask: alwaysAllowFollowupQuestions with its timeout. */
	| "followup"
	/** A "tool" ask no toggle covers: only the bypass and autonomous tiers approve it. */
	| "manual"
	/** Never asks for approval. */
	| "none"

export interface ToolDescriptor {
	/** The auto-approval category of the tool's approval ask (see `ToolApprovalCategory`). */
	approvalCategory: ToolApprovalCategory
	/**
	 * The actions the tool's "tool" asks carry. Required for the categories answered from a
	 * "tool" ask, empty for the others. An action shared by several tools (`appliedDiff`)
	 * must have the same category in each.
	 */
	approvalActions?: readonly ClineSayTool["tool"][]
	/**
	 * A checkpoint is saved before the tool runs (presentAssistantMessage) and started
	 * early while its arguments stream (TaskStreamProcessor). Refactor plan decision 9:
	 * every workspace-writing tool plus `new_task` and `generate_image`.
	 */
	requiresCheckpoint?: boolean
	/**
	 * The tool cannot change the workspace, so an eager checkpoint may start while it is
	 * an earlier block of the same turn.
	 */
	workspaceReadOnly?: boolean
	/** Microcompact may clear an old result: bulky and cheap to re-derive. */
	compactable?: boolean
	/**
	 * The result never spills to an artifact, for a reason of its own (see
	 * `SPILL_BYPASS_TOOLS` in `src/core/artifacts/spillPolicy.ts`). Protocol tools are
	 * exempt already through `PROTOCOL_TOOL_NAMES` in `src/shared/tools.ts`, which stays
	 * there because src/shared is bundled into the webview and cannot import this file.
	 */
	spillExempt?: boolean
	/** Offered by a profile with `slimToolset` on (see `SLIM_TOOLSET_ALLOWLIST`). */
	slimAllowed?: boolean
	/** How the context ledger reads a call: its subject is a written or a read path. */
	ledger?: "file-mutation" | "file-read"
	/** One-line description used in tool results and the completion flow. */
	describe(block: DescribableToolBlock, context: ToolDescriptionContext): string
}

function args(block: DescribableToolBlock): Record<string, unknown> {
	return (block.nativeArgs ?? {}) as Record<string, unknown>
}

const bare = (block: DescribableToolBlock) => `[${block.name}]`

const forParam = (param: ToolParamName) => (block: DescribableToolBlock) =>
	`[${block.name} for '${block.params[param]}']`

const forParamWithArgs = (param: ToolParamName) => (block: DescribableToolBlock) =>
	`[${block.name} for '${block.params[param]}'${block.params.args ? ` with args: ${block.params.args}` : ""}]`

/** read_file: native args when present, else the legacy params. */
export function describeReadFile(name: string, source: unknown): string {
	const path = (source as Record<string, unknown> | undefined)?.path
	if (typeof path === "string" || path) {
		return `[${name} for '${path}']`
	}
	return `[${name} with missing path]`
}

export const TOOL_DESCRIPTORS: Readonly<Record<DispatchableToolName, ToolDescriptor>> = {
	// read
	read_file: {
		approvalCategory: "readOnly",
		approvalActions: ["readFile"],
		workspaceReadOnly: true,
		compactable: true,
		// Its schema promises whole-file reads and it caps itself.
		spillExempt: true,
		slimAllowed: true,
		ledger: "file-read",
		describe: (block) => describeReadFile(block.name, block.nativeArgs ? block.nativeArgs : block.params),
	},
	list_files: {
		approvalCategory: "readOnly",
		approvalActions: ["listFilesTopLevel", "listFilesRecursive"],
		workspaceReadOnly: true,
		compactable: true,
		slimAllowed: true,
		ledger: "file-read",
		describe: forParam("path"),
	},
	search_files: {
		approvalCategory: "readOnly",
		approvalActions: ["searchFiles"],
		workspaceReadOnly: true,
		compactable: true,
		slimAllowed: true,
		ledger: "file-read",
		describe: (block) =>
			`[${block.name} for '${block.params.regex}'${
				block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
			}]`,
	},
	codebase_search: {
		approvalCategory: "readOnly",
		approvalActions: ["codebaseSearch"],
		workspaceReadOnly: true,
		compactable: true,
		slimAllowed: true,
		ledger: "file-read",
		describe: forParam("query"),
	},
	read_artifact: {
		approvalCategory: "none",
		workspaceReadOnly: true,
		compactable: true,
		// Windows its own output; spilling a window would chase its own tail.
		spillExempt: true,
		slimAllowed: true,
		describe: forParam("artifact_id"),
	},
	// Deprecated alias of read_artifact: replayed histories and old habits still send it.
	read_command_output: {
		approvalCategory: "none",
		workspaceReadOnly: true,
		compactable: true,
		spillExempt: true,
		slimAllowed: true,
		describe: forParam("artifact_id"),
	},
	search_task_history: {
		approvalCategory: "none",
		// Reads the task's own stored conversation, never the workspace.
		workspaceReadOnly: true,
		compactable: true,
		// It searches the artifact directory: a spilled result would find itself.
		spillExempt: true,
		describe: forParam("query"),
	},

	// edit
	write_to_file: {
		approvalCategory: "write",
		approvalActions: ["editedExistingFile", "newFileCreated"],
		requiresCheckpoint: true,
		compactable: true,
		slimAllowed: true,
		ledger: "file-mutation",
		describe: forParam("path"),
	},
	apply_diff: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff"],
		requiresCheckpoint: true,
		compactable: true,
		slimAllowed: true,
		ledger: "file-mutation",
		describe: (block) => (block.params?.path ? `[${block.name} for '${block.params.path}']` : `[${block.name}]`),
	},
	edit: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff"],
		requiresCheckpoint: true,
		compactable: true,
		ledger: "file-mutation",
		describe: forParam("file_path"),
	},
	search_and_replace: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff"],
		requiresCheckpoint: true,
		compactable: true,
		ledger: "file-mutation",
		describe: forParam("file_path"),
	},
	search_replace: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff"],
		requiresCheckpoint: true,
		compactable: true,
		ledger: "file-mutation",
		describe: forParam("file_path"),
	},
	edit_file: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff", "newFileCreated"],
		requiresCheckpoint: true,
		compactable: true,
		ledger: "file-mutation",
		describe: forParam("file_path"),
	},
	apply_patch: {
		approvalCategory: "write",
		approvalActions: ["appliedDiff"],
		requiresCheckpoint: true,
		compactable: true,
		ledger: "file-mutation",
		describe: bare,
	},
	// Writes the image file.
	generate_image: {
		approvalCategory: "write",
		approvalActions: ["generateImage"],
		requiresCheckpoint: true,
		describe: forParam("path"),
	},

	// command and MCP
	execute_command: {
		approvalCategory: "execute",
		compactable: true,
		slimAllowed: true,
		describe: forParam("command"),
	},
	use_mcp_tool: {
		approvalCategory: "mcp",
		compactable: true,
		describe: forParam("server_name"),
	},
	access_mcp_resource: {
		approvalCategory: "mcp",
		compactable: true,
		// A resource the model asked for by URI, usually needed whole.
		spillExempt: true,
		describe: forParam("server_name"),
	},

	// web
	web_search: {
		// Only reads remote pages, it cannot touch the workspace.
		approvalCategory: "readOnly",
		approvalActions: ["webSearch"],
		workspaceReadOnly: true,
		compactable: true,
		slimAllowed: true,
		describe: (block) => {
			const queries = args(block).queries
			return Array.isArray(queries) && queries.length > 0
				? `[${block.name} for '${queries.join("', '")}']`
				: `[${block.name}]`
		},
	},
	web_fetch: {
		// Only reads remote pages, it cannot touch the workspace.
		approvalCategory: "readOnly",
		approvalActions: ["webFetch"],
		workspaceReadOnly: true,
		compactable: true,
		slimAllowed: true,
		describe: (block) => {
			const url = args(block).url
			return url ? `[${block.name} for '${url}']` : `[${block.name}]`
		},
	},

	// protocol
	ask_followup_question: {
		approvalCategory: "followup",
		slimAllowed: true,
		describe: forParam("question"),
	},
	attempt_completion: {
		// Its completion_result ask is the end of the task, never auto-approved; a subtask
		// finishing (finishTask, returning control to its parent) follows alwaysAllowSubtasks.
		approvalCategory: "subtaskFinish",
		approvalActions: ["finishTask"],
		slimAllowed: true,
		describe: bare,
	},
	switch_mode: {
		approvalCategory: "modeSwitch",
		approvalActions: ["switchMode"],
		slimAllowed: true,
		describe: (block) =>
			`[${block.name} to '${block.params.mode_slug}'${block.params.reason ? ` because: ${block.params.reason}` : ""}]`,
	},
	new_task: {
		approvalCategory: "subtask",
		approvalActions: ["newTask"],
		// A subtask can change the workspace before control returns.
		requiresCheckpoint: true,
		slimAllowed: true,
		describe: (block, { customModes }) => {
			const mode = block.params.mode ?? defaultModeSlug
			const message = block.params.message ?? "(no message)"
			const modeName = getModeBySlug(mode, customModes)?.name ?? mode
			return `[${block.name} in ${modeName} mode: '${message}']`
		},
	},
	run_parallel_tasks: {
		// Its runParallelTasks ask has no toggle.
		approvalCategory: "manual",
		describe: (block) => {
			const subtasks = args(block).subtasks
			const count = Array.isArray(subtasks) ? subtasks.length : 0
			return `[${block.name}: ${count} subtask(s)]`
		},
	},
	update_todo_list: {
		approvalCategory: "alwaysAllowed",
		approvalActions: ["updateTodoList"],
		slimAllowed: true,
		describe: bare,
	},
	run_slash_command: {
		// Loading a command's instructions; a skill found through it asks as `skill`.
		approvalCategory: "readOnly",
		approvalActions: ["runSlashCommand"],
		describe: forParamWithArgs("command"),
	},
	skill: {
		// Only loads instructions from skills the user installed, never arbitrary files.
		approvalCategory: "alwaysAllowed",
		approvalActions: ["skill"],
		slimAllowed: true,
		describe: forParamWithArgs("skill"),
	},
	tools_load: {
		approvalCategory: "none",
		slimAllowed: true,
		describe: (block) => {
			const names = args(block).names
			const summary = Array.isArray(names) && names.length > 0 ? names.join(", ") : "(no names)"
			return `[${block.name} for ${summary}]`
		},
	},
}

/** The row for a model-supplied name, or undefined. Safe for names like `constructor`. */
export function getToolDescriptor(name: string): ToolDescriptor | undefined {
	return Object.hasOwn(TOOL_DESCRIPTORS, name) ? TOOL_DESCRIPTORS[name as DispatchableToolName] : undefined
}

/**
 * The one-line description of a tool_use block. A name without a row (a custom tool or a
 * hallucinated name) gets the bare `[name]`.
 */
export function describeToolUse(block: DescribableToolBlock, context: ToolDescriptionContext = {}): string {
	return getToolDescriptor(block.name)?.describe(block, context) ?? bare(block)
}

/** The names whose row matches `predicate`, in table order. */
export function toolNamesWhere(predicate: (descriptor: ToolDescriptor) => boolean | undefined): DispatchableToolName[] {
	return (Object.keys(TOOL_DESCRIPTORS) as DispatchableToolName[]).filter((name) => predicate(TOOL_DESCRIPTORS[name]))
}
