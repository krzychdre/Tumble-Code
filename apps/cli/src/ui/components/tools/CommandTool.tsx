import { Box, Text } from "ink"

import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

const MAX_OUTPUT_LINES = 10

export function CommandTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const command = toolData.command || ""
	const output = toolData.output ? sanitizeContent(toolData.output) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const displayOutput = output || content

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap="truncate-end">
						<Text bold>Bash</Text>
						{command ? <Text>({command})</Text> : null}
					</Text>
					{displayOutput && <ResultRow maxLines={MAX_OUTPUT_LINES}>{displayOutput}</ResultRow>}
				</Box>
			</Box>
		</Box>
	)
}
