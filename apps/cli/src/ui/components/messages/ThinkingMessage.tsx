import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"

/**
 * Collapsed thinking indicator: dim italic "∴ Thinking…".
 * Content is intentionally NOT shown (collapsed mode only — expand is out of scope).
 */
function ThinkingMessage() {
	return (
		<Box paddingLeft={2}>
			<Text dimColor italic>
				{figures.therefore} Thinking…
			</Text>
		</Box>
	)
}

export default memo(ThinkingMessage)
