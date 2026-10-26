import type { RecallSearchResponse, RecallSession } from "@tumble-code/cloud"

/**
 * The tool results of search_past_sessions and read_past_session: compact text a model can
 * act on, for the answers and for every failure of the recall API.
 */

export const PAST_SESSION_DEFAULTS = {
	DEFAULT_MAX_RESULTS: 5,
	MAX_RESULTS: 10,
} as const

/** Keeps a hit near 150 tokens: a short title and two snippets of about 50 tokens each. */
const TITLE_CHARS = 100
const SNIPPET_CHARS = 220

export type RecallToolName = "search_past_sessions" | "read_past_session"

export function clampPastSessionResults(value: number | undefined): number {
	const wanted = Math.floor(value ?? PAST_SESSION_DEFAULTS.DEFAULT_MAX_RESULTS)
	return Math.min(PAST_SESSION_DEFAULTS.MAX_RESULTS, Math.max(1, wanted))
}

/** A scope the API knows, or undefined for the cloud's default (`all`). */
export function searchScopeOf(value: string | undefined): "this_project" | "all" | undefined {
	return value === "this_project" || value === "all" ? value : undefined
}

/** A part the API knows, or undefined for the cloud's default (`summary`). */
export function sessionPartOf(value: string | undefined): RecallSession["part"] | undefined {
	return value === "summary" || value === "conversation" ? value : undefined
}

/** One line, cut to `max` characters. */
function oneLine(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim()
	return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

const day = (timestamp: string) => timestamp.slice(0, 10)

export function formatPastSessionHits(query: string, response: RecallSearchResponse): string {
	if (response.tooBroad) {
		return `The search for "${query}" was too broad and was stopped before it finished. Add one more specific word (an identifier, a file name, an error text) and search again.`
	}
	if (response.results.length === 0) {
		return `No past session matches "${query}". Try fewer words or another spelling (an identifier, a file name, an error text). If that finds nothing either, continue without past sessions.`
	}

	const hits = response.results.map((hit, index) =>
		[
			`${index + 1}. ${oneLine(hit.title, TITLE_CHARS)} (${hit.completed ? "completed" : "not completed"})`,
			`   session_id: ${hit.sessionId} | project: ${hit.projectName} | author: ${hit.author} | ${day(hit.lastActivity)}`,
			...hit.snippets.slice(0, 2).map((snippet) => `   "${oneLine(snippet, SNIPPET_CHARS)}"`),
		].join("\n"),
	)
	const count = response.results.length === 1 ? "1 past session" : `${response.results.length} past sessions`
	return `Found ${count} for "${query}". To read one, call read_past_session with its session_id.\n\n${hits.join("\n\n")}`
}

export function formatPastSessionPage(page: RecallSession): string {
	const header = `Past session ${page.sessionId}: ${oneLine(page.title, TITLE_CHARS)}\nProject: ${page.projectName} | Author: ${page.author} | Last activity: ${day(page.lastActivity)} | Part: ${page.part}`

	let footer: string
	if (page.part === "summary") {
		footer = `For the user's messages and results in order, call read_past_session with ${JSON.stringify({ session_id: page.sessionId, part: "conversation" })}.`
	} else if (page.nextOffset === null) {
		footer = "This is the end of the conversation."
	} else {
		footer = `More of this conversation follows. To read it, call read_past_session with ${JSON.stringify({ session_id: page.sessionId, part: "conversation", offset: page.nextOffset })}.`
	}

	return `${header}\n\n${page.text}\n\n${footer}`
}

export interface RecallFailure {
	message: string
	/** The model sent something the API rejected, rather than the cloud being unable to answer. */
	modelMistake: boolean
}

/** The tool result for a failed recall call, by its HTTP status (undefined: no answer at all). */
export function describeRecallFailure(statusCode: number | undefined, tool: RecallToolName): RecallFailure {
	switch (statusCode) {
		case 401:
			return {
				message:
					"Past sessions are in Tumble Code Cloud, and the user is not signed in to it (or the sign-in expired). Continue without past sessions; if they matter, tell the user to sign in to Tumble Code Cloud.",
				modelMistake: false,
			}
		case 404:
			return tool === "search_past_sessions"
				? {
						message:
							"Recall of past sessions is turned off for this project. Do not call search_past_sessions again in this task; continue without it.",
						modelMistake: false,
					}
				: {
						message:
							"No such session: it does not exist, or you may not read it. Use a session_id copied exactly from a search_past_sessions result.",
						modelMistake: true,
					}
		case 429:
			return {
				message:
					"Too many requests to Tumble Code Cloud in a short time. Wait about a minute before the next call, or continue with what you already have.",
				modelMistake: false,
			}
		// FastAPI answers 422 when a query parameter fails its validation.
		case 400:
		case 422:
			return {
				message:
					tool === "search_past_sessions"
						? "The query was rejected: it must not be empty and must be at most 200 characters. Retry with 1 to 4 distinctive words."
						: 'The arguments were rejected: part must be "summary" or "conversation", and offset a number given at the end of a previous page.',
				modelMistake: true,
			}
		default:
			return {
				message: `Tumble Code Cloud could not be reached${statusCode === undefined ? " (offline, or it did not answer in time)" : ` (it answered HTTP ${statusCode})`}. Continue without past sessions.`,
				modelMistake: false,
			}
	}
}
