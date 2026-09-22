import { Box } from "ink"

import Bullet from "../primitives/Bullet.js"
import Markdown from "../Markdown.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

/**
 * Render attempt_completion / ask_followup_question as an assistant-style
 * bullet + markdown body (success-green bullet). Question vs completion both
 * render the text via Markdown.
 */
export function CompletionTool({ toolData, message }: ToolRendererProps) {
	const status = toolStatusFromMessage(message)
	const result = toolData.result ? sanitizeContent(toolData.result) : ""
	const question = toolData.question ? sanitizeContent(toolData.question) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const displayContent = result || question || content

	if (!displayContent) {
		return null
	}

	return (
		<Box>
			<Bullet status={status} />
			<Box flexDirection="column" flexGrow={1}>
				<Markdown>{displayContent}</Markdown>
			</Box>
		</Box>
	)
}
