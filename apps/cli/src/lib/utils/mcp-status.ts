import type { ExtensionMessage, McpServer } from "@roo-code/types"

/**
 * The MCP server list a message carries: `mcpServers` pushes (McpHub, after
 * every connection change) and full `state` pushes. Undefined for anything
 * else, including the partial `state` pushes that carry a single field.
 */
export function mcpServersFromMessage(message: ExtensionMessage): McpServer[] | undefined {
	if (message.type === "mcpServers") {
		return message.mcpServers ?? []
	}

	if (message.type === "state" && Array.isArray(message.state?.mcpServers)) {
		return message.state.mcpServers
	}

	return undefined
}

/** A server that should be running but is not, with the reason McpHub recorded. */
export function isFailedMcpServer(server: McpServer): boolean {
	return server.status === "disconnected" && !server.disabled && Boolean(server.error)
}

/** The last non-empty line of the server's latest error (stderr dumps can span many lines). */
export function lastMcpErrorLine(server: McpServer): string {
	const lines = (server.error ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)

	return lines.at(-1) ?? ""
}

/**
 * The failed servers not reported yet. `reported` remembers server and error
 * together, so one failure is reported once while a different error of the
 * same server is reported again.
 */
export function takeNewMcpFailures(servers: McpServer[], reported: Set<string>): McpServer[] {
	const failures: McpServer[] = []

	for (const server of servers) {
		if (!isFailedMcpServer(server)) {
			continue
		}

		const key = [server.source ?? "global", server.name, server.error].join("\u0000")

		if (!reported.has(key)) {
			reported.add(key)
			failures.push(server)
		}
	}

	return failures
}
