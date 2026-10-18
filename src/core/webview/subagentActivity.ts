import type { ClineMessage } from "@tumble-code/types"

/** Longest activity line kept for a panel row. */
const MAX_ACTIVITY_CHARS = 120

function clip(text: string): string {
	const line = text.split("\n", 1)[0]?.trim() ?? ""
	return line.length > MAX_ACTIVITY_CHARS ? `${line.slice(0, MAX_ACTIVITY_CHARS)}…` : line
}

function parsePayload(text: string | undefined): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text ?? "")
		return parsed && typeof parsed === "object" ? parsed : undefined
	} catch {
		return undefined
	}
}

/**
 * The one-line activity a subagent's panel row shows for `message`: the
 * command it runs, the tool it uses (with the path), or the MCP tool it
 * calls. Undefined for any other message, which leaves the last activity.
 */
export function subagentActivity(message: ClineMessage): string | undefined {
	if (message.type !== "ask" || message.partial) return undefined
	switch (message.ask) {
		case "command":
			return message.text ? `$ ${clip(message.text)}` : undefined
		case "tool": {
			const payload = parsePayload(message.text)
			if (typeof payload?.tool !== "string") return undefined
			const path = typeof payload.path === "string" && payload.path ? ` ${payload.path}` : ""
			return clip(`${payload.tool}${path}`)
		}
		case "use_mcp_server": {
			const payload = parsePayload(message.text)
			if (typeof payload?.serverName !== "string") return undefined
			const tool = typeof payload.toolName === "string" ? `/${payload.toolName}` : ""
			return clip(`MCP ${payload.serverName}${tool}`)
		}
		default:
			return undefined
	}
}
