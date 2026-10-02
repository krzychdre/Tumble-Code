import { createHash, randomUUID } from "crypto"

import { CloudService } from "@tumble-code/cloud"
import { getModelMaxOutputTokens } from "@tumble-code/core/browser"
import type {
	ErrorReport,
	ErrorReportCategory,
	ErrorReportToolCall,
	ModelInfo,
	ProviderSettings,
	TokenUsage,
} from "@tumble-code/types"
import { ERROR_REPORT_MAX_MESSAGE_CHARS, ERROR_REPORT_MAX_TEXT_CHARS } from "@tumble-code/types"

import { getApiErrorStatus } from "../../api/apiErrors"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { logger } from "../../utils/logging"

import {
	type SentMessage,
	apiErrorBody,
	finalizeErrorReport,
	isContextOverflowError,
	summaryLine,
	toReportMessages,
	truncateText,
} from "./errorReportFormat"

/*
 * Error reports: one detailed record per failure in a task, sent to the user's own cloud
 * (POST /api/error-reports) so a problem the user keeps hitting (a model that drops a
 * required parameter, a context window configured too large, an MCP server that times
 * out) can be explained from the request and the answer, not only counted.
 *
 * Privacy rule: nothing happens unless the user is signed in to the cloud. Every entry
 * point checks `isErrorReportingActive()` FIRST; without a session no snapshot is built,
 * nothing is kept in memory and nothing is queued or written to disk.
 *
 * Safety rule: reporting never throws into the task loop and never blocks it. Each entry
 * point catches everything, reads what it needs synchronously and sends in the background.
 *
 * One owner per failure (see ai_plans/2026-10-02_error-reports-extension.md):
 * - a failed API request: TaskApiLoop (first chunk in attemptApiRequest, mid-stream in
 *   handleStreamError; the same error object is never reported twice);
 * - a tool call: the tool-call probe around one complete block in presentAssistantMessage;
 * - empty answer and the consecutive-mistake limit: TaskApiLoop;
 * - tool_result id repair: TaskMessageLog.
 * The `Exception` telemetry event stays as it is; no site sends an `exception` report for
 * a failure that already has one of the categories above.
 */

/** The task members a report reads. `Task` satisfies it; tests pass a plain object. */
export interface ErrorReportTask {
	taskId: string
	api: { getModel(): { id: string; info: ModelInfo } }
	apiConfiguration: ProviderSettings
	apiConversationHistory: readonly SentMessage[]
	getTokenUsage(): TokenUsage
	getTaskMode(): Promise<string>
	providerRef?: WeakRef<{ appProperties?: { appVersion?: string; editorName?: string; platform?: string } }>
	streamProcessor?: {
		assistantMessage: string
		reasoningMessage: string
		inputTokens: number
		outputTokens: number
		cacheReadTokens: number
		cacheWriteTokens: number
		totalCost?: number
	}
	assistantMessageContent?: readonly unknown[]
	userMessageContent?: readonly unknown[]
	abort?: boolean
	didRejectTool?: boolean
}

/** What the last API request sent, kept by reference (no copy) while reporting is active. */
export interface ApiRequestRecord {
	systemPrompt: string
	messages: readonly SentMessage[]
	toolNames: string[]
	params: Record<string, unknown>
}

/** One complete tool call being executed, and the failures noted while it ran. */
export interface ToolCallProbe {
	toolCallId?: string
	toolName: string
	arguments?: string
	notes: string[]
	sawDiffError: boolean
	kind?: ErrorReportCategory
}

interface CaptureState {
	request?: ApiRequestRecord
	toolCalls: ErrorReportToolCall[]
	finishReason?: string
	probe?: ToolCallProbe
	sentPerCategory: Map<ErrorReportCategory, number>
	reportedErrors: WeakSet<object>
}

/**
 * At most this many reports per category and task. A weak model can repeat the same
 * broken call dozens of times (58 missing-`path` apply_diff calls in one owner's history);
 * after this many the pattern is clear and more copies only cost upload and storage.
 */
