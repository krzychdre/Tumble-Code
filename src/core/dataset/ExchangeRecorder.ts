import { createHash, randomUUID } from "crypto"

import { CloudService } from "@tumble-code/cloud"
import type {
	LlmArrayDelta,
	LlmBlobRef,
	LlmExchange,
	LlmToolOutcome,
	LlmUsage,
	LlmWireField,
	LlmWireRequest,
} from "@tumble-code/types"

import { getApiErrorStatus } from "../../api/apiErrors"
import type { WireRequest, WireRequestSink } from "../../api/providers/utils/wire-capture"
import { logger } from "../../utils/logging"
import { isErrorReportingActive, peekCapturedAnswer } from "../diagnostics/ErrorReporter"
import { apiErrorBody } from "../diagnostics/errorReportFormat"

/*
 * LLM exchange recording: every request the task loop sends to the model and its answer,
 * uploaded to the user's own cloud so a training dataset can be exported from real runs
 * and every request reconstructed exactly (ai_plans/2026-10-02_llm-exchange-dataset.md).
 *
 * Privacy rule: nothing is built unless the user is signed in to the cloud (the error
 * report gate) and has not switched recording off there. While the switch is still
 * unknown the exchange is captured and the send step asks the cloud; "off" drops it.
 *
 * Safety rule: recording never throws into the task loop and never blocks it. The
 * conversation is serialized synchronously when the request is built (so a later change
 * of the history cannot alter the record); hashing, delta building and the upload run in
 * one promise chain per task, in order.
 *
 * Storage is incremental: each exchange names the last exchange of its task the server
 * accepted (`baseId`) and carries only the messages after the common prefix, plus blobs
 * (system prompt, tools, large wire fields) the chain has not sent yet. A failed upload,
 * a task resumed after a restart or MAX_CHAIN_LENGTH exchanges start a full snapshot.
 */

/** The task members the recorder reads. `Task` satisfies it; tests pass a plain object. */
export interface ExchangeTask {
	taskId: string
	parentTaskId?: string
	rootTaskId?: string
	cwd?: string
	api: { getModel(): { id: string } }
	apiConfiguration?: { apiProvider?: string }
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
}

/** What `TaskApiLoop.attemptApiRequest` hands to the provider. */
export interface CanonicalRequest {
	systemPrompt: string
	/** The conversation exactly as sent (`cleanConversationHistory`). */
	messages: readonly unknown[]
	/** The tools array as sent (OpenAI function format). */
	tools: readonly unknown[]
	mode?: string
	params: Record<string, unknown>
}

/** A chain longer than this starts again with a full snapshot (bounds the server's walk). */
export const MAX_CHAIN_LENGTH = 50

/** A wire field whose JSON is longer than this travels as a blob (sent once per chain). */
const WIRE_INLINE_MAX_CHARS = 2_048

/** The wire body keys that hold the conversation, delta-encoded like the canonical messages. */
const WIRE_CONVERSATION_KEYS: ReadonlySet<string> = new Set(["messages", "input", "contents"])

/** The request as it was when built: serialized, so nothing later can change it. */
interface Capture {
	id: string
	sequence: number
	occurredAt: number
	retryAttempt: number
	meta: Pick<
		LlmExchange,
		| "taskId"
		| "parentTaskId"
		| "rootTaskId"
		| "mode"
		| "provider"
		| "modelId"
		| "appVersion"
		| "editorName"
		| "platform"
		| "workspacePath"
	>
	system: string
	toolsJson: string
	messageJsons: string[]
	params: Record<string, unknown>
	wire?: WireRequest
}

interface Pending {
	capture: Capture
	/** The first record (request and answer) is queued. */
	sent: boolean
	/** The outcome record is queued. */
	outcomeSent: boolean
	/** The server accepted the first record; an outcome is sent only then. */
	delivered?: Promise<boolean>
}

/** What the server holds of the task's chain: the last accepted exchange. */
interface Chain {
	lastId: string
	length: number
	messageHashes: string[]
	wireArrays: Map<string, string[]>
	blobs: Set<string>
}

interface RecorderState {
	sequence: number
	pending?: Pending
	chain?: Chain
	queue: Promise<void>
}

const states = new WeakMap<object, RecorderState>()

