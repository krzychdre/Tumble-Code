import type OpenAI from "openai"

/**
 * Native tool definitions for search_past_sessions.
 *
 * Two variants with one name: the `scope` parameter exists only when the project's recall
 * scope is `organization`, because only then can "all" reach other projects. Elsewhere the
 * search is always this project, and a weak model is not offered a choice it cannot have.
 * filterNativeToolsForMode picks the variant per request.
 */

const SCOPE_RULE = `- scope "all" (the default) also searches your other projects that share their sessions in the same way; scope "this_project" searches only this project. Start with the default.`

const SCOPE_PARAMETER = `- scope: (optional) "all" or "this_project". Default "all".`

const SCOPED_EXAMPLE = `Example: Only this project, with more results
{ "query": "release changeset", "scope": "this_project", "max_results": 10 }`

const UNSCOPED_EXAMPLE = `Example: More results
{ "query": "release changeset", "max_results": 10 }`

function description(withScope: boolean): string {
	return `Search earlier sessions (other tasks, not this one) of this project: what was asked there, what was concluded and which files were touched. The search runs in Tumble Code Cloud over a short summary of each session. It does not search the project's files and it does not search this task.

Rules:
- Use this when the user refers to earlier work ("like last time", "the fix we did for the bridge", "why did we decide this"), or before solving a problem that may have been solved or tried before.
- Do not use it to find code: use search_files or codebase_search for that. To find something said earlier in THIS task, use search_task_history.
- Write the query as 1 to 4 distinctive words: an identifier, a file name, an error text, a feature name. Every word must appear in a session for it to match, so a long sentence or a question finds nothing. Upper and lower case do not matter.
- If nothing is found, try fewer words or another spelling. If the result says the search was too broad, add one more specific word.${withScope ? `\n${SCOPE_RULE}` : ""}
- Each result has a session_id. To read a session, call read_past_session with that session_id.

What comes back: for each session its session_id, title, project, author, date, whether it was completed, and one or two short snippets of text around the match.

Parameters:
- query: (required) 1 to 4 distinctive words, at most 200 characters.${withScope ? `\n${SCOPE_PARAMETER}` : ""}
- max_results: (optional) How many sessions to return. Default 5, maximum 10.

Example: How a bug was fixed before
{ "query": "retry wrapper timeout" }

Example: Sessions that changed a file
{ "query": "BridgeOrchestrator.ts" }

${withScope ? SCOPED_EXAMPLE : UNSCOPED_EXAMPLE}`
}

const QUERY_PARAMETER_DESCRIPTION = `1 to 4 distinctive words to look for in earlier sessions, for example an identifier, a file name or an error text. Every word must match.`

const SCOPE_PARAMETER_DESCRIPTION = `"all" (default) also searches your other projects that share their sessions; "this_project" searches only this project.`

const MAX_RESULTS_PARAMETER_DESCRIPTION = `How many sessions to return (default 5, maximum 10).`

function definition(withScope: boolean) {
	return {
		type: "function",
		function: {
			name: "search_past_sessions",
			description: description(withScope),
			// Not strict, like search_task_history: strict mode would force a weak model to
			// send every optional parameter on every call.
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: QUERY_PARAMETER_DESCRIPTION },
					...(withScope
						? {
								scope: {
									type: "string",
									enum: ["all", "this_project"],
									description: SCOPE_PARAMETER_DESCRIPTION,
								},
							}
						: {}),
					max_results: { type: "number", description: MAX_RESULTS_PARAMETER_DESCRIPTION },
				},
				required: ["query"],
				additionalProperties: false,
			},
		},
	} satisfies OpenAI.Chat.ChatCompletionTool
}

/** The variant for a project whose recall scope is `organization`. */
export default definition(true)

/** The variant for every other recall scope: the search is always this project. */
export const searchPastSessionsThisProject = definition(false)
