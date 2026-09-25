import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent, getToolDisplayName } from "./utils.js"

const MAX_CONTENT_LINES = 12

/**
 * Tools whose collapsed row prints no result lines, only the
 * "⎿ … +N lines (ctrl+o)" counter, like a Bash row (see CommandTool). An MCP
 * result is usually a JSON dump for the model, not for the reader.
 */
const OUTPUT_HIDDEN_TOOLS = new Set(["use_mcp_server"])

export function GenericTool({ toolData, rawContent, message, expanded = false }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const collapsedLines = OUTPUT_HIDDEN_TOOLS.has(toolData.tool) ? 0 : MAX_CONTENT_LINES
	const maxContentLines = expanded ? Number.POSITIVE_INFINITY : collapsedLines
	const displayName = getToolDisplayName(toolData.tool)
	const path = toolData.path
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const reason = toolData.reason ? sanitizeContent(toolData.reason) : ""

	let displayContent = content || reason || ""

	// If no structured content, try to parse rawContent JSON for content-like fields
	if (!displayContent && rawContent) {
		try {
			const parsed = JSON.parse(rawContent)
			displayContent = sanitizeContent(parsed.content || parsed.output || parsed.result || parsed.reason || "")
		} catch {
			displayContent = sanitizeContent(rawContent)
		}
	}

	// The header value the webview row shows (query, URL, skill, ...), else the path.
	const primaryArg = toolData.subject ?? path

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>{displayName}</Text>
						{primaryArg ? <Text>({primaryArg})</Text> : null}
						{toolData.isOutsideWorkspace ? (
							<Text color={theme.dimmed(theme.warning)}> (outside workspace)</Text>
						) : null}
						{toolData.isProtected ? <Text color={theme.error}> (protected)</Text> : null}
					</Text>
					{displayContent && <ResultRow maxLines={maxContentLines}>{displayContent}</ResultRow>}
				</Box>
			</Box>
		</Box>
	)
}

export default GenericTool
