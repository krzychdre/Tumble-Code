import type OpenAI from "openai"
import type { ModeConfig, ToolName, ToolGroup, ModelInfo } from "@tumble-code/types"
import { getGroupName, getModeBySlug, getToolsForMode } from "../../../shared/modes"
import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS, TOOL_ALIASES, isCompactProfile } from "@tumble-code/types"
import { defaultModeSlug } from "../../../shared/modes"
import type { CodeIndexManager } from "../../../services/code-index/manager"
import type { McpHub } from "../../../services/mcp/McpHub"
import { isToolAllowedForMode } from "../../../core/tools/validateToolUse"
import { toolNamesWhere } from "../../tools/toolDescriptors"

/**
 * Reverse lookup map - maps alias name to canonical tool name.
 * Built once at module load from the central TOOL_ALIASES constant.
 */
const ALIAS_TO_CANONICAL: Map<string, string> = new Map(
	Object.entries(TOOL_ALIASES).map(([alias, canonical]) => [alias, canonical]),
)

/**
 * Tools in the `web` group, gated by the global `webToolsEnabled` setting.
 * Read from TOOL_GROUPS so the group definition stays the single source of truth.
 */
const WEB_GROUP_TOOLS: readonly string[] = TOOL_GROUPS.web.tools

/**
 * The slim toolset: the only tool names a profile with `slimToolset` on may
 * advertise, on top of whatever the mode already allows.
 *
 * Small models do not fail because a capability is missing, they fail because
 * six near-identical editing verbs are on offer and they pick the wrong one.
 * This list keeps exactly one obvious tool per job:
 *
 * - read:     read_file, search_files, list_files, codebase_search
 * - edit:     apply_diff (surgical), write_to_file (whole file)
 * - command:  execute_command, read_artifact (+ its `read_command_output` alias)
 * - web:      web_search, web_fetch (still gated by `webToolsEnabled`)
 * - protocol: ask_followup_question, attempt_completion, switch_mode, new_task,
 *             update_todo_list, skill, tools_load
 *
 * Deliberately absent: the alternative edit verbs (`edit`, `search_replace`,
 * `edit_file`, `apply_patch`), `generate_image`, `run_parallel_tasks` and
 * `run_slash_command` (weak models fan out or expand slash commands instead of
 * doing the work; orchestrating modes run on strong profiles anyway), and the
 * MCP tools, which are governed separately by `slimHidesMcp`.
 *
 * The list is the `slimAllowed` column of the tool descriptor table
 * (`src/core/tools/toolDescriptors.ts`).
 *
 * Both `read_artifact` and its legacy alias `read_command_output` are allowed so
 * the intersection is correct no matter whether alias resolution ran first. Any
 * OTHER alias pointing at an allowlisted tool is folded in automatically by
 * SLIM_TOOLSET_ALLOWSET below, so this list only has to name canonical intent.
 */
export const SLIM_TOOLSET_ALLOWLIST: readonly string[] = toolNamesWhere((tool) => tool.slimAllowed)

/**
 * The allowlist as a lookup set, widened with every alias whose TARGET is
 * allowlisted (today: `write_file` for `write_to_file`, `read_command_output`
 * for `read_artifact`).
 *
 * This matters because callers hand us either form. `applySlimToolset`
 * checks the raw name before it resolves aliases, so an allowlist holding only
 * canonical names would answer "no" for `write_file` under a slim profile while
 * answering "yes" without one. Deriving the aliases from TOOL_ALIASES rather
 * than typing them out means a future alias cannot silently fall outside the
 * slim set. Aliases pointing at a hidden tool (`search_and_replace` resolves to
 * `edit`) are correctly left out.
 */
export const SLIM_TOOLSET_ALLOWSET: ReadonlySet<string> = withAliases(SLIM_TOOLSET_ALLOWLIST)

