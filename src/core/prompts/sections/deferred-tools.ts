import type OpenAI from "openai"

import { McpHub } from "../../../services/mcp/McpHub"
import { applyDeferralStrategy, formatDeferredCatalog } from "../../task/deferred-tools"
import { getMcpServerTools } from "../tools/native-tools"

/**
 * Build the "Deferred tools" prompt section.
 *
 * Returns an empty string unless:
 *  - the `deferredTools` experiment is enabled, AND
 *  - at least one MCP / custom tool would be deferred.
 *
 * This deliberately mirrors the deferral pass run inside
 * `buildNativeToolsArrayWithRestrictions` so the catalog the model sees in
 * the prompt matches the names actually withheld from the `tools` array.
 *
 * Custom-tool inclusion is handled by the caller: pass already-formatted
 * `customTools` (see `formatNative` in `@roo-code/core`) when the
 * `customTools` experiment is also enabled. Pass an empty array otherwise.
 */
export function getDeferredToolsSection(options: {
	experiments?: Record<string, boolean>
	mcpHub?: McpHub
	customTools?: OpenAI.Chat.ChatCompletionTool[]
	materializedDeferredTools?: ReadonlySet<string>
}): string {
	if (options.experiments?.deferredTools !== true) {
		return ""
	}

	const mcpTools = getMcpServerTools(options.mcpHub)
	const customTools = options.customTools ?? []

	if (mcpTools.length === 0 && customTools.length === 0) {
		return ""
	}

	const result = applyDeferralStrategy({
		nativeTools: [],
		mcpTools,
		customTools,
		materializedDeferredTools: options.materializedDeferredTools ?? new Set<string>(),
	})

	return formatDeferredCatalog(result.catalog)
}
