import { Box, Text, useStdout } from "ink"

import { toolPayloadDiffText } from "@tumble-code/core/cli"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow, { ElbowGutter } from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { bandSegments, pairHunkLines, type DiffLine } from "./diffBand.js"
import { sanitizeContent, parseAnyDiff, isDiffText } from "./utils.js"

const MAX_HUNK_LINES = 8
const MAX_HUNKS = 2

/**
 * Widest colour band we paint, gutter included. Lines are padded to the widest
 * line in their hunk so the band is a rectangle instead of a ragged edge, and
 * this caps that padding on very wide terminals. Anything longer is cut by
 * `bandSegments` rather than wrapped: a wrapped diff line would spill a
 * half-coloured second row and blow the dynamic tail's row budget. The cut
 * keeps the changed columns of a modified line in view (see diffBand.ts).
 */
const MAX_DIFF_WIDTH = 100

/**
 * Columns the diff body is inset by: the 2-wide bullet column plus the 5-wide
 * `  ⎿  ` connector. One extra column is reserved on top because ink hands a
 * `wrap="truncate-end"` text one column more than the row has left, and a band
 * padded into that column wraps onto a stray row of its own.
 */
const DIFF_INSET = 2 + 5 + 1

/** Rendered width of a hunk's body, so every line can be padded to it. */
function hunkBandWidth(lines: DiffLine[], columns: number): number {
	const widest = lines.reduce((max, line) => Math.max(max, line.content.length + 1), 0)
	return Math.max(1, Math.min(widest, MAX_DIFF_WIDTH, columns - DIFF_INSET))
}

export function FileWriteTool({ toolData, message, expanded = false }: ToolRendererProps) {
	const { stdout } = useStdout()
	const columns = stdout?.columns || 80
	const status = toolStatusFromMessage(message)
	const maxHunks = expanded ? Number.POSITIVE_INFINITY : MAX_HUNKS
	const maxHunkLines = expanded ? Number.POSITIVE_INFINITY : MAX_HUNK_LINES
	const path = toolData.path || ""
	const diffStats = toolData.diffStats
	// The diff the webview shows: the unified diff in `content` when there is
	// one (`apply_diff` sends it once applied, next to its SEARCH/REPLACE blocks
	// in `diff`), else `diff`. `content` of a file write still streaming is the
	// new file, not a diff, so it is skipped (plan: 2026-09-22 CLI diffs render
	// without colours, D2).
	const preferred = toolPayloadDiffText(toolData) ?? ""
	const rawDiff = isDiffText(preferred) ? preferred : toolData.diff || ""
	const diff = rawDiff ? sanitizeContent(rawDiff) : ""
	const isProtected = toolData.isProtected
	const isOutsideWorkspace = toolData.isOutsideWorkspace
	const isNewFile = toolData.tool === "newFileCreated"
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
							<Text color={theme.dimmed(theme.warning)}> (outside workspace)</Text>
						) : null}
					</Text>

					{/* Diff preview: every removed line on a red band, every added
					    line on a green band, context faint and unbanded. The columns
					    a modified line differs in get a stronger shade, and a band cut
					    at the width is shifted so those columns stay in view. */}
					{visibleHunks.length > 0 && (
						<Box flexDirection="row">
							<ElbowGutter />
							<Box flexDirection="column" flexGrow={1}>
								{visibleHunks.map((hunk, hunkIndex) => {
									const visibleLines = pairHunkLines(hunk.lines).slice(0, maxHunkLines)
									const bandWidth = hunkBandWidth(
										visibleLines.map((view) => view.line),
										columns,
									)
									const hiddenLines = hunk.lines.length - visibleLines.length

									return (
										<Box key={hunkIndex} flexDirection="column">
											{hunk.header ? <Text color={theme.faint}>{hunk.header}</Text> : null}
											{visibleLines.map((view, lineIndex) => {
												const { line } = view
												const band = bandSegments(view, bandWidth)
												const added = line.type === "added"
												const removed = line.type === "removed"
												return (
													<Text
														key={lineIndex}
														wrap="truncate-end"
														backgroundColor={
															added
																? theme.diffAdded
																: removed
																	? theme.diffRemoved
																	: undefined
														}
														color={line.type === "context" ? theme.faint : theme.text}>
														{band.before}
														{band.changed ? (
															<Text
																backgroundColor={
																	added
																		? theme.diffAddedStrong
																		: theme.diffRemovedStrong
																}>
																{band.changed}
															</Text>
														) : null}
														{band.after}
													</Text>
												)
											})}
											{hiddenLines > 0 && (
												<Text color={theme.faint}>{`… +${hiddenLines} more lines`}</Text>
											)}
										</Box>
									)
								})}
								{diffHunks.length > maxHunks && (
									<Text color={theme.faint}>{`… +${diffHunks.length - maxHunks} more hunks`}</Text>
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
