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
 * Build the literal worked-example JSON used in both the system-prompt
 * catalog header and the `tools_load` tool description. Picks the first
 * one or two names from the catalog so the example mirrors real usage on
 * the current installation. Falls back to a stable placeholder when the
 * catalog is empty.
 */
export function buildToolsLoadCallExample(catalog: DeferredCatalog): string {
	const names = catalog.entries.slice(0, 2).map((e) => e.name)
	if (names.length === 0) {
		return `tools_load({"names": ["<deferred_tool_name>"]})`
	}
	// Render with spaces inside the JSON: weak models pattern-match this verbatim
	// from the prompt, and the spaced form is what we want them to emit (it's
	// also what the dispatch example in the spec/test uses).
	const namesList = names.map((n) => `"${n}"`).join(", ")
	return `tools_load({"names": [${namesList}]})`
}

/**
 * Format the deferred-tools catalog for inclusion in the system prompt.
 * Returns an empty string when the catalog is empty so callers can splice
 * it in unconditionally.
 *
 * Hardening for weak tool-calling models (v1.1): the header is now a
 * literal two-step procedure with a worked JSON example, and the
 * per-entry names are rendered quoted so the model can pattern-match the
 * call-site against the listing. Both nudge weak models toward emitting
 * the correct shape on the first try.
 */
export function formatDeferredCatalog(catalog: DeferredCatalog): string {
	if (catalog.entries.length === 0) {
		return ""
	}

	const example = buildToolsLoadCallExample(catalog)

	const lines: string[] = []
	lines.push("# Deferred tools (load on demand)")
	lines.push("")
	lines.push(
		"You have additional tools available below. Their input schemas have been " +
			"withheld to keep your context small, but you CAN use them via this two-step " +
			"procedure:",
	)
	lines.push("")
	lines.push("  STEP 1 — Call the `tools_load` tool with the names you need. Example:")
	lines.push(`      ${example}`)
	lines.push("")
	lines.push("  STEP 2 — On the next turn the requested tools become callable like any")
	lines.push("  other tool. Use their normal schemas.")
	lines.push("")
	lines.push("Rules:")
	lines.push("  • `names` MUST be a non-empty array of strings.")
	lines.push("  • Names are case-sensitive and must match the entries below EXACTLY.")
	lines.push("  • Batch related tools in one call instead of calling tools_load repeatedly.")
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
			// Quote the name. Weak models latch onto quoted strings as call-site
			// arguments more reliably than bare identifiers.
			lines.push(brief ? `- "${item.name}"  — ${brief}` : `- "${item.name}"`)
		}
		lines.push("")
	}

	return lines.join("\n").trimEnd()
}
