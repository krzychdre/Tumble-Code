/**
 * An estimate of the tokens the model has sent in the request still
 * streaming. An OpenAI-compatible server reports a request's tokens only with
 * its last chunk, so the real count reaches the spinner when the step ends;
 * until then the spinner counts what has streamed in.
 */

import type { TUIMessage } from "../types.js"

/** Characters per token: the usual rule of thumb for English text and code. */
const CHARS_PER_TOKEN = 4

/** Rows the model writes in a request: its answer, its reasoning and its tool calls. */
const MODEL_OUTPUT_ROLES = new Set<TUIMessage["role"]>(["assistant", "thinking", "tool"])

/** Rows of those roles that the model did not write (a command's output, an MCP server's answer). */
const NOT_MODEL_OUTPUT = new Set<string>(["command_output", "mcp_server_response", "user_feedback"])

/**
 * The estimated output tokens of the request that began at `stepStartedAt`
 * (the ts of its `api_req_started`). Rows from the extension carry their ts
 * as their id; rows the CLI adds itself (ids that are not numbers) are
 * skipped, and the walk stops at the first row older than the step.
 */
export function estimateStepOutputTokens(messages: readonly TUIMessage[], stepStartedAt: number): number {
	let chars = 0

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!
		const ts = Number(message.id)

		if (!Number.isFinite(ts)) {
			continue
		}
		if (ts < stepStartedAt) {
			break
		}
		if (MODEL_OUTPUT_ROLES.has(message.role) && !NOT_MODEL_OUTPUT.has(message.originalType ?? "")) {
			// A tool row shows a summary; a file the model writes is in its toolData.
			const written = message.toolData?.content ?? message.toolData?.diff ?? ""
			chars += message.content.length + written.length
		}
	}

	return Math.round(chars / CHARS_PER_TOKEN)
}
