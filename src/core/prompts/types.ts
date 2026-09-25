import type * as vscode from "vscode"

import type { CustomModePrompts, ModeConfig } from "@roo-code/types"

import type { McpHub } from "../../services/mcp/McpHub"
import type { SkillsManager } from "../../services/skills/SkillsManager"
import type { Mode } from "../../shared/modes"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	todoListEnabled: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .roo/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
	/**
	 * Slim toolset flags, read from the ACTIVE API profile (not global settings).
	 * They must reach the prompt because the prompt's MCP sections have to match
	 * the tool array exactly: advertising an MCP server the model has no schema
	 * for is the classic weak-model trap.
	 */
	slimToolset?: boolean
	slimHidesMcp?: boolean
}

/**
 * Everything `SYSTEM_PROMPT` reads, as one object.
 *
 * Production callers do not fill this by hand: they describe their request with
 * a `SystemPromptSource` and call `buildSystemPromptInput` (system-prompt-input.ts),
 * so the "copy system prompt" preview and the live request cannot drift apart.
 */
export interface SystemPromptOptions {
	context: vscode.ExtensionContext
	cwd: string
	/** Mode slug; an unknown slug falls back to the first built-in mode. Defaults to the default mode. */
	mode?: Mode
	/** Present only when MCP is enabled; the prompt's MCP sections read their servers from it. */
	mcpHub?: McpHub
	customModePrompts?: CustomModePrompts
	customModes?: ModeConfig[]
	globalCustomInstructions?: string
	experiments?: Record<string, boolean>
	/** Reply language; defaults to the VS Code display language. */
	language?: string
	rooIgnoreInstructions?: string
	settings?: SystemPromptSettings
	skillsManager?: SkillsManager
	/** Deferred tools the task already loaded; they drop out of the deferred-tools catalog. */
	materializedDeferredTools?: ReadonlySet<string>
}