/** A name list as a lookup set, widened with every alias whose target is in the list. */
function withAliases(names: readonly string[]): ReadonlySet<string> {
	const allowset = new Set<string>(names)

	for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
		if (allowset.has(canonical)) {
			allowset.add(alias)
		}
	}

	return allowset
}

/** MCP tool names, kept only when the slim profile does not hide MCP. */
const MCP_GROUP_TOOLS: readonly string[] = TOOL_GROUPS.mcp.tools

/**
 * Settings subset that drives the slim toolset. Deliberately structural so both
 * the loose `Record<string, any>` filter settings and a `ProviderSettings`
 * object can be passed without conversion.
 */
export interface SlimToolsetSettings {
	slimToolset?: boolean
	slimHidesMcp?: boolean
}

/**
 * Whether the active profile asked for the slim toolset.
 */
export function isSlimToolsetEnabled(settings?: SlimToolsetSettings): boolean {
	return settings?.slimToolset === true
}

/**
 * Whether MCP must be hidden for the active profile.
 *
 * `slimHidesMcp` only means anything while `slimToolset` is on, and there an
 * undefined value counts as true: MCP schemas are the largest single chunk of
 * the tool prompt, so the slim default hides them. Setting it explicitly to
 * false keeps MCP reachable (through the deferred-tools catalog when that
 * experiment is on).
 */
export function slimToolsetHidesMcp(settings?: SlimToolsetSettings): boolean {
	return isSlimToolsetEnabled(settings) && settings?.slimHidesMcp !== false
}

/**
 * Intersect an already mode-resolved tool set with the slim allowlist.
 *
 * This runs AFTER mode/group resolution, so it can only ever remove names: a
 * mode that never had `execute_command` does not gain it here. When the profile
 * does not ask for the slim toolset the input set is returned untouched
 * (identity), which keeps the advertised array, and therefore the request
 * prefix, byte-identical for every existing profile.
 *
 * Note this is a PROMPT-SIDE restriction only. Dispatch is intentionally left
 * tolerant: a model that still calls a hidden-but-real tool name executes it
 * (aliases resolve as usual). Hiding a schema must never turn a well-formed
 * call into an error. The one place this is impossible is the Gemini branch of
 * `buildNativeToolsArrayWithRestrictions`, which documents why.
 *
 * Considered interaction with the teaching errors (WS-D): a MALFORMED call to a
 * hidden verb still gets that verb's `minimal_valid_example` back from
 * `responses.ts`, so the prompt says "this tool does not exist here" while the
 * error says "here is how to call it". That is deliberate and harmless. The
 * example only ever fires on a call that was already going to be retried, the
 * hidden verb really does execute (dispatch tolerance), and so following the
 * example completes the user's edit instead of dead-ending. Suppressing the
 * example would leave a small model with a broken call and no way to fix it,
 * which is strictly worse than a slightly inconsistent message.
 */
export function applySlimToolset(allowedTools: Set<string>, settings?: SlimToolsetSettings): Set<string> {
	if (!isSlimToolsetEnabled(settings)) {
		return allowedTools
	}

	const keepMcp = !slimToolsetHidesMcp(settings)
	const result = new Set<string>()

	for (const tool of allowedTools) {
		if (SLIM_TOOLSET_ALLOWSET.has(tool) || (keepMcp && MCP_GROUP_TOOLS.includes(tool))) {
			result.add(tool)
		}
	}

	return result
}

/**
 * The compact toolset: the only tool names a profile with `compactProfile` on
 * may advertise, still subject to the mode's groups and the feature gates
 * (ai_plans/2026-10-10_19-36_compact-small-model-profile.md, "Compact toolset"):
 *
 * - read:     read_file, list_files, search_files
 * - edit:     edit (in place of apply_diff), write_to_file (new files, full rewrites)
 * - command:  execute_command
 * - web:      web_search, web_fetch (still gated by `webToolsEnabled`)
 * - protocol: ask_followup_question, attempt_completion, switch_mode
 *
 * The list is the `compactAllowed` column of the tool descriptor table
 * (`src/core/tools/toolDescriptors.ts`). Not offered: the other edit verbs,
 * delegation, todo lists, artifacts, skills, slash commands, the deferred-tools
 * loader, every MCP tool and `access_mcp_resource`. Dispatch stays tolerant, as
 * with slim: a hidden tool the model calls anyway still runs.
 */
