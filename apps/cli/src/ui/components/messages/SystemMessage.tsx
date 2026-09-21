import { memo } from "react"
import { Box, Text } from "ink"

import * as theme from "../../theme.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

interface SystemMessageProps {
	content: string
}

/**
 * Subtle one-line system message (dim secondaryText, indent 2).
 */
function SystemMessage({ content }: SystemMessageProps) {
	const sanitized = sanitizeContent(content)

	return (
		<Box paddingLeft={2}>
			<Text dimColor color={theme.secondaryText}>
				{sanitized}
			</Text>
		</Box>
	)
}

export default memo(SystemMessage)
