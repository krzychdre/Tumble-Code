import { memo } from "react"
import { Box } from "ink"

import Markdown from "../Markdown.js"
import Bullet from "../primitives/Bullet.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

interface AssistantMessageProps {
	content: string
	/** Add top margin (used between turns). */
	addMargin?: boolean
}

/**
 * Assistant text: plain bullet + markdown body.
 * Empty/whitespace content falls back to "…" so empty turns show something.
 */
function AssistantMessage({ content, addMargin = false }: AssistantMessageProps) {
	const sanitized = sanitizeContent(content)
	const display = sanitized.trim() === "" ? "…" : sanitized

	return (
		<Box marginTop={addMargin ? 1 : 0}>
			<Bullet status="plain" />
			<Box flexDirection="column" flexGrow={1}>
				<Markdown>{display}</Markdown>
			</Box>
		</Box>
	)
}

export default memo(AssistantMessage)
