import { memo } from "react"
import { Box } from "ink"

import Markdown from "../Markdown.js"
import Bullet from "../primitives/Bullet.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

interface AssistantMessageProps {
	content: string
	/** Add top margin (used between turns). */
	addMargin?: boolean
	/**
	 * The rest of a message whose beginning is already on screen (printed in
	 * chunks while it streamed): no bullet, just its indent, and nothing at all
	 * when there is no text, instead of the "…" placeholder.
	 */
	continuation?: boolean
}

/**
 * Assistant text: plain bullet + markdown body.
 * Empty/whitespace content falls back to "…" so empty turns show something.
 */
function AssistantMessage({ content, addMargin = false, continuation = false }: AssistantMessageProps) {
	const sanitized = sanitizeContent(content)
	if (continuation && sanitized.trim() === "") {
		return null
	}
	const display = sanitized.trim() === "" ? "…" : sanitized

	return (
		<Box marginTop={addMargin && !continuation ? 1 : 0}>
			{continuation ? <Box minWidth={2} /> : <Bullet status="plain" />}
			<Box flexDirection="column" flexGrow={1}>
				<Markdown>{display}</Markdown>
			</Box>
		</Box>
	)
}

export default memo(AssistantMessage)
