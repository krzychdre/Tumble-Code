import {
	type ErrorReport,
	type ErrorReportMessage,
	ERROR_REPORT_MAX_BODY_BYTES,
	ERROR_REPORT_MAX_MESSAGE_CHARS,
	ERROR_REPORT_MAX_MESSAGES,
	ERROR_REPORT_MAX_SUMMARY_CHARS,
	ERROR_REPORT_MAX_TEXT_CHARS,
} from "@tumble-code/types"

import { getApiErrorStatus } from "../../api/apiErrors"
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling"

/*
 * The pure half of the error reports: classification, secret scrubbing,
 * truncation and the size cap. No task, no cloud, no vscode, so every rule
 * here is unit tested on plain values. ErrorReporter.ts reads the task and
 * sends; see ai_plans/2026-10-02_error-reports-extension.md.
 */

const TRUNCATION_MARK = " [truncated]"

/** `text` cut to `max` characters, the cut marked so a reader knows the end is missing. */
export function truncateText(text: string, max: number): string {
	if (text.length <= max) {
		return text
	}
	return `${text.slice(0, Math.max(0, max - TRUNCATION_MARK.length))}${TRUNCATION_MARK}`
}

/** One line of at most ERROR_REPORT_MAX_SUMMARY_CHARS. */
export function summaryLine(text: string): string {
	const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text
	return truncateText(firstLine.trim(), ERROR_REPORT_MAX_SUMMARY_CHARS)
}

/**
 * Messages that say the request did not fit the model's context window, across providers:
 * OpenAI and every server that copies its wording (vLLM, llama.cpp, LiteLLM, OpenRouter),
 * Anthropic, Gemini, Bedrock and Mistral. The phrases are specific on purpose, so a
 * rate-limit message about "tokens per minute" does not match.
 */
const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
	/maximum context length/i,
	/context[_ ]length[_ ]exceeded/i,
	/exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context(?: window| length| size)?/i,
	/context window (?:is |was |has been )?(?:exceeded|full)/i,
	/prompt is too long/i,
	/input is too long/i,
	/input token count .*exceeds/i,
	/exceeds the maximum number of tokens/i,
	/too large for model with \d+ maximum context length/i,
	/reduce the length of the (?:messages|prompt|input)/i,
	/requested \d+ tokens? .*(?:context|maximum)/i,
	/too many (?:input )?tokens/i,
]

const RATE_LIMIT_PATTERN = /rate.?limit|per min(?:ute)?|\bTPM\b|quota/i

/** The text of an error, its own message first, then a nested provider message. */
function errorText(error: unknown): string {
	if (typeof error === "string") {
		return error
	}
	if (!error || typeof error !== "object") {
		return ""
	}
	const e = error as { message?: unknown; error?: { message?: unknown; error?: { message?: unknown } } }
	return [e.message, e.error?.message, e.error?.error?.message]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join("\n")
}

/**
 * Whether a failed request was rejected because it did not fit the context window: the
 * class of failure that a wrongly configured context window or max-output setting causes.
 * Uses the loop's own detector (the one that triggers the truncation retry) and, because
 * many providers wrap the SDK error in a plain `Error` that loses the status, the message
 * patterns above.
 */
export function isContextOverflowError(error: unknown): boolean {
	try {
		if (checkContextWindowExceededError(error)) {
			return true
		}
		const status = getApiErrorStatus(error)
		if (status === 401 || status === 403 || status === 429) {
			return false
		}
		const text = errorText(error)
		if (!text || RATE_LIMIT_PATTERN.test(text)) {
			return false
		}
		return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text))
	} catch {
		return false
	}
}

function stringifyBody(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined
	}
	if (typeof value === "string") {
		return value
	}
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * The raw error body the provider sent, when the SDK kept it: `error` (OpenAI and
 * Anthropic SDKs), `body`, `responseBody` (AI SDK), `response.data` (axios). Never the
 * headers.
 */
export function apiErrorBody(error: unknown): string | undefined {
	if (!error || typeof error !== "object") {
		return undefined
	}
	const e = error as {
		error?: unknown
		body?: unknown
		responseBody?: unknown
		response?: { data?: unknown }
		cause?: unknown
	}
	const body =
		stringifyBody(e.error) ??
		stringifyBody(e.body) ??
		stringifyBody(e.responseBody) ??
		stringifyBody(e.response?.data) ??
		(e.cause && typeof e.cause === "object" ? stringifyBody((e.cause as { message?: unknown }).message) : undefined)
	return body ? truncateText(body, ERROR_REPORT_MAX_TEXT_CHARS) : undefined
}

/**
 * Removes the obvious secrets from a text: bearer tokens, `api_key: ...`-style pairs,
 * key/token query parameters in URLs and the common provider key shapes. Conversation
 * content goes through it too, so a key the user pasted into a chat is not sent either.
 */