export const MAX_REPORTS_PER_CATEGORY_PER_TASK = 25

/** Tools whose failure is a failed edit (search block not found, patch did not apply). */
const DIFF_TOOLS: ReadonlySet<string> = new Set([
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
])

/** Created only while reporting is active, so a signed-out user has no entry at all. */
const states = new WeakMap<object, CaptureState>()

/**
 * The cheap gate every entry point checks before doing anything: a cloud session exists
 * and telemetry is not switched off by TUMBLE_CODE_DISABLE_TELEMETRY / ROO_CODE_DISABLE_TELEMETRY.
 */
export function isErrorReportingActive(): boolean {
	try {
		return CloudService.hasInstance() && CloudService.instance.isErrorReportingEnabled()
	} catch {
		return false
	}
}

function activeState(task: object): CaptureState | undefined {
	if (!isErrorReportingActive()) {
		// Signed out since the last capture: forget what was kept for this task.
		states.delete(task)
		return undefined
	}
	let state = states.get(task)
	if (!state) {
		state = { toolCalls: [], sentPerCategory: new Map(), reportedErrors: new WeakSet() }
		states.set(task, state)
	}
	return state
}

function guard(what: string, fn: () => void): void {
	try {
		fn()
	} catch (error) {
		logger.debug(`[ErrorReporter] ${what} failed: ${error instanceof Error ? error.message : String(error)}`)
	}
}

// ---- What the request and the answer looked like ---------------------------------------

/**
 * Remember what an API request sends, for the reports about its failure or its answer.
 * `record` is called only while reporting is active. A new request also starts a new
 * answer, so the streamed tool calls and the stop reason of the previous one are dropped.
 */
export function captureApiRequest(task: object, record: () => ApiRequestRecord): void {
	guard("captureApiRequest", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		state.request = record()
		state.toolCalls = []
		state.finishReason = undefined
	})
}

/** Remember a tool call with its arguments exactly as streamed (before any parsing). */
export function captureStreamedToolCall(task: object, call: ErrorReportToolCall): void {
	guard("captureStreamedToolCall", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		const index = state.toolCalls.findIndex((existing) => call.id !== undefined && existing.id === call.id)
		if (index >= 0) {
			state.toolCalls[index] = call
		} else {
			state.toolCalls.push(call)
		}
	})
}

/** Remember the provider's stop reason (finish_reason) of the current answer. */
export function captureFinishReason(task: object, finishReason: string): void {
	guard("captureFinishReason", () => {
		const state = activeState(task)
		if (state) {
			state.finishReason = finishReason
		}
	})
}

// ---- Snapshot and sending ----------------------------------------------------------------

type ReportFields = Omit<ErrorReport, "id" | "occurredAt" | "taskId">

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

function nonEmpty(text: string | undefined, max: number): string | undefined {
	return text && text.length > 0 ? truncateText(text, max) : undefined
}

/** The tool calls of the current answer, raw when streamed, else rebuilt from the parsed blocks. */
function responseToolCalls(task: ErrorReportTask, state: CaptureState): ErrorReportToolCall[] | undefined {
	const calls =
		state.toolCalls.length > 0
			? state.toolCalls
			: (task.assistantMessageContent ?? []).flatMap((block) => {
					const b = block as {
						type?: string
						id?: string
						name?: string
						nativeArgs?: unknown
						params?: unknown
					}
					if ((b.type !== "tool_use" && b.type !== "mcp_tool_use") || typeof b.name !== "string") {
						return []
					}
					let args = ""
					try {
						args = JSON.stringify(
							b.nativeArgs ?? (b as { arguments?: unknown }).arguments ?? b.params ?? {},
						)
					} catch {
						args = ""
					}
					return [{ ...(b.id ? { id: b.id } : {}), name: b.name, arguments: args }]
				})
	if (calls.length === 0) {
		return undefined
	}
	return calls.map((call) => ({ ...call, arguments: truncateText(call.arguments, ERROR_REPORT_MAX_MESSAGE_CHARS) }))
}

