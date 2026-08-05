import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent, parseDiff } from "./utils.js"

const MAX_HUNK_LINES = 8
const MAX_HUNKS = 2

export function FileWriteTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const path = toolData.path || ""
	const diffStats = toolData.diffStats
	const diff = toolData.diff ? sanitizeContent(toolData.diff) : ""
	const isProtected = toolData.isProtected
	const isOutsideWorkspace = toolData.isOutsideWorkspace
	const isNewFile = toolData.tool === "newFileCreated" || toolData.tool === "write_to_file"
	const displayName = isNewFile ? "Create File" : "Edit"

	// Batch diff operations
	if (toolData.batchDiffs && toolData.batchDiffs.length > 0) {
		const diffs = toolData.batchDiffs
		const visible = diffs.slice(0, MAX_HUNKS)
		const hidden = diffs.length - visible.length

		return (
			<Box flexDirection="column">
				<Box>
					<Bullet status={status} />
					<Box flexDirection="column" flexGrow={1}>
						<Text wrap="truncate-end">
							<Text bold>{displayName}</Text>
							<Text> ({diffs.length} files)</Text>
						</Text>
						{visible.map((file, index) => (
							<ResultRow key={index} maxLines={1}>
								{`${file.path}  +${file.diffStats?.added ?? 0} -${file.diffStats?.removed ?? 0}`}
							</ResultRow>
						))}
						{hidden > 0 && <ResultRow maxLines={1}>{`… +${hidden} more`}</ResultRow>}
					</Box>
				</Box>
			</Box>
		)
	}

	// Single file write
	const diffHunks = diff ? parseDiff(diff) : []

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>{displayName}</Text>
						{path ? <Text>({path})</Text> : null}
						{diffStats ? (
							<Text>
								{" "}
								<Text color={theme.success}>+{diffStats.added}</Text>
								<Text> </Text>
								<Text color={theme.error}>-{diffStats.removed}</Text>
							</Text>
						) : null}
						{isProtected ? <Text color={theme.error}> (protected)</Text> : null}
						{isOutsideWorkspace ? (
							<Text dimColor color={theme.warning}>
								{" "}
								(outside workspace)
							</Text>
						) : null}
					</Text>

					{/* Diff preview: render hunks with bg-colored added/removed lines */}
					{diffHunks.length > 0 && (
						<Box flexDirection="column">
							{diffHunks.slice(0, MAX_HUNKS).map((hunk, hunkIndex) => (
								<Box key={hunkIndex} flexDirection="column">
									{hunk.lines.slice(0, MAX_HUNK_LINES).map((line, lineIndex) => (
										<Text
											key={lineIndex}
											backgroundColor={
												line.type === "added"
													? theme.diffAdded
													: line.type === "removed"
														? theme.diffRemoved
														: undefined
											}
											dimColor={line.type === "context"}
											color={line.type === "context" ? theme.secondaryText : theme.text}>
											{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
											{line.content}
										</Text>
									))}
									{hunk.lines.length > MAX_HUNK_LINES && (
										<Text dimColor color={theme.secondaryText}>
											{`… +${hunk.lines.length - MAX_HUNK_LINES} more lines`}
										</Text>
									)}
								</Box>
							))}
							{diffHunks.length > MAX_HUNKS && (
								<Text dimColor color={theme.secondaryText}>
									{`… +${diffHunks.length - MAX_HUNKS} more hunks`}
								</Text>
							)}
						</Box>
					)}

					{/* Fallback to raw diff via ResultRow when no hunks parsed */}
					{diffHunks.length === 0 && diff ? <ResultRow maxLines={MAX_HUNK_LINES}>{diff}</ResultRow> : null}
				</Box>
			</Box>
		</Box>
	)
}