export const COMPACT_TOOLSET_ALLOWLIST: readonly string[] = toolNamesWhere((tool) => tool.compactAllowed)

/**
 * The compact allowlist as a lookup set, widened with the aliases of its tools
 * (today `write_file` and `search_and_replace`), for the same reason as
 * SLIM_TOOLSET_ALLOWSET.
 */
export const COMPACT_TOOLSET_ALLOWSET: ReadonlySet<string> = withAliases(COMPACT_TOOLSET_ALLOWLIST)

/**
 * The edit verb a compact profile offers in place of apply_diff. It is an
 * opt-in tool of the `edit` group (`customTools` in TOOL_GROUPS), which a mode
 * normally gets only through a model's `includedTools`; under compact every mode
 * with the edit group gets it.
 */
export const COMPACT_EDIT_TOOL = "edit"

/**
 * Settings subset that drives the compact toolset. Structural, like
 * SlimToolsetSettings, so the loose filter settings can be passed as they are.
 */
export interface CompactToolsetSettings {
	compactProfile?: boolean
	modelInfo?: ModelInfo
}

function modeHasGroup(modeConfig: ModeConfig, group: ToolGroup): boolean {
	return modeConfig.groups.some((entry) => getGroupName(entry) === group)
}

/**
 * Intersect an already mode-resolved tool set with the compact allowlist.
 *
 * Runs AFTER mode/group resolution and model customization, so it only removes
 * names, with one exception: a mode whose groups include `edit` is offered
 * COMPACT_EDIT_TOOL, the verb that replaces apply_diff. A mode without the edit
 * group never gains it, and neither does a model that lists it in
 * `excludedTools`. The feature gates and `disabledTools` run after this in
 * filterNativeToolsForMode, so they still apply.
 *
 * Compact supersedes slim: the caller runs this INSTEAD of applySlimToolset when
 * the flag is on. Without the flag the input set is returned untouched
 * (identity), which keeps today's bytes.
 */
export function applyCompactToolset(
	allowedTools: Set<string>,
	modeConfig: ModeConfig,
	settings?: CompactToolsetSettings,
): Set<string> {
	if (!isCompactProfile(settings)) {
		return allowedTools
	}

	const result = new Set<string>()

	for (const tool of allowedTools) {
		if (COMPACT_TOOLSET_ALLOWSET.has(tool)) {
			result.add(tool)
		}
	}

	const excludedByModel = (settings?.modelInfo?.excludedTools ?? []).some(
		(tool) => resolveToolAlias(tool) === COMPACT_EDIT_TOOL,
	)
	if (modeHasGroup(modeConfig, "edit") && !excludedByModel) {
		result.add(COMPACT_EDIT_TOOL)
	}

	return result
}

/**
 * The opt-in tools dispatch must accept for a compact profile: the model's own
 * `includedTools` plus COMPACT_EDIT_TOOL, so the `edit` the compact toolset
 * advertises passes `isToolAllowedForMode` in a mode with the edit group (and
 * only there; the group's `fileRegex` still applies). Without the flag the input
 * is returned untouched, including `undefined`.
 */
export function withCompactIncludedTools(
	includedTools: string[] | undefined,
	settings?: { compactProfile?: boolean } | null,
): string[] | undefined {
	if (!isCompactProfile(settings)) {
		return includedTools
	}
	return [...new Set([...(includedTools ?? []), COMPACT_EDIT_TOOL])]
}

