import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

const MAX_CONTENT_LENGTH = 10000
const HEAD_TAIL_LENGTH = 5000

/**
 * Truncate very long content to head 5000 + "… [+N chars] …" + tail 5000.
 * N = total - 10000 (the amount dropped from the middle).
 */
function truncateLongContent(text: string): string {
	if (text.length <= MAX_CONTENT_LENGTH) {
		return text
	}
	const head = text.slice(0, HEAD_TAIL_LENGTH)
	const tail = text.slice(text.length - HEAD_TAIL_LENGTH)
	const dropped = text.length - MAX_CONTENT_LENGTH
	return `${head}\n… [+${dropped} chars] …\n${tail}`
}

interface UserMessageProps {
	content: string
}

/**
 * User prompt echo: slate band, orange pointer and bold text, so every turn
 * boundary is visible at a glance between the assistant's white text.
 * Content >10k chars is truncated to head 5k + "… [+N chars] …" + tail 5k.
 */
function UserMessage({ content }: UserMessageProps) {
	const sanitized = sanitizeContent(truncateLongContent(content))

	return (
		<Box backgroundColor={theme.userMessageBg} paddingRight={1}>
			<Text bold color={theme.brand}>
				{figures.pointer}{" "}
			</Text>
			<Text bold color={theme.text}>
				{sanitized}
			</Text>
		</Box>
	)
}

export default memo(UserMessage)
