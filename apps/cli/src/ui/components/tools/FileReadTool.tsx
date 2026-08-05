import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

const MAX_PREVIEW_LINES = 12
const MAX_BATCH_FILES = 10

/**
 * Check if content looks like actual file content vs just path info.
 * File content typically has newlines or is longer than a typical path.
 */
function isActualContent(content: string, path: string): boolean {
	if (!content) return false
	if (content === path || content.endsWith(path)) return false
	if (!content.includes("\n") && (content.startsWith("/") || /^[A-Z]:\\/.test(content))) return false
	return content.includes("\n") || content.length > 200
}

export function FileReadTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const path = toolData.path || ""
	const rawContent = toolData.content ? sanitizeContent(toolData.content) : ""
	const isOutsideWorkspace = toolData.isOutsideWorkspace
	const isList = toolData.tool.includes("list") || toolData.tool.includes("List")
	const displayName = isList ? "List" : "Read"

	// Batch file reads
	if (toolData.batchFiles && toolData.batchFiles.length > 0) {
		const files = toolData.batchFiles
		const visible = files.slice(0, MAX_BATCH_FILES)
		const hidden = files.length - visible.length

		return (
			<Box flexDirection="column">
				<Box>
					<Bullet status={status} />
					<Box flexDirection="column" flexGrow={1}>
						<Text wrap="truncate-end">
							<Text bold>{displayName}</Text>
							<Text> ({files.length} files)</Text>
						</Text>
						{visible.map((file, index) => {
							const parts = [file.path]
							if (file.lineSnippet) parts.push(`(${file.lineSnippet})`)
							if (file.isOutsideWorkspace) parts.push("(outside workspace)")
							return (
								<ResultRow key={index} maxLines={1}>
									{parts.join(" ")}
								</ResultRow>
							)
						})}
						{hidden > 0 && <ResultRow maxLines={1}>{`… +${hidden} more`}</ResultRow>}
					</Box>
				</Box>
			</Box>
		)
	}

	// Single file read
	const content = isActualContent(rawContent, path) ? rawContent : ""
	const lineCount = content ? content.split("\n").length : 0
	const entryCount = isList && content ? content.split("\n").filter((l) => l.trim()).length : 0

	const resultLine = isList
		? entryCount > 0
			? `${entryCount} entries`
			: content || ""
		: lineCount > 0
			? `Read ${lineCount} lines`
			: content || ""

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>{displayName}</Text>
						{path ? <Text>({path})</Text> : null}
						{isOutsideWorkspace ? (
							<Text dimColor color={theme.warning}>
								{" "}
								(outside workspace)
							</Text>
						) : null}
					</Text>
					{resultLine && <ResultRow maxLines={MAX_PREVIEW_LINES}>{resultLine}</ResultRow>}
				</Box>
			</Box>
		</Box>
	)
}
