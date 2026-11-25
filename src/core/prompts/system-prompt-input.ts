import * as vscode from "vscode"

import {
	type CustomModePrompts,
	type ModeConfig,
	type ProviderSettings,
	SETTINGS_DEFAULTS,
	isParallelTasksEnabled,
	readCliRuntimeEnv,
} from "@tumble-code/types"

import type { McpHub } from "../../services/mcp/McpHub"
import type { SkillsManager } from "../../services/skills/SkillsManager"
import { Package } from "../../shared/package"

import type { SystemPromptOptions } from "./types"

/** The provider-state fields the system prompt reads (a subset of `getState()`). */
export interface SystemPromptState {
	mcpEnabled?: boolean
	customModes?: ModeConfig[]
	customModePrompts?: CustomModePrompts
	customInstructions?: string
	experiments?: Record<string, boolean>
	language?: string
	enableSubfolderRules?: boolean
	disabledTools?: string[]
	parallelTasksMaxConcurrency?: number
	/**
	 * The ACTIVE profile, so the slim-toolset flags follow every mode switch.
	 * `compactProfile` is deliberately not read from here: it follows the profile
	 * that serves the request, which the caller passes as
	 * `SystemPromptSource.compactProfile`.
	 */
	apiConfiguration?: Pick<ProviderSettings, "todoListEnabled" | "slimToolset" | "slimHidesMcp">
}

/**
 * What a caller knows about the request it builds a system prompt for.
 *
 * The live request (ApiRequestBuilder) and the "copy system prompt" preview
 * (generateSystemPrompt) gather these facts in their own way (the live path
 * waits for the MCP hub, the preview reads the focused task), then both hand
 * them to `buildSystemPromptInput`, so the mapping from facts to prompt input
 * exists once and the two prompts cannot drift apart again (CORE-R11).
 */
export interface SystemPromptSource {
	context: vscode.ExtensionContext
	cwd: string
	mode: string
	/** Provider state; undefined when the provider is gone, then every setting takes its default. */
	state: SystemPromptState | undefined
	/** The MCP hub. Ignored when MCP is disabled (see `isMcpEnabledForPrompt`). */
	mcpHub?: McpHub
	/** Task-scoped: the task's .rooignore controller. */
	rooIgnoreController?: { getInstructions(): string | undefined }
	/** Task-scoped: deferred tools the task already loaded. */
	materializedDeferredTools?: ReadonlySet<string>
	/** Task-scoped: who started the task; a delegated one gets the subtask prompt and fewer tools. */
	origin: TaskOrigin
	/** Facts about the model the request goes to. */
	modelInfo?: { isStealthModel?: boolean; excludedTools?: string[] }
	/**
	 * Whether the profile that serves the request is a compact profile, resolved
	 * by the caller with `isCompactProfile()` from the same profile it takes the
	 * model from: the live request uses the task's own `apiConfiguration` (the
	 * profile its API handler was built from, which a background task or a
	 * detached parent does not share with the panel), the preview uses the
	 * profile it resolves the preview model from. Undefined means off.
	 */
	compactProfile?: boolean
	skillsManager?: SkillsManager
	/** MEMORY.md as `readMemoryIndex` returned it; the live request reads it once per task. */
	memoryIndex: string
}

/** Whether the prompt gets the MCP hub. An unset value takes the settings default. */
export function isMcpEnabledForPrompt(state: Pick<SystemPromptState, "mcpEnabled"> | undefined): boolean {
	return state?.mcpEnabled ?? SETTINGS_DEFAULTS.mcpEnabled
}

/**
 * Who started a task: the user, a parent's `new_task` (a delegated child that
 * the parent waits for) or a parent's `run_parallel_tasks` (a headless subagent).
 */
export type TaskOrigin = "user" | "new_task" | "subagent"

export function taskOrigin(task: { isBackground: boolean; parentTaskId?: string }): TaskOrigin {
	if (task.isBackground) {
		return "subagent"
	}
	return task.parentTaskId === undefined ? "user" : "new_task"
}

/** The tools that start and collect parallel subagents: one switch hides both. */
const SUBAGENT_TOOLS = ["run_parallel_tasks", "wait_for_subagents"]

/**
 * Tools a task never gets because of its origin. A delegated task works in the
 * mode its parent chose, so it cannot switch; a subagent is a one-shot job that
 * must return to its parent, so it cannot delegate either.
 */
const ORIGIN_DISABLED_TOOLS: Record<TaskOrigin, string[]> = {
	user: [],
	new_task: ["switch_mode"],
	subagent: ["switch_mode", "new_task", ...SUBAGENT_TOOLS],
}

/**
 * The `disabledTools` list a request hands to the tool filter: the user's
 * setting, plus the tools the task's origin takes away, plus the subagent
 * tools (run_parallel_tasks, wait_for_subagents) when the concurrency cap
 * turns the feature off. Routed through disabledTools so the existing
 * alias-resolving filter removes them.
 *
 * One function for the tools array (ApiRequestBuilder.buildToolsArray) and for
 * the prompt, so the prompt cannot suggest a tool the array no longer carries.
 */
export function getRequestDisabledTools(
	state: Pick<SystemPromptState, "disabledTools" | "parallelTasksMaxConcurrency"> | undefined,
	origin: TaskOrigin,
): string[] {
	const removed = [...(state?.disabledTools ?? []), ...ORIGIN_DISABLED_TOOLS[origin]]
	if (origin !== "subagent" && !isParallelTasksEnabled(state?.parallelTasksMaxConcurrency)) {
		removed.push(...SUBAGENT_TOOLS)
	}
	return removed
}

/** Map the facts about a request to the input of `SYSTEM_PROMPT`. */
export function buildSystemPromptInput(source: SystemPromptSource): SystemPromptOptions {
	const { state } = source
	const config = vscode.workspace.getConfiguration(Package.name)

	return {
		context: source.context,
		cwd: source.cwd,
		mode: source.mode,
		mcpHub: isMcpEnabledForPrompt(state) ? source.mcpHub : undefined,
		customModePrompts: state?.customModePrompts,
		customModes: state?.customModes,
		globalCustomInstructions: state?.customInstructions,
		experiments: state?.experiments,
		language: state?.language,
		rooIgnoreInstructions: source.rooIgnoreController?.getInstructions(),
		settings: {
			todoListEnabled: state?.apiConfiguration?.todoListEnabled ?? true,
			useAgentRules: config.get<boolean>("useAgentRules") ?? true,
			enableSubfolderRules: state?.enableSubfolderRules ?? SETTINGS_DEFAULTS.enableSubfolderRules,
			newTaskRequireTodos: config.get<boolean>("newTaskRequireTodos", false),
			isStealthModel: source.modelInfo?.isStealthModel,
			slimToolset: state?.apiConfiguration?.slimToolset,
			slimHidesMcp: state?.apiConfiguration?.slimHidesMcp,
			compactProfile: source.compactProfile,
			isSubtask: source.origin !== "user",
			cliDisplay: readCliRuntimeEnv(process.env).display,
			removedTools: [
				...getRequestDisabledTools(state, source.origin),
				...(source.modelInfo?.excludedTools ?? []),
			],
		},
		skillsManager: source.skillsManager,
		materializedDeferredTools: source.materializedDeferredTools,
		memoryIndex: source.memoryIndex,
	}
}
