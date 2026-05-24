import type OpenAI from "openai"

import { ALWAYS_AVAILABLE_TOOLS } from "../../shared/tools"
import { parseMcpToolName } from "../../utils/mcp-name"

/**
 * One entry in the deferred-tools catalog advertised to the model in the
 * system prompt. The model uses the `name` field with `tools_load` to
 * materialize the full schema on demand.
 */
export interface DeferredCatalogEntry {
	/**
	 * Group label. `mcp:<server>` for MCP tools (one section per server),
	 * `custom` for filesystem-discovered custom tools.
	 */
	group: string
	/** The canonical tool name the model calls. */
	name: string
	/** Short, single-sentence summary derived from the tool's description. */
	brief: string
}

export interface DeferredCatalog {
	entries: DeferredCatalogEntry[]
}

export interface ApplyDeferralOptions {
	/** Built-in native tools — never deferred (we treat them as alwaysLoad). */
	nativeTools: OpenAI.Chat.ChatCompletionTool[]
	/** MCP tools — deferred by default. */
	mcpTools: OpenAI.Chat.ChatCompletionTool[]
	/** Filesystem-loaded custom tools — deferred by default. */
	customTools: OpenAI.Chat.ChatCompletionTool[]
	/**
	 * Tool names the model has already materialized via `tools_load` on this
	 * Task. These get promoted back into the active set so the model can
	 * actually call them on subsequent turns.
	 */
	materializedDeferredTools: ReadonlySet<string>
}

export interface ApplyDeferralResult {
	/** The tools array to hand to the provider adapter. */
	activeTools: OpenAI.Chat.ChatCompletionTool[]
	/** Catalog of tools whose schemas were withheld. */
	catalog: DeferredCatalog
}

const ALWAYS_LOAD_SET: ReadonlySet<string> = new Set(ALWAYS_AVAILABLE_TOOLS)

const MAX_BRIEF_LENGTH = 200

/** Reduce a tool description down to its first sentence, hard-capped. */
function buildBrief(description: string | undefined | null): string {
	if (!description) {
		return ""
	}
	const trimmed = description.trim()
	if (!trimmed) {
		return ""
	}
	// Pick everything up to the first sentence-terminator that isn't part of an
	// abbreviation. A naive split on /[.!?]\s/ is good enough — descriptions
	// are short.
	const sentenceMatch = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/)
	const firstSentence = sentenceMatch ? sentenceMatch[0] : trimmed
	if (firstSentence.length <= MAX_BRIEF_LENGTH) {
		return firstSentence
	}
	return firstSentence.slice(0, MAX_BRIEF_LENGTH - 1) + "…"
}

function getToolName(tool: OpenAI.Chat.ChatCompletionTool): string {
	return (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name
}

function groupForMcp(toolName: string): string {
	const parsed = parseMcpToolName(toolName)
	if (parsed) {
		return `mcp:${parsed.serverName}`
	}
	// Fallback — should never happen for tools coming out of getMcpServerTools
	return "mcp:unknown"
}

/**
 * Split the full tool universe into an active set (sent to the provider) and
 * a deferred catalog (advertised in the system prompt and materialized on
 * demand by `tools_load`).
 *
 * Rules:
 *  - Native tools are never deferred.
 *  - MCP tools and custom tools are deferred by default.
 *  - Tools whose name is in `ALWAYS_AVAILABLE_TOOLS` are never deferred.
 *  - Tools the model has already materialized via `tools_load` are promoted
 *    back into the active set.
 */
export function applyDeferralStrategy(options: ApplyDeferralOptions): ApplyDeferralResult {
	const { nativeTools, mcpTools, customTools, materializedDeferredTools } = options

	const activeTools: OpenAI.Chat.ChatCompletionTool[] = []
	const entries: DeferredCatalogEntry[] = []

	// Native tools first — always active.
	for (const tool of nativeTools) {
		activeTools.push(tool)
	}

	// MCP tools: defer unless materialized or always-load.
	const mcpEntries: DeferredCatalogEntry[] = []
	for (const tool of mcpTools) {
		const name = getToolName(tool)
		if (ALWAYS_LOAD_SET.has(name) || materializedDeferredTools.has(name)) {
			activeTools.push(tool)
			continue
		}
		mcpEntries.push({
			group: groupForMcp(name),
			name,
			brief: buildBrief((tool as OpenAI.Chat.ChatCompletionFunctionTool).function.description ?? null),
		})
	}

	// Sort MCP groups alphabetically by server, then within each group preserve insertion order.
	mcpEntries.sort((a, b) => {
		if (a.group === b.group) {
			return 0
		}
		return a.group < b.group ? -1 : 1
	})
	entries.push(...mcpEntries)

	// Custom tools: defer unless materialized or always-load.
	for (const tool of customTools) {
		const name = getToolName(tool)
		if (ALWAYS_LOAD_SET.has(name) || materializedDeferredTools.has(name)) {
			activeTools.push(tool)
			continue
		}
		entries.push({
			group: "custom",
			name,
			brief: buildBrief((tool as OpenAI.Chat.ChatCompletionFunctionTool).function.description ?? null),
		})
	}

	return {
		activeTools,
		catalog: { entries },
	}
}

/**
 * Format the deferred-tools catalog for inclusion in the system prompt.
 * Returns an empty string when the catalog is empty so callers can splice
 * it in unconditionally.
 */
export function formatDeferredCatalog(catalog: DeferredCatalog): string {
	if (catalog.entries.length === 0) {
		return ""
	}

	const lines: string[] = []
	lines.push("# Deferred tools (load on demand)")
	lines.push(
		"The following tools are available but their full schemas have been withheld " +
			"to keep the context small. Call the `tools_load` tool with the exact names " +
			"you need to fetch the full schemas before invoking them.",
	)
	lines.push("")

	// Group entries by their `group` label, preserving the input ordering of
	// groups (which `applyDeferralStrategy` already sorts deterministically).
	const groupOrder: string[] = []
	const grouped = new Map<string, DeferredCatalogEntry[]>()
	for (const entry of catalog.entries) {
		if (!grouped.has(entry.group)) {
			grouped.set(entry.group, [])
			groupOrder.push(entry.group)
		}
		grouped.get(entry.group)!.push(entry)
	}

	for (const group of groupOrder) {
		const items = grouped.get(group)!
		lines.push(`## ${group}  (${items.length} ${items.length === 1 ? "tool" : "tools"})`)
		for (const item of items) {
			const brief = buildBrief(item.brief)
			lines.push(brief ? `- ${item.name}  ${brief}` : `- ${item.name}`)
		}
		lines.push("")
	}

	return lines.join("\n").trimEnd()
}