/**
 * Cache for renamed tool definitions.
 * Maps "canonicalName:aliasName" to the pre-built tool definition.
 * This avoids creating new objects via spread operators on every assistant message.
 */
const RENAMED_TOOL_CACHE: Map<string, OpenAI.Chat.ChatCompletionTool> = new Map()

/**
 * Gets or creates a renamed tool definition with the alias name.
 * Uses RENAMED_TOOL_CACHE to avoid repeated object allocation.
 *
 * @param tool - The original tool definition
 * @param aliasName - The alias name to use
 * @returns Cached or newly created renamed tool definition
 */
function getOrCreateRenamedTool(
	tool: OpenAI.Chat.ChatCompletionTool,
	aliasName: string,
): OpenAI.Chat.ChatCompletionTool {
	if (!("function" in tool) || !tool.function) {
		return tool
	}

	const cacheKey = `${tool.function.name}:${aliasName}`
	let renamedTool = RENAMED_TOOL_CACHE.get(cacheKey)

	if (!renamedTool) {
		renamedTool = {
			...tool,
			function: {
				...tool.function,
				name: aliasName,
			},
		}
		RENAMED_TOOL_CACHE.set(cacheKey, renamedTool)
	}

	return renamedTool
}

/**
 * Resolves a tool name to its canonical name.
 * If the tool name is an alias, returns the canonical tool name.
 * If it's already a canonical name or unknown, returns as-is.
 *
 * @param toolName - The tool name to resolve (may be an alias)
 * @returns The canonical tool name
 */
export function resolveToolAlias(toolName: string): string {
	const canonical = ALIAS_TO_CANONICAL.get(toolName)
	return canonical ?? toolName
}

/**
 * Apply model-specific tool customization to a set of allowed tools.
 *
 * This function filters tools based on model configuration:
 * 1. Removes tools specified in modelInfo.excludedTools
 * 2. Adds tools from modelInfo.includedTools (only if they belong to allowed groups)
 *
 * @param allowedTools - Set of tools already allowed by mode configuration
 * @param modeConfig - Current mode configuration to check tool groups
 * @param modelInfo - Model configuration with tool customization
 * @returns Modified set of tools after applying model customization
 */
/**
 * Result of applying model tool customization.
 * Contains the set of allowed tools and any alias renames to apply.
 */
interface ModelToolCustomizationResult {
	allowedTools: Set<string>
	/** Maps canonical tool name to alias name for tools that should be renamed */
	aliasRenames: Map<string, string>
}

export function applyModelToolCustomization(
	allowedTools: Set<string>,
	modeConfig: ModeConfig,
	modelInfo?: ModelInfo,
): ModelToolCustomizationResult {
	if (!modelInfo) {
		return { allowedTools, aliasRenames: new Map() }
	}

	const result = new Set(allowedTools)
	const aliasRenames = new Map<string, string>()

	// Apply excluded tools (remove from allowed set)
	if (modelInfo.excludedTools && modelInfo.excludedTools.length > 0) {
		modelInfo.excludedTools.forEach((tool) => {
			const resolvedTool = resolveToolAlias(tool)
			result.delete(resolvedTool)
		})
	}

	// Apply included tools (add to allowed set, but only if they belong to an allowed group)
	if (modelInfo.includedTools && modelInfo.includedTools.length > 0) {
		// Build a map of tool -> group for all tools in TOOL_GROUPS (including customTools)
		const toolToGroup = new Map<string, ToolGroup>()
		for (const [groupName, groupConfig] of Object.entries(TOOL_GROUPS)) {
			// Add regular tools
			groupConfig.tools.forEach((tool) => {
				toolToGroup.set(tool, groupName as ToolGroup)
			})
			// Add customTools (opt-in only tools)
			if (groupConfig.customTools) {
				groupConfig.customTools.forEach((tool) => {
					toolToGroup.set(tool, groupName as ToolGroup)
				})
			}
		}

		// Get the list of allowed groups for this mode
		const allowedGroups = new Set(
			modeConfig.groups.map((groupEntry) => (Array.isArray(groupEntry) ? groupEntry[0] : groupEntry)),
		)

		// Add included tools only if they belong to an allowed group
		// If the tool was specified as an alias, track the rename
		modelInfo.includedTools.forEach((tool) => {
			const resolvedTool = resolveToolAlias(tool)
			const toolGroup = toolToGroup.get(resolvedTool)
			if (toolGroup && allowedGroups.has(toolGroup)) {
				result.add(resolvedTool)
				// If the tool was specified as an alias, rename it in the API
				if (tool !== resolvedTool) {
					aliasRenames.set(resolvedTool, tool)
				}
			}
		})
	}

	return { allowedTools: result, aliasRenames }
}

