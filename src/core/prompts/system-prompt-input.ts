import * as vscode from "vscode"

import { type CustomModePrompts, type ModeConfig, type ProviderSettings, SETTINGS_DEFAULTS } from "@roo-code/types"

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
	/** The ACTIVE profile, so the slim-toolset flags follow every mode switch. */
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
	/** Facts about the model the request goes to. */
	modelInfo?: { isStealthModel?: boolean }
	skillsManager?: SkillsManager
}

/** Whether the prompt gets the MCP hub. An unset value takes the settings default. */
export function isMcpEnabledForPrompt(state: Pick<SystemPromptState, "mcpEnabled"> | undefined): boolean {
	return state?.mcpEnabled ?? SETTINGS_DEFAULTS.mcpEnabled
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
		},
		skillsManager: source.skillsManager,
		materializedDeferredTools: source.materializedDeferredTools,
	}
}
