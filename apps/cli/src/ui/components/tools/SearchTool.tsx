import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

const MAX_RESULT_LINES = 15

export function SearchTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const regex = toolData.regex || ""
	const query = toolData.query || ""
	const filePattern = toolData.filePattern || ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const primaryArg = regex || query

	const resultLines = content.split("\n").filter((line) => line.trim())
	const matchCount = resultLines.length
	const visible = resultLines.slice(0, MAX_RESULT_LINES)

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>Search</Text>
						{primaryArg ? <Text>({primaryArg})</Text> : null}
						{filePattern ? <Text dimColor> {filePattern}</Text> : null}
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
											<Text dimColor color={theme.subtle}>
												{"  "}
												{figures.elbow}
												{"  "}
											</Text>
											<Box flexGrow={1}>
												<Text dimColor color={theme.secondaryText}>
													<Text color={theme.suggestion}>{file}</Text>
													<Text color={theme.subtle}>:</Text>
													<Text color={theme.warning}>{lineNum}</Text>
													<Text color={theme.subtle}>:</Text>
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
							{resultLines.length > MAX_RESULT_LINES && (
								<ResultRow
									maxLines={
										1
									}>{`… +${resultLines.length - MAX_RESULT_LINES} more matches`}</ResultRow>
							)}
						</>
					) : content ? (
						<ResultRow maxLines={MAX_RESULT_LINES}>{content}</ResultRow>
					) : null}
				</Box>
			</Box>
		</Box>
	)
}