/**
 * Filters native tools based on mode restrictions and model customization.
 * This ensures native tools are filtered consistently with mode/tool permissions.
 *
 * @param nativeTools - Array of all available native tools
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @param codeIndexManager - Code index manager for codebase_search feature check
 * @param settings - Additional settings for tool filtering (includes modelInfo for model-specific customization)
 * @param mcpHub - MCP hub for checking available resources
 * @returns Filtered array of tools allowed for the mode
 */
export function filterNativeToolsForMode(
	nativeTools: OpenAI.Chat.ChatCompletionTool[],
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
	mcpHub?: McpHub,
	allowedMcpServers?: string[],
): OpenAI.Chat.ChatCompletionTool[] {
	// Get mode configuration and all tools for this mode
	const modeSlug = mode ?? defaultModeSlug
	let modeConfig = getModeBySlug(modeSlug, customModes)

	// Fallback to default mode if current mode config is not found
	// This ensures the agent always has functional tools even if a custom mode is deleted
	// or configuration becomes corrupted
	if (!modeConfig) {
		modeConfig = getModeBySlug(defaultModeSlug, customModes)!
	}

	// Get all tools for this mode (including always-available tools)
	const allToolsForMode = getToolsForMode(modeConfig.groups)

	// Filter to only tools that pass permission checks
	let allowedToolNames = new Set(
		allToolsForMode.filter((tool) =>
			isToolAllowedForMode(
				tool as ToolName,
				modeSlug,
				customModes ?? [],
				undefined,
				undefined,
				experiments ?? {},
			),
		),
	)

	// Apply model-specific tool customization
	const modelInfo = settings?.modelInfo as ModelInfo | undefined
	const { allowedTools: customizedTools, aliasRenames } = applyModelToolCustomization(
		allowedToolNames,
		modeConfig,
		modelInfo,
	)
	allowedToolNames = customizedTools

	// Slim toolset: intersect the mode-resolved set with the small allowlist when
	// the ACTIVE profile asks for it. Applied here, after group resolution and
	// model customization, so it can only subtract. Because the active profile
	// follows the mode through `modeApiConfigs`, switching modes mid-task
	// recomputes this on the very next request with no persisted state.
	// Compact supersedes slim: under `compactProfile` (the task's own profile)
	// the compact intersection runs instead.
	allowedToolNames = isCompactProfile(settings)
		? applyCompactToolset(allowedToolNames, modeConfig, settings)
		: applySlimToolset(allowedToolNames, settings)

	// Conditionally exclude codebase_search if feature is disabled or not configured
	if (
		!codeIndexManager ||
		!(codeIndexManager.isFeatureEnabled && codeIndexManager.isFeatureConfigured && codeIndexManager.isInitialized)
	) {
		allowedToolNames.delete("codebase_search")
	}

	// Conditionally exclude update_todo_list if disabled in settings
	if (settings?.todoListEnabled === false) {
		allowedToolNames.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!experiments?.imageGeneration) {
		allowedToolNames.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!experiments?.runSlashCommand) {
		allowedToolNames.delete("run_slash_command")
	}

	// The `web` group is gated by a global setting rather than by the mode
	// alone: with web tools off, the group resolves to nothing so the
	// advertised tool array (and therefore the request prefix) is identical to
	// a build without the feature.
	if (settings?.webToolsEnabled !== true) {
		for (const toolName of WEB_GROUP_TOOLS) {
			allowedToolNames.delete(toolName)
		}
	}

	// Remove tools that are explicitly disabled via the disabledTools setting
	if (settings?.disabledTools?.length) {
		for (const toolName of settings.disabledTools) {
			// Normalize aliases so disabling a legacy alias (e.g. "search_and_replace")
			// also disables the canonical tool (e.g. "edit").
			const resolvedToolName = resolveToolAlias(toolName)
			allowedToolNames.delete(resolvedToolName)
		}
	}

	// Conditionally exclude access_mcp_resource if MCP is not enabled or there are no resources.
	// When the mode restricts MCP servers via allowedMcpServers, only resources from allowed
	// servers count — otherwise a restricted mode could still read resources from disallowed servers.
	// Fall back to the mode config's own allowlist when the caller omits the parameter, so the
	// restriction is enforced regardless of call site (defense in depth).
	const effectiveAllowedMcpServers = allowedMcpServers ?? modeConfig.allowedMcpServers
	if (!mcpHub || !hasAnyMcpResources(mcpHub, effectiveAllowedMcpServers)) {
		allowedToolNames.delete("access_mcp_resource")
	}

	// Filter native tools based on allowed tool names and apply alias renames
	const filteredTools: OpenAI.Chat.ChatCompletionTool[] = []

	for (const tool of nativeTools) {
		// Handle both ChatCompletionTool and ChatCompletionCustomTool
		if ("function" in tool && tool.function) {
			const toolName = tool.function.name
			if (allowedToolNames.has(toolName)) {
				// Check if this tool should be renamed to an alias
				const aliasName = aliasRenames.get(toolName)
				if (aliasName) {
					// Use cached renamed tool definition to avoid per-message object allocation
					filteredTools.push(getOrCreateRenamedTool(tool, aliasName))
				} else {
					filteredTools.push(tool)
				}
			}
		}
	}

	return filteredTools
}