/**
 * Everything the report says about the task, model, request and answer, read NOW: after a
 * mid-task mode switch the task may run another model with another context window, and
 * the report must describe the one that failed.
 */
function snapshot(
	task: ErrorReportTask,
	state: CaptureState,
): Omit<ErrorReport, "id" | "occurredAt" | "category" | "summary"> {
	const model = task.api.getModel()
	const stream = task.streamProcessor
	const request = state.request
	const usage = stream
		? {
				inputTokens: stream.inputTokens,
				outputTokens: stream.outputTokens,
				cacheReadTokens: stream.cacheReadTokens,
				cacheWriteTokens: stream.cacheWriteTokens,
				...(stream.totalCost !== undefined ? { totalCost: stream.totalCost } : {}),
			}
		: undefined
	const hasUsage = usage !== undefined && (usage.inputTokens > 0 || usage.outputTokens > 0)
	const appProperties = task.providerRef?.deref()?.appProperties

	return {
		taskId: task.taskId,
		appVersion: appProperties?.appVersion,
		editorName: appProperties?.editorName,
		platform: appProperties?.platform ?? process.platform,
		provider: task.apiConfiguration?.apiProvider,
		modelId: model.id,
		contextWindow: model.info?.contextWindow,
		maxOutputTokens: getModelMaxOutputTokens({
			modelId: model.id,
			model: model.info,
			settings: task.apiConfiguration,
		}),
		contextTokens: task.getTokenUsage().contextTokens,
		messageCount: task.apiConversationHistory.length,
		request: request
			? {
					systemPromptChars: request.systemPrompt.length,
					systemPromptSha256: sha256(request.systemPrompt),
					toolNames: request.toolNames,
					params: request.params,
					messages: toReportMessages(request.messages),
				}
			: undefined,
		response: {
			text: nonEmpty(stream?.assistantMessage, ERROR_REPORT_MAX_MESSAGE_CHARS),
			reasoning: nonEmpty(stream?.reasoningMessage, ERROR_REPORT_MAX_TEXT_CHARS),
			toolCalls: responseToolCalls(task, state),
			stopReason: state.finishReason,
			usage: hasUsage ? usage : undefined,
		},
	}
}

/** The answer's tool calls plus any extra one the caller knows about (matched by id). */
function mergeToolCalls(
	base: ErrorReportToolCall[] | undefined,
	extra: ErrorReportToolCall[] | undefined,
): ErrorReportToolCall[] | undefined {
	if (!extra || extra.length === 0) {
		return base
	}
	const merged = [...(base ?? [])]
	for (const call of extra) {
		const known = merged.some((existing) =>
			call.id !== undefined ? existing.id === call.id : existing.name === call.name,
		)
		if (!known) {
			merged.push(call)
		}
	}
	return merged
}

function dropEmpty<T extends object>(value: T | undefined): T | undefined {
	if (!value) {
		return undefined
	}
	const entries = Object.entries(value).filter(([, item]) => item !== undefined)
	return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

/**
 * Take the snapshot synchronously, then finish (mode, scrubbing, cap) and send in the
 * background. Never throws, never awaited by the caller.
 */
function dispatch(task: ErrorReportTask, state: CaptureState, fields: ReportFields): void {
	const count = state.sentPerCategory.get(fields.category) ?? 0
	if (count >= MAX_REPORTS_PER_CATEGORY_PER_TASK) {
		return
	}
	state.sentPerCategory.set(fields.category, count + 1)

	const occurredAt = Date.now()
	const base = snapshot(task, state)

	void (async () => {
		const mode = await task.getTaskMode().catch(() => undefined)
		const report = finalizeErrorReport(
			Object.fromEntries(
				Object.entries({
					id: randomUUID(),
					occurredAt,
					...base,
					mode,
					...fields,
					request: dropEmpty(fields.request ?? base.request),
					response: dropEmpty({
						...base.response,
						...dropEmpty(fields.response),
						toolCalls: mergeToolCalls(base.response?.toolCalls, fields.response?.toolCalls),
					}),
				}).filter(([, item]) => item !== undefined),
			) as ErrorReport,
		)
		if (!isErrorReportingActive()) {
			// Signed out between the failure and now: send nothing.
			return
		}
		await CloudService.instance.sendErrorReport(report)
	})().catch((error) => {
		logger.debug(`[ErrorReporter] sending a ${fields.category} report failed: ${error?.message ?? error}`)
	})
}

// ---- Entry points ------------------------------------------------------------------------

function errorMessageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	if (typeof error === "string") {
		return error
	}
	const message = (error as { message?: unknown } | null | undefined)?.message
	return typeof message === "string" ? message : String(error)
}