export function scrubSecrets(text: string): string {
	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]")
		.replace(
			/(["']?(?:authorization|x-api-key|api[-_]?key|access[-_]?token|secret[-_]?key|client[-_]?secret|password)["']?\s*[:=]\s*["']?)([^\s"',}&]{4,})/gi,
			"$1[redacted]",
		)
		.replace(/([?&](?:key|api[-_]?key|token|access_token|auth|sig|signature)=)[^&\s"'#]+/gi, "$1[redacted]")
		.replace(/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}/g, "[redacted-key]")
		.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]")
		.replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[redacted-key]")
		.replace(/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted-key]")
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]")
}

/** Every string in a JSON-like value passed through `scrubSecrets`. */
function scrubDeep<T>(value: T): T {
	if (typeof value === "string") {
		return scrubSecrets(value) as T
	}
	if (Array.isArray(value)) {
		return value.map((item) => scrubDeep(item)) as T
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubDeep(item)])) as T
	}
	return value
}

/** A conversation message as the API saw it: a role and a string or block content. */
export interface SentMessage {
	role: string
	content: unknown
}

function reportRole(role: string): ErrorReportMessage["role"] {
	return role === "assistant" || role === "system" || role === "tool" ? role : "user"
}

/**
 * The tail of the conversation as sent: the last ERROR_REPORT_MAX_MESSAGES messages, each
 * content JSON-stringified (a plain string stays as it is) and cut to
 * ERROR_REPORT_MAX_MESSAGE_CHARS.
 */
export function toReportMessages(messages: readonly SentMessage[]): ErrorReportMessage[] {
	return messages.slice(-ERROR_REPORT_MAX_MESSAGES).map((message) => ({
		role: reportRole(message.role),
		content: truncateText(
			typeof message.content === "string" ? message.content : (stringifyBody(message.content) ?? ""),
			ERROR_REPORT_MAX_MESSAGE_CHARS,
		),
	}))
}

function bodyBytes(report: ErrorReport): number {
	return Buffer.byteLength(JSON.stringify(report), "utf8")
}

/** Drop optional fields that ended up undefined: the wire contract omits them, never sends null. */
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

/**
 * Cuts a report to `maxBytes` of JSON: first the oldest conversation messages go, then the
 * long text fields are halved until it fits (the summary and the identifiers are never cut).
 */
export function capErrorReport(report: ErrorReport, maxBytes: number = ERROR_REPORT_MAX_BODY_BYTES): ErrorReport {
	let capped: ErrorReport = {
		...report,
		...(report.request ? { request: { ...report.request } } : {}),
		...(report.response ? { response: { ...report.response } } : {}),
	}

	while (bodyBytes(capped) > maxBytes && (capped.request?.messages?.length ?? 0) > 1) {
		capped.request = { ...capped.request, messages: capped.request!.messages!.slice(1) }
	}

	let limit = ERROR_REPORT_MAX_MESSAGE_CHARS
	while (bodyBytes(capped) > maxBytes && limit > 64) {
		limit = Math.floor(limit / 2)
		const cut = (text: string | undefined) => (text === undefined ? undefined : truncateText(text, limit))
		capped = {
			...capped,
			errorMessage: cut(capped.errorMessage),
			toolResult: cut(capped.toolResult),
			...(capped.request
				? {
						request: {
							...capped.request,
							messages: capped.request.messages?.map((message) => ({
								...message,
								content: truncateText(message.content, limit),
							})),
						},
					}
				: {}),
			...(capped.response
				? {
						response: withoutUndefined({
							...capped.response,
							text: cut(capped.response.text),
							reasoning: cut(capped.response.reasoning),
							errorBody: cut(capped.response.errorBody),
							toolCalls: capped.response.toolCalls?.map((call) => ({
								...call,
								arguments: truncateText(call.arguments, limit),
							})),
						}),
					}
				: {}),
		}
		capped = withoutUndefined(capped)
	}

	if (bodyBytes(capped) > maxBytes && capped.request) {
		// Still too big (a huge tool list or params): the request part goes last.
		capped = { ...capped, request: { systemPromptChars: capped.request.systemPromptChars } }
	}

	return capped
}

/**
 * The last step before sending: field limits of the wire contract, secrets scrubbed from
 * every string, then the size cap.
 */
export function finalizeErrorReport(report: ErrorReport): ErrorReport {
	// Scrub first: a replacement can be longer than the secret it replaces, and the limits
	// below must hold for what is actually sent.
	const scrubbed = scrubDeep(report)
	const limited: ErrorReport = withoutUndefined({
		...scrubbed,
		summary: summaryLine(scrubbed.summary),
		errorMessage:
			scrubbed.errorMessage === undefined
				? undefined
				: truncateText(scrubbed.errorMessage, ERROR_REPORT_MAX_TEXT_CHARS),
		toolResult:
			scrubbed.toolResult === undefined
				? undefined
				: truncateText(scrubbed.toolResult, ERROR_REPORT_MAX_TEXT_CHARS),
	})
	return capErrorReport(limited)
}
