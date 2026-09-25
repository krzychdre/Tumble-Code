import { Box, Text } from "ink"

import { toolPayloadSearchScope } from "@roo-code/core/cli"

import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow, { ElbowGutter } from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

const MAX_RESULT_LINES = 15

export function SearchTool({ toolData, message, expanded = false }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const maxResultLines = expanded ? Number.POSITIVE_INFINITY : MAX_RESULT_LINES
	const regex = toolData.regex || ""
	const query = toolData.query || ""
	// Where it looked: `path/(filePattern)`, as the webview row labels it.
	const scope = toolPayloadSearchScope(toolData)
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const primaryArg = regex || query

	const resultLines = content.split("\n").filter((line) => line.trim())
	const matchCount = resultLines.length
	const visible = resultLines.slice(0, maxResultLines)

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>Search</Text>
						{primaryArg ? <Text>({primaryArg})</Text> : null}
						{scope ? <Text dimColor> {scope}</Text> : null}
					</Text>
					{matchCount > 0 ? (
						<>
							<ResultRow maxLines={1}>{`${matchCount} matches`}</ResultRow>
							{visible.map((line, i) => {
								const match = line.match(/^([^:]+):(\d+):(.*)$/)
								if (match) {
									const [, file, lineNum, context] = match
									return (
										<Box key={i} flexDirection="row">
											<ElbowGutter color={theme.subtle} />
											<Box flexGrow={1}>
												{/* Every part recedes with the row, so each colour
												    is dimmed by value: SGR dim on the parent did
												    nothing to RGB colours in VTE (theme.dimmed). */}
												<Text color={theme.faint}>
													<Text color={theme.dimmed(theme.suggestion)}>{file}</Text>
													<Text color={theme.dimmed(theme.subtle)}>:</Text>
													<Text color={theme.dimmed(theme.warning)}>{lineNum}</Text>
													<Text color={theme.dimmed(theme.subtle)}>:</Text>
													{context}
												</Text>
											</Box>
										</Box>
									)
								}
								return (
									<ResultRow key={i} maxLines={1}>
										{line}
									</ResultRow>
								)
							})}
							{resultLines.length > visible.length && (
								<ResultRow
									maxLines={1}>{`… +${resultLines.length - visible.length} more matches`}</ResultRow>
							)}
						</>
					) : content ? (
						<ResultRow maxLines={maxResultLines}>{content}</ResultRow>
					) : null}
				</Box>
			</Box>
		</Box>
	)
}
