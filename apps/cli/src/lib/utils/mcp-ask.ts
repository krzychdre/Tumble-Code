import type { ClineAskUseMcpServer } from "@roo-code/types"

/**
 * What a `use_mcp_server` ask asks for. The ask text is the JSON of
 * `ClineAskUseMcpServer`, built by the core's UseMcpToolTool and
 * accessMcpResourceTool (camelCase keys, `arguments` as a JSON string).
 */
export interface McpAskDetails {
	kind: "tool" | "resource"
	serverName: string
	toolName?: string
	uri?: string
	/** The tool's arguments as indented JSON, one entry per line; empty when there are none. */
	argumentLines: string[]
}

export function parseMcpAsk(text: string | undefined): McpAskDetails | undefined {
	let ask: Partial<ClineAskUseMcpServer> | null

	try {
		ask = JSON.parse(text ?? "") as Partial<ClineAskUseMcpServer> | null
	} catch {
		return undefined
	}

	if (!ask || typeof ask.serverName !== "string") {
		return undefined
	}

	if (ask.type === "access_mcp_resource") {
		return { kind: "resource", serverName: ask.serverName, uri: ask.uri, argumentLines: [] }
	}

	if (ask.type === "use_mcp_tool") {
		return {
			kind: "tool",
			serverName: ask.serverName,
			toolName: ask.toolName,
			argumentLines: formatArguments(ask.arguments),
		}
	}

	return undefined
}

function formatArguments(raw: string | undefined): string[] {
	if (!raw) {
		return []
	}

	try {
		const value: unknown = JSON.parse(raw)

		if (value && typeof value === "object" && Object.keys(value).length === 0) {
			return []
		}

		return JSON.stringify(value, null, 2).split("\n")
	} catch {
		return raw.split("\n")
	}
}
