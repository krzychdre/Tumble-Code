import { Box, Text, useStdout } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow, { ElbowGutter } from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent, parseAnyDiff, isDiffText, type DiffHunk } from "./utils.js"

const MAX_HUNK_LINES = 8
const MAX_HUNKS = 2

/**
 * Widest colour band we paint, gutter included. Lines are padded to the widest
 * line in their hunk so the band is a rectangle instead of a ragged edge, and
 * this caps that padding on very wide terminals. Anything longer is truncated
 * by `wrap="truncate-end"` rather than wrapped: a wrapped diff line would spill
 * a half-coloured second row and blow the dynamic tail's row budget.
 */
const MAX_DIFF_WIDTH = 100

/**
 * Columns the diff body is inset by: the 2-wide bullet column plus the 5-wide
 * `  ⎿  ` connector. One extra column is reserved on top because ink hands a
 * `wrap="truncate-end"` text one column more than the row has left, and a band
 * padded into that column wraps onto a stray row of its own.
 */
const DIFF_INSET = 2 + 5 + 1

const DIFF_GUTTER: Record<"added" | "removed" | "context" | "header", string> = {
	added: "+",
	removed: "-",
	context: " ",
	header: " ",
}

/** Rendered width of a hunk's body, so every line can be padded to it. */
function hunkBandWidth(lines: DiffHunk["lines"], columns: number): number {
	const widest = lines.reduce((max, line) => Math.max(max, line.content.length + 1), 0)
	return Math.max(1, Math.min(widest, MAX_DIFF_WIDTH, columns - DIFF_INSET))
}

/**
 * One diff line as an exactly `width`-wide band. Padding and truncation are
 * done here rather than left to ink: ink's own `truncate-end` hands the text
 * one column more than the row has left, which pushes the band onto a second
 * row and quietly eats a line of the tail's row budget.
 */
function bandLine(line: DiffHunk["lines"][number], width: number): string {
	const text = `${DIFF_GUTTER[line.type]}${line.content}`
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}${figures.ellipsis}` : text.padEnd(width)
}

export function FileWriteTool({ toolData, message, expanded = false }: ToolRendererProps) {
	const { stdout } = useStdout()
	const columns = stdout?.columns || 80
	const status = toolStatusFromMessage(message)
	const maxHunks = expanded ? Number.POSITIVE_INFINITY : MAX_HUNKS
	const maxHunkLines = expanded ? Number.POSITIVE_INFINITY : MAX_HUNK_LINES
	const path = toolData.path || ""
	const diffStats = toolData.diffStats
	// `apply_diff` puts SEARCH/REPLACE blocks in `diff`; `write_to_file` and the
	// editor-backed edits put a unified diff in `content` and send no `diff` at
	// all (plan: 2026-09-22 CLI diffs render without colours, D2).
	const rawDiff = toolData.diff || (isDiffText(toolData.content || "") ? toolData.content! : "")
	const diff = rawDiff ? sanitizeContent(rawDiff) : ""
	const isProtected = toolData.isProtected
	const isOutsideWorkspace = toolData.isOutsideWorkspace
	const isNewFile = toolData.tool === "newFileCreated" || toolData.tool === "write_to_file"
	const displayName = isNewFile ? "Create File" : "Edit"

	// Batch diff operations
	if (toolData.batchDiffs && toolData.batchDiffs.length > 0) {
		const diffs = toolData.batchDiffs
		const visible = diffs.slice(0, maxHunks)
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
	const diffHunks = parseAnyDiff(diff)
	const visibleHunks = diffHunks.slice(0, maxHunks)

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

					{/* Diff preview: every removed line on a red band, every added
					    line on a green band, context dim and unbanded. */}
					{visibleHunks.length > 0 && (
						<Box flexDirection="row">
							<ElbowGutter />
							<Box flexDirection="column" flexGrow={1}>
								{visibleHunks.map((hunk, hunkIndex) => {
									const visibleLines = hunk.lines.slice(0, maxHunkLines)
									const bandWidth = hunkBandWidth(visibleLines, columns)
									const hiddenLines = hunk.lines.length - visibleLines.length

									return (
										<Box key={hunkIndex} flexDirection="column">
											{hunk.header ? (
												<Text dimColor color={theme.secondaryText}>
													{hunk.header}
												</Text>
											) : null}
											{visibleLines.map((line, lineIndex) => (
												<Text
													key={lineIndex}
													wrap="truncate-end"
													backgroundColor={
														line.type === "added"
															? theme.diffAdded
															: line.type === "removed"
																? theme.diffRemoved
																: undefined
													}
													dimColor={line.type === "context"}
													color={line.type === "context" ? theme.secondaryText : theme.text}>
													{bandLine(line, bandWidth)}
												</Text>
											))}
											{hiddenLines > 0 && (
												<Text dimColor color={theme.secondaryText}>
													{`… +${hiddenLines} more lines`}
												</Text>
											)}
										</Box>
									)
								})}
								{diffHunks.length > maxHunks && (
									<Text dimColor color={theme.secondaryText}>
										{`… +${diffHunks.length - maxHunks} more hunks`}
									</Text>
								)}
							</Box>
						</Box>
					)}

					{/* Raw fallback, but only for text that is not a diff at all:
					    dumping a half-streamed SEARCH block's scaffolding on
					    screen helps nobody. */}
					{diffHunks.length === 0 && diff && !isDiffText(diff) ? (
						<ResultRow maxLines={maxHunkLines}>{diff}</ResultRow>
					) : null}
				</Box>
			</Box>
		</Box>
	)
}