/**
 * A failed API request attempt. A context-length rejection is filed as `context_overflow`
 * (a context window or max-output setting that does not match the model), every other
 * failure as `api_error`. The same error object is reported once, even when it passes
 * through both the first-chunk and the stream-error path.
 */
export function reportApiError(task: ErrorReportTask, error: unknown, retryAttempt: number): void {
	guard("reportApiError", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		if (error && typeof error === "object") {
			if (state.reportedErrors.has(error)) {
				return
			}
			state.reportedErrors.add(error)
		}
		const message = errorMessageOf(error)
		const httpStatus = getApiErrorStatus(error)
		const category: ErrorReportCategory = isContextOverflowError(error) ? "context_overflow" : "api_error"
		dispatch(task, state, {
			category,
			summary: summaryLine(`${httpStatus ? `${httpStatus} ` : ""}${message || "API request failed"}`),
			errorMessage: message || undefined,
			httpStatus,
			retryAttempt,
			response: { errorBody: apiErrorBody(error) },
		})
	})
}

/** The model answered with nothing usable: no text and no tool call, or text but no tool call twice. */
export function reportEmptyResponse(
	task: ErrorReportTask,
	kind: "no_assistant_messages" | "no_tool_call",
	retryAttempt?: number,
): void {
	guard("reportEmptyResponse", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		dispatch(task, state, {
			category: "empty_response",
			summary:
				kind === "no_assistant_messages"
					? "The model returned no assistant message (no text, no tool call)"
					: "The model answered with text but no tool call, twice in a row",
			errorMessage: kind === "no_assistant_messages" ? "MODEL_NO_ASSISTANT_MESSAGES" : "MODEL_NO_TOOLS_USED",
			retryAttempt,
		})
	})
}

/** The consecutive-mistake limit stopped the task and asked the user for guidance. */
export function reportMistakeLimit(task: ErrorReportTask, detail: { limit: number; lastToolName?: string }): void {
	guard("reportMistakeLimit", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		dispatch(task, state, {
			category: "mistake_limit",
			summary: `Consecutive mistake limit (${detail.limit}) reached${detail.lastToolName ? `, last failing tool: ${detail.lastToolName}` : ""}`,
			toolName: detail.lastToolName,
		})
	})
}

/** The tool_result ids of a user message did not match the tool calls before it and were repaired. */
export function reportToolResultIdRepair(task: ErrorReportTask, error: Error): void {
	guard("reportToolResultIdRepair", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		dispatch(task, state, {
			category: "invalid_tool_call",
			summary: summaryLine(`${error.name}: tool_result ids repaired before sending`),
			errorMessage: error.message,
		})
	})
}

// ---- The tool-call probe -----------------------------------------------------------------

/**
 * Start watching one complete tool call. While it runs, `noteToolFailure` and
 * `noteToolCallKind` (called from the shared error paths: Task.recordToolError, the
 * error says, the missing-parameter helper, the guards) attach to it; `finishToolCallProbe`
 * then decides whether the call failed and sends at most one report for it.
 */
