import type OpenAI from "openai"

/** Native tool definition for read_past_session, the follow-up of search_past_sessions. */

const READ_PAST_SESSION_DESCRIPTION = `Read one earlier session that search_past_sessions found. Use it when a search result looks relevant and its snippets are not enough.

Rules:
- Copy session_id exactly from a search_past_sessions result. Never make one up.
- part "summary" (the default) returns the session's short summary: its title, the request, the final results and the files it touched. Start with it; it is usually enough.
- part "conversation" returns the user's messages and the completion results in order, never tool output, 8000 characters per page. When there is more, the result ends with the offset of the next page: call again with that offset.
- This reads earlier sessions only. To read a file of the project, use read_file.

Parameters:
- session_id: (required) The session_id from a search_past_sessions result.
- part: (optional) "summary" or "conversation". Default "summary".
- offset: (optional) Where the next page of the conversation starts, as given at the end of the previous page. Default 0.

Example: The summary of a session
{ "session_id": "0199c7e2-5b1a-7c3e-9f00-2d4e6a8b1c3f" }

Example: The second page of its conversation
{ "session_id": "0199c7e2-5b1a-7c3e-9f00-2d4e6a8b1c3f", "part": "conversation", "offset": 8000 }`

export default {
	type: "function",
	function: {
		name: "read_past_session",
		description: READ_PAST_SESSION_DESCRIPTION,
		// Not strict, like search_past_sessions.
		parameters: {
			type: "object",
			properties: {
				session_id: {
					type: "string",
					description: "The session_id from a search_past_sessions result, copied exactly.",
				},
				part: {
					type: "string",
					enum: ["summary", "conversation"],
					description: `"summary" (default) for the short summary, "conversation" for the user's messages and results.`,
				},
				offset: {
					type: "number",
					description:
						"Where the next page of the conversation starts, from the end of the previous page (default 0).",
				},
			},
			required: ["session_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