/**
 * The cheap gate: the error report gate (signed in, telemetry not off by the environment)
 * and the user's recording switch not known to be off. Never throws.
 */
export function isExchangeRecordingActive(): boolean {
	try {
		return isErrorReportingActive() && CloudService.instance.getExchangeRecordingState() !== false
	} catch {
		return false
	}
}

function recorderState(task: object): RecorderState | undefined {
	if (!isExchangeRecordingActive()) {
		// Signed out or switched off since the last capture: forget the task's chain.
		states.delete(task)
		return undefined
	}
	let state = states.get(task)
	if (!state) {
		state = { sequence: 0, queue: Promise.resolve() }
		states.set(task, state)
	}
	return state
}

function guard(what: string, fn: () => void): void {
	try {
		fn()
	} catch (error) {
		logger.debug(`[ExchangeRecorder] ${what} failed: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function enqueue(state: RecorderState, what: string, step: () => Promise<void>): void {
	state.queue = state.queue.then(step).catch((error) => {
		logger.debug(`[ExchangeRecorder] ${what} failed: ${error instanceof Error ? error.message : String(error)}`)
	})
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

function commonPrefix(a: readonly string[] | undefined, b: readonly string[]): number {
	if (!a) {
		return 0
	}
	let n = 0
	while (n < a.length && n < b.length && a[n] === b[n]) {
		n++
	}
	return n
}

// ---- Capture --------------------------------------------------------------------------

/**
 * Start recording one request. `build` is called only while recording is active. Returns
 * the sink for the exact HTTP body (`runWithWireCapture`), or undefined when not recording.
 * A previous exchange of the task that was never finished is flushed first.
 */
export function beginExchange(
	task: ExchangeTask,
	retryAttempt: number,
	build: () => CanonicalRequest,
): WireRequestSink | undefined {
	let sink: WireRequestSink | undefined
	guard("beginExchange", () => {
		const state = recorderState(task)
		if (!state) {
			return
		}
		flushPending(task, state)

		const request = build()
		const appProperties = task.providerRef?.deref()?.appProperties
		const capture: Capture = {
			id: randomUUID(),
			sequence: state.sequence++,
			occurredAt: Date.now(),
			retryAttempt,
			meta: {
				taskId: task.taskId,
				parentTaskId: task.parentTaskId,
				rootTaskId: task.rootTaskId,
				mode: request.mode,
				provider: task.apiConfiguration?.apiProvider,
				modelId: task.api.getModel().id,
				appVersion: appProperties?.appVersion,
				editorName: appProperties?.editorName,
				platform: appProperties?.platform ?? process.platform,
				workspacePath: task.cwd,
			},
			system: request.systemPrompt,
			toolsJson: JSON.stringify(request.tools),
			messageJsons: request.messages.map((message) => JSON.stringify(message)),
			params: JSON.parse(JSON.stringify(request.params)),
		}
		const pending: Pending = { capture, sent: false, outcomeSent: false }
		state.pending = pending
		sink = (wire) => {
			// A provider's internal retry sends again: the last attempt is the one answered.
			if (!pending.sent) {
				capture.wire = wire
			}
		}
	})
	return sink
}

function usageOf(task: ExchangeTask): LlmUsage | undefined {
	const stream = task.streamProcessor
	if (!stream || (stream.inputTokens <= 0 && stream.outputTokens <= 0)) {
		return undefined
	}
	return {
		inputTokens: stream.inputTokens,
		outputTokens: stream.outputTokens,
		cacheReadTokens: stream.cacheReadTokens,
		cacheWriteTokens: stream.cacheWriteTokens,
		...(stream.totalCost !== undefined ? { totalCost: stream.totalCost } : {}),
	}
}

/** The answer as it stands now (complete, or partial when the stream failed). */
function responseOf(task: ExchangeTask): LlmExchange["response"] {
	const stream = task.streamProcessor
	const answer = peekCapturedAnswer(task)
	const toolCalls = answer?.toolCalls ?? []
	const usage = usageOf(task)
	return {
		...(stream?.assistantMessage ? { text: stream.assistantMessage } : {}),
		...(stream?.reasoningMessage ? { reasoning: stream.reasoningMessage } : {}),
		...(toolCalls.length > 0 ? { toolCalls } : {}),
		...(answer?.finishReason ? { finishReason: answer.finishReason } : {}),
		...(usage ? { usage } : {}),
	}
}

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

function send(
	state: RecorderState,
	pending: Pending,
	status: LlmExchange["status"],
	response: LlmExchange["response"],
	error?: LlmExchange["error"],
): void {
	pending.sent = true
	const finishedAt = Date.now()
	let resolveDelivered: (ok: boolean) => void = () => {}
	pending.delivered = new Promise((resolve) => (resolveDelivered = resolve))
	enqueue(state, "sending an exchange", async () => {
		try {
			resolveDelivered(await deliver(state, pending.capture, status, response, error, finishedAt))
		} catch (err) {
			state.chain = undefined
			resolveDelivered(false)
			throw err
		}
	})
}

async function deliver(
	state: RecorderState,
	capture: Capture,
	status: LlmExchange["status"],
	response: LlmExchange["response"],
	error: LlmExchange["error"] | undefined,
	finishedAt: number,
): Promise<boolean> {
	if (!(await CloudService.instance.resolveExchangeRecording())) {
		// Switched off (or signed out): drop it, and the chain the server never saw.
		state.chain = undefined
		return false
	}
	const { exchange, chain } = buildExchange(state.chain, capture, status, response, error, finishedAt)
	const ok = await CloudService.instance.sendLlmExchange(exchange)
	// Not accepted: the server may lack this exchange, so nothing may build on it.
	state.chain = ok ? chain : undefined
	return ok
}

/** The request and its answer are complete (the stream ended normally). */
export function completeExchange(task: ExchangeTask): void {
	guard("completeExchange", () => {
		const state = states.get(task)
		const pending = state?.pending
		if (!state || !pending || pending.sent) {
			return
		}
		send(state, pending, "completed", responseOf(task))
	})
}

/** The request failed (first chunk or mid-stream), or was cancelled. Sends what was answered. */
export function failExchange(task: ExchangeTask, error: unknown, aborted: boolean): void {
	guard("failExchange", () => {
		const state = states.get(task)
		const pending = state?.pending
		if (!state || !pending || pending.sent) {
			return
		}
		const httpStatus = getApiErrorStatus(error)
		const body = aborted ? undefined : apiErrorBody(error)
		send(state, pending, aborted ? "aborted" : "error", responseOf(task), {
			message: errorMessageOf(error) || (aborted ? "aborted" : "API request failed"),
			...(httpStatus !== undefined ? { httpStatus } : {}),
			...(body ? { body } : {}),
		})
	})
}

function sendOutcome(task: ExchangeTask, state: RecorderState, pending: Pending, outcomes: LlmToolOutcome[]): void {
	pending.outcomeSent = true
	const usage = usageOf(task)
	const delivered = pending.delivered ?? Promise.resolve(false)
	enqueue(state, "sending an outcome", async () => {
		if (!(await delivered)) {
			return
		}
		await CloudService.instance.sendLlmExchangeOutcome({
			exchangeId: pending.capture.id,
			taskId: pending.capture.meta.taskId,
			toolResults: outcomes,
			...(usage ? { usage } : {}),
		})
	})
}

/** The tools of the answer have run: record how each call went and the final usage. */
export function finishExchangeTurn(task: ExchangeTask): void {
	guard("finishExchangeTurn", () => {
		const state = states.get(task)
		const pending = state?.pending
		if (!state || !pending || !pending.sent || pending.outcomeSent) {
			return
		}
		sendOutcome(task, state, pending, peekCapturedAnswer(task)?.toolOutcomes ?? [])
	})
}

/** Send what the last exchange still owes: the record itself (as aborted) or its outcome. */
function flushPending(task: ExchangeTask, state: RecorderState): void {
	const pending = state.pending
	if (!pending) {
		return
	}
	if (!pending.sent) {
		send(state, pending, "aborted", responseOf(task), { message: "the request ended without an answer" })
		return
	}
	if (!pending.outcomeSent) {
		const outcomes = peekCapturedAnswer(task)?.toolOutcomes ?? []
		if (outcomes.length > 0) {
			sendOutcome(task, state, pending, outcomes)
		}
	}
}

/** The task is going away: send what its last exchange still owes. */
export function flushExchanges(task: ExchangeTask): void {
	guard("flushExchanges", () => {
		const state = states.get(task)
		if (state) {
			flushPending(task, state)
		}
	})
}

// ---- The delta -------------------------------------------------------------------------

/** The URL without its query string or credentials. */
function sanitizeUrl(url: string): string {
	try {
		const parsed = new URL(url)
		return `${parsed.origin}${parsed.pathname}`
	} catch {
		return ""
	}
}

function wireFormat(url: string): LlmWireRequest["format"] {
	if (/\/chat\/completions$/.test(url)) {
		return "openai-chat"
	}
	if (/\/messages$/.test(url) || /:(?:stream)?rawPredict$/.test(url)) {
		return "anthropic-messages"
	}
	if (/\/responses$/.test(url)) {
		return "openai-responses"
	}
	return "other"
}

function buildWire(
	wire: WireRequest,
	base: Chain | undefined,
	blobRef: (text: string) => LlmBlobRef,
): { request: LlmWireRequest; arrays: Map<string, string[]> } {
	const url = sanitizeUrl(wire.url)
	const arrays = new Map<string, string[]>()
	const request: LlmWireRequest = {
		url,
		format: wireFormat(url),
		bodySha256: sha256(wire.body),
		bodyBytes: Buffer.byteLength(wire.body, "utf8"),
	}
	let body: unknown
	try {
		body = JSON.parse(wire.body)
	} catch {
		return { request, arrays }
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { request, arrays }
	}
	request.fields = Object.entries(body as Record<string, unknown>).map(([key, value]): LlmWireField => {
		if (Array.isArray(value) && WIRE_CONVERSATION_KEYS.has(key)) {
			const hashes = value.map((item) => sha256(JSON.stringify(item)))
			const keep = commonPrefix(base?.wireArrays.get(key), hashes)
			arrays.set(key, hashes)
			return { key, kind: "array", delta: { keep, append: value.slice(keep) } }
		}
		const json = JSON.stringify(value)
		if (json.length > WIRE_INLINE_MAX_CHARS) {
			return { key, kind: "blob", blob: blobRef(json) }
		}
		return { key, kind: "value", value }
	})
	return { request, arrays }
}

/**
 * The exchange as sent: a delta against `previous` (the last exchange the server
 * accepted), or a full snapshot when there is none or the chain is long. Also returns the
 * chain state to keep when the server accepts it.
 */
function buildExchange(
	previous: Chain | undefined,
	capture: Capture,
	status: LlmExchange["status"],
	response: LlmExchange["response"],
	error: LlmExchange["error"] | undefined,
	finishedAt: number,
): { exchange: LlmExchange; chain: Chain } {
	const base = previous && previous.length < MAX_CHAIN_LENGTH ? previous : undefined
	const blobs = new Set(base?.blobs ?? [])
	const blobRef = (text: string): LlmBlobRef => {
		const hash = sha256(text)
		if (blobs.has(hash)) {
			return { sha256: hash }
		}
		blobs.add(hash)
		return { sha256: hash, text }
	}

	const messageHashes = capture.messageJsons.map(sha256)
	const keep = commonPrefix(base?.messageHashes, messageHashes)
	const messages: LlmArrayDelta = {
		keep,
		append: capture.messageJsons.slice(keep).map((json) => JSON.parse(json)),
	}
	const wire = capture.wire ? buildWire(capture.wire, base, blobRef) : undefined

	const meta = Object.fromEntries(
		Object.entries(capture.meta).filter(([, value]) => value !== undefined && value !== ""),
	) as Capture["meta"]

	const exchange: LlmExchange = {
		id: capture.id,
		...(base ? { baseId: base.lastId } : {}),
		...meta,
		sequence: capture.sequence,
		occurredAt: capture.occurredAt,
		durationMs: Math.max(0, finishedAt - capture.occurredAt),
		retryAttempt: capture.retryAttempt,
		request: {
			system: blobRef(capture.system),
			tools: blobRef(capture.toolsJson),
			messages,
			messageCount: capture.messageJsons.length,
			params: capture.params,
			...(wire ? { wire: wire.request } : {}),
		},
		response,
		status,
		...(error ? { error } : {}),
	}
	const chain: Chain = {
		lastId: capture.id,
		length: (base?.length ?? 0) + 1,
		messageHashes,
		wireArrays: wire?.arrays ?? new Map(),
		blobs,
	}
	return { exchange, chain }
}