/**
 * Helper function to check if any MCP server has resources available
 */
function hasAnyMcpResources(mcpHub: McpHub, allowedServers?: string[]): boolean {
	let servers = mcpHub.getServers()
	if (allowedServers) {
		const allowSet = new Set(allowedServers)
		servers = servers.filter((server) => allowSet.has(server.name))
	}
	return servers.some((server) => server.resources && server.resources.length > 0)
}

/**
 * Filters MCP tools based on whether use_mcp_tool is allowed in the current mode.
 *
 * @param mcpTools - Array of MCP tools
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @param settings - Additional settings for tool filtering (slim toolset and compact profile flags)
 * @returns Filtered array of MCP tools if use_mcp_tool is allowed, empty array otherwise
 */
export function filterMcpToolsForMode(
	mcpTools: OpenAI.Chat.ChatCompletionTool[],
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	settings?: Record<string, any>,
): OpenAI.Chat.ChatCompletionTool[] {
	const modeSlug = mode ?? defaultModeSlug

	// A slim profile that hides MCP advertises no per-server tool schemas at all.
	// This is where the bulk of the tool-prompt saving comes from. A compact
	// profile never advertises MCP.
	if (isCompactProfile(settings) || slimToolsetHidesMcp(settings)) {
		return []
	}

	// MCP tools are always in the mcp group, check if use_mcp_tool is allowed
	const isMcpAllowed = isToolAllowedForMode(
		"use_mcp_tool",
		modeSlug,
		customModes ?? [],
		undefined,
		undefined,
		experiments ?? {},
	)

	return isMcpAllowed ? mcpTools : []
}