export function beginToolCallProbe(
	task: object,
	block: { id?: string; name: string; nativeArgs?: unknown; params?: unknown; arguments?: unknown },
): ToolCallProbe | undefined {
	let probe: ToolCallProbe | undefined
	guard("beginToolCallProbe", () => {
		const state = activeState(task)
		if (!state) {
			return
		}
		const streamed = block.id ? state.toolCalls.find((call) => call.id === block.id) : undefined
		let args = streamed?.arguments
		if (args === undefined) {
			try {
				args = JSON.stringify(block.nativeArgs ?? block.arguments ?? block.params ?? {})
			} catch {
				args = undefined
			}
		}
		probe = {
			toolCallId: block.id,
			toolName: String(block.name),
			arguments: args,
			notes: [],
			sawDiffError: false,
		}
		state.probe = probe
	})
	return probe
}

/** A failure text produced while the current tool call runs (no-op without a probe). */
export function noteToolFailure(task: object, text: string | undefined, sayType?: string): void {
	const probe = states.get(task)?.probe
	if (!probe) {
		return
	}
	if (sayType === "diff_error") {
		probe.sawDiffError = true
	}
	if (text && !probe.notes.includes(text)) {
		probe.notes.push(text)
	}
}

/** Name the kind of failure of the current tool call (no-op without a probe). */
export function noteToolCallKind(task: object, kind: ErrorReportCategory): void {
	const probe = states.get(task)?.probe
	if (probe && !probe.kind) {
		probe.kind = kind
	}
}

function toolResultText(task: ErrorReportTask, toolCallId: string | undefined): { text?: string; isError: boolean } {
	if (!toolCallId) {
		return { isError: false }
	}
	const id = sanitizeToolUseId(toolCallId)
	const block = (task.userMessageContent ?? []).find((item) => {
		const b = item as { type?: string; tool_use_id?: string }
		return b.type === "tool_result" && b.tool_use_id === id
	}) as { content?: unknown; is_error?: boolean } | undefined
	if (!block) {
		return { isError: false }
	}
	const text =
		typeof block.content === "string"
			? block.content
			: Array.isArray(block.content)
				? block.content
						.filter((part: { type?: string }) => part?.type === "text")
						.map((part: { text?: string }) => part.text ?? "")
						.join("\n")
				: undefined
	return { text, isError: block.is_error === true }
}

/** A tool result that is an error envelope or starts with "Error". */
const ERROR_RESULT_PATTERN = /^\s*(?:Error\b|\{"status":"error")/

/** End the probe of one tool call and report it when it failed. */
export function finishToolCallProbe(task: ErrorReportTask, probe: ToolCallProbe | undefined): void {
	if (!probe) {
		return
	}
	guard("finishToolCallProbe", () => {
		const state = states.get(task)
		if (state?.probe === probe) {
			state.probe = undefined
		}
		// A cancel or a user's rejection is not a failure of the model or of the tool.
		if (!state || task.abort || task.didRejectTool || !isErrorReportingActive()) {
			return
		}
		const result = toolResultText(task, probe.toolCallId)
		const resultIsError = result.isError || ERROR_RESULT_PATTERN.test(result.text ?? "")
		if (probe.notes.length === 0 && !probe.kind && !probe.sawDiffError && !resultIsError) {
			return
		}
		const category: ErrorReportCategory =
			probe.kind ?? (probe.sawDiffError || DIFF_TOOLS.has(probe.toolName) ? "diff_error" : "tool_error")
		const errorMessage = probe.notes.length > 0 ? probe.notes.join("\n\n") : result.text
		dispatch(task, state, {
			category,
			summary: summaryLine(`${probe.toolName}: ${probe.notes[0] ?? result.text ?? category}`),
			errorMessage,
			toolName: probe.toolName,
			toolResult: result.text,
			response: {
				toolCalls:
					probe.arguments !== undefined
						? [
								{
									...(probe.toolCallId ? { id: probe.toolCallId } : {}),
									name: probe.toolName,
									arguments: truncateText(probe.arguments, ERROR_REPORT_MAX_MESSAGE_CHARS),
								},
							]
						: undefined,
			},
		})
	})
}
