/**
 * JsonEventEmitter - Handles structured JSON output for the CLI
 *
 * This class transforms internal CLI events (ClineMessage, state changes, etc.)
 * into structured JSON events and outputs them to stdout.
 *
 * Supports two output modes:
 * - "stream-json": NDJSON format (one JSON object per line) for real-time streaming
 * - "json": Single JSON object at the end with accumulated events
 *
 * Schema is optimized for efficiency with high message volume:
 * - Minimal fields per event
 * - No redundant wrappers
 * - `done` flag instead of partial:false
 *
 * It reads the client's `delivery` events (D11): every message that is new or
 * changed, once, keyed by the message's ts (the event id). A message that is
 * not the last one of the state push that brings it is emitted too, and a
 * resumed task's history is not emitted at all.
 */

import type { ClineMessage } from "@tumble-code/types"
import { consolidateApiRequests, consolidateTokenUsage } from "@tumble-code/core/cli"

import type { JsonEvent, JsonEventCost, JsonFinalOutput } from "@/types/json-events.js"

import type { ExtensionClient } from "./extension-client.js"
import type { AgentStateChangeEvent, TaskCompletedEvent } from "./events.js"
import type { MessageDelivery } from "./transcript-deliveries.js"
import { AgentLoopState } from "./agent-state.js"

/**
 * Options for JsonEventEmitter.
 */
export interface JsonEventEmitterOptions {
	/** Output mode: "json" or "stream-json" */
	mode: "json" | "stream-json"
	/** Output stream (defaults to process.stdout) */
	stdout?: NodeJS.WriteStream
}

/**
 * Parse tool information from a ClineMessage text field.
 * Tool messages are JSON with a `tool` field containing the tool name.
 */
function parseToolInfo(text: string | undefined): { name: string; input: Record<string, unknown> } | null {
	if (!text) return null
	try {
		const parsed = JSON.parse(text)
		return parsed.tool ? { name: parsed.tool, input: parsed } : null
	} catch {
		return null
	}
}

/** The messages that carry the price of a task (as counted by consolidateTokenUsage). */
function isCostMessage(msg: ClineMessage): boolean {
	return msg.type === "say" && (msg.say === "api_req_started" || msg.say === "condense_context")
}

function hasReportedCost(msg: ClineMessage): boolean {
	if (msg.say === "condense_context") {
		return typeof msg.contextCondense?.cost === "number"
	}
	try {
		return typeof JSON.parse(msg.text || "{}").cost === "number"
	} catch {
		return false
	}
}

/**
 * The cost of the whole task: every API request (and context condensing),
 * summed by the same helper the TUI footer and the extension use. Undefined
 * while no request has reported a price.
 */
function computeTaskCost(messages: ClineMessage[]): JsonEventCost | undefined {
	if (!messages.some(hasReportedCost)) {
		return undefined
	}
	const usage = consolidateTokenUsage(consolidateApiRequests(messages))
	return {
		totalCost: usage.totalCost,
		inputTokens: usage.totalTokensIn,
		outputTokens: usage.totalTokensOut,
		cacheWrites: usage.totalCacheWrites,
		cacheReads: usage.totalCacheReads,
	}
}

/** Internal events that should not be emitted */
const SKIP_SAY_TYPES = new Set([
	"api_req_finished",
	"api_req_retried",
	"api_req_retry_delayed",
	"api_req_rate_limit_wait",
	"api_req_deleted",
	"checkpoint_saved",
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
])

/** Key offset for reasoning content to avoid collision with text content delta tracking */
const REASONING_KEY_OFFSET = 1_000_000_000

export class JsonEventEmitter {
	private mode: "json" | "stream-json"
	private stdout: NodeJS.WriteStream
	private events: JsonEvent[] = []
	private unsubscribers: (() => void)[] = []
	private pendingWrites = new Set<Promise<void>>()
	/**
	 * The latest version of each cost-bearing message, keyed by ts. The
	 * extension writes a request's price into its api_req_started message in
	 * place, after the message was first sent.
	 */
	private costMessages = new Map<number, ClineMessage>()
	private client: ExtensionClient | undefined
	private seenMessageIds = new Set<number>()
	// Track previous content for delta computation
	private previousContent = new Map<number, string>()
	// Track previous tool-use content for structured (non-append-only) delta computation.
	private previousToolUseContent = new Map<number, string>()
	// Track the currently active execute_command tool_use id for command_output correlation.
	private activeCommandToolUseId: number | undefined
	// Track command output snapshots by command tool-use id for delta computation.
	private previousCommandOutputByToolUseId = new Map<number, string>()
	// Track the completion result content
	private completionResultContent: string | undefined
	// Track the latest assistant text as a fallback for result.content.
	private lastAssistantText: string | undefined
	// The first non-partial "say:text" per task is the echoed user prompt.
	private expectPromptEchoAsUser = true

	constructor(options: JsonEventEmitterOptions) {
		this.mode = options.mode
		this.stdout = options.stdout ?? process.stdout
	}

	/**
	 * Attach to an ExtensionClient and subscribe to its events.
	 */
	attachToClient(client: ExtensionClient): void {
		this.client = client

		// Subscribe to message events
		const unsubDelivery = client.on("delivery", (delivery) => this.handleDelivery(delivery))
		const unsubStateChange = client.on("stateChange", (event) => this.handleStateChange(event))
		const unsubTaskCompleted = client.on("taskCompleted", (event) => this.handleTaskCompleted(event))
		const unsubError = client.on("error", (error) => this.handleError(error))

		this.unsubscribers.push(unsubDelivery, unsubStateChange, unsubTaskCompleted, unsubError)

		// Emit init event
		this.emitEvent({
			type: "system",
			subtype: "init",
			content: "Task started",
			schemaVersion: 1,
			protocol: "roo-cli-stream",
		})
	}

	private handleStateChange(event: AgentStateChangeEvent): void {
		// Only treat the next say:text as a prompt echo when a new task starts.
		if (
			event.previousState.state === AgentLoopState.NO_TASK &&
			event.currentState.state !== AgentLoopState.NO_TASK
		) {
			this.expectPromptEchoAsUser = true
		}
	}

	/**
	 * Detach from the client and clean up subscriptions.
	 */
	detach(): void {
		for (const unsub of this.unsubscribers) {
			unsub()
		}
		this.unsubscribers = []
	}

	/**
	 * Compute the delta (new content) for a streaming message.
	 * Returns null if there's no new content.
	 */
	private computeDelta(msgId: number, fullContent: string | undefined): string | null {
		if (!fullContent) return null

		const previous = this.previousContent.get(msgId) || ""
		if (fullContent === previous) return null

		this.previousContent.set(msgId, fullContent)
		// If content is appended, return only the new part
		return fullContent.startsWith(previous) ? fullContent.slice(previous.length) : fullContent
	}

	/**
	 * Compute a compact delta for structured strings (for tool_use snapshots).
	 *
	 * Unlike append-only text streams, tool-use payloads are often full snapshots
	 * where edits happen before a stable suffix (e.g., inside JSON strings). This
	 * extracts the inserted segment when possible; otherwise it falls back to the
	 * full snapshot so consumers can recover.
	 */
	private computeStructuredDelta(msgId: number, fullContent: string | undefined): string | null {
		if (!fullContent) {
			return null
		}

		const previous = this.previousToolUseContent.get(msgId) || ""

		if (fullContent === previous) {
			return null
		}

		this.previousToolUseContent.set(msgId, fullContent)

		if (previous.length === 0) {
			return fullContent
		}

		if (fullContent.startsWith(previous)) {
			return fullContent.slice(previous.length)
		}

		let prefix = 0

		while (prefix < previous.length && prefix < fullContent.length && previous[prefix] === fullContent[prefix]) {
			prefix++
		}

		let suffix = 0

		while (
			suffix < previous.length - prefix &&
			suffix < fullContent.length - prefix &&
			previous[previous.length - 1 - suffix] === fullContent[fullContent.length - 1 - suffix]
		) {
			suffix++
		}

		const isPureInsertion = fullContent.length >= previous.length && prefix + suffix >= previous.length

		if (isPureInsertion) {
			return fullContent.slice(prefix, fullContent.length - suffix)
		}

		return fullContent
	}

	/**
	 * Check if this is a streaming partial message with no new content.
	 */
	private isEmptyStreamingDelta(content: string | null): boolean {
		return this.mode === "stream-json" && content === null
	}

	private computeCommandOutputDelta(commandId: number, fullOutput: string | undefined): string | null {
		const normalized = fullOutput ?? ""
		const previous = this.previousCommandOutputByToolUseId.get(commandId) || ""

		if (normalized === previous) {
			return null
		}

		this.previousCommandOutputByToolUseId.set(commandId, normalized)
		return normalized.startsWith(previous) ? normalized.slice(previous.length) : normalized
	}

	private emitCommandOutputEvent(commandId: number, fullOutput: string | undefined, isDone: boolean): void {
		const event: JsonEvent = {
			type: "tool_result",
			id: commandId,
			subtype: "command",
			tool_result: { name: "execute_command" },
		}

		if (this.mode === "stream-json") {
			const outputDelta = this.computeCommandOutputDelta(commandId, fullOutput)

			// Suppress empty partial updates that carry no delta.
			if (!isDone && outputDelta === null) {
				return
			}

			if (outputDelta !== null && outputDelta.length > 0) {
				event.tool_result = { name: "execute_command", output: outputDelta }
			}
		} else {
			event.tool_result = { name: "execute_command", output: fullOutput }
		}

		if (isDone) {
			event.done = true
			this.previousCommandOutputByToolUseId.delete(commandId)
			if (this.activeCommandToolUseId === commandId) {
				this.activeCommandToolUseId = undefined
			}
		}

		this.emitEvent(event)
	}

	/**
	 * Get content to send for a message (delta for streaming, full for json mode).
	 */
	private getContentToSend(msgId: number, text: string | undefined, isPartial: boolean): string | null {
		if (this.mode === "stream-json" && isPartial) {
			return this.computeDelta(msgId, text)
		}

		return text ?? null
	}

	/**
	 * Build a base event with optional done flag.
	 */
	private buildTextEvent(
		type: "assistant" | "thinking" | "user",
		id: number,
		content: string | null,
		isDone: boolean,
		subtype?: string,
	): JsonEvent {
		const event: JsonEvent = { type, id }

		if (content !== null) {
			event.content = content
		}

		if (subtype) {
			event.subtype = subtype
		}

		if (isDone) {
			event.done = true
		}

		return event
	}

	/**
	 * Handle one delivery of the client's event stream.
	 */
	private handleDelivery(delivery: MessageDelivery): void {
		if (delivery.history) {
			// A resumed task's history happened before this run: nothing of it
			// is emitted (its cost still counts, through getTaskCost). The task
			// is not new, so no prompt echo follows either: its next say:text
			// is the model's.
			if (isCostMessage(delivery.message)) {
				this.costMessages.set(delivery.message.ts, delivery.message)
			}
			this.expectPromptEchoAsUser = false
			return
		}

		this.handleMessage(delivery.message)
	}

	/**
	 * Handle a ClineMessage and emit the appropriate JSON event.
	 */
	private handleMessage(msg: ClineMessage): void {
		const isDone = !msg.partial

		// Before the duplicate filter below: a request's cost arrives as an
		// update of a message that was already seen complete.
		if (isCostMessage(msg)) {
			this.costMessages.set(msg.ts, msg)
		}

		// In json mode, only emit complete (non-partial) messages
		if (this.mode === "json" && msg.partial) {
			return
		}

		// Skip duplicate complete messages
		if (isDone && this.seenMessageIds.has(msg.ts)) {
			return
		}

		if (isDone) {
			this.seenMessageIds.add(msg.ts)
			this.previousContent.delete(msg.ts)
			this.previousToolUseContent.delete(msg.ts)
		}

		if (msg.type === "say" && msg.say) {
			const contentToSend = this.getContentToSend(msg.ts, msg.text, msg.partial ?? false)

			// Skip if no new content for streaming partial messages
			if (msg.partial && this.isEmptyStreamingDelta(contentToSend)) {
				return
			}

			this.handleSayMessage(msg, contentToSend, isDone)
		}

		if (msg.type === "ask" && msg.ask) {
			this.handleAskMessage(msg, isDone)
		}
	}

	/**
	 * Handle "say" type messages.
	 */
	private handleSayMessage(msg: ClineMessage, contentToSend: string | null, isDone: boolean): void {
		switch (msg.say) {
			case "text":
				if (this.expectPromptEchoAsUser) {
					this.emitEvent(this.buildTextEvent("user", msg.ts, contentToSend, isDone))
					if (isDone) {
						this.expectPromptEchoAsUser = false
					}
				} else {
					this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone))
					if (msg.text) {
						this.lastAssistantText = msg.text
					}
				}
				break

			case "reasoning":
				this.handleReasoningMessage(msg, isDone)
				break

			case "error":
				this.emitEvent({ type: "error", id: msg.ts, content: contentToSend ?? undefined })
				break

			case "command_output":
				this.handleCommandOutputMessage(msg, isDone)
				break

			case "user_feedback":
			case "user_feedback_diff":
				this.emitEvent(this.buildTextEvent("user", msg.ts, contentToSend, isDone))
				if (isDone) {
					this.expectPromptEchoAsUser = false
				}
				break

			case "api_req_started":
				// Counted by getTaskCost().
				break

			case "mcp_server_response":
				this.emitEvent({
					type: "tool_result",
					subtype: "mcp",
					tool_result: { name: "mcp_server", output: msg.text },
				})
				break

			case "completion_result":
				if (msg.text && !msg.partial) {
					this.completionResultContent = msg.text
				}
				break

			default:
				if (SKIP_SAY_TYPES.has(msg.say!)) {
					break
				}
				if (msg.text) {
					this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, msg.say))
				}
				break
		}
	}

	/**
	 * Handle reasoning/thinking messages with separate delta tracking.
	 */
	private handleReasoningMessage(msg: ClineMessage, isDone: boolean): void {
		const reasoningContent = msg.reasoning || msg.text
		const reasoningKey = msg.ts + REASONING_KEY_OFFSET
		const reasoningDelta = this.getContentToSend(reasoningKey, reasoningContent, msg.partial ?? false)

		if (msg.partial && this.isEmptyStreamingDelta(reasoningDelta)) {
			return
		}

		if (!msg.partial) {
			this.previousContent.delete(reasoningKey)
		}

		this.emitEvent(this.buildTextEvent("thinking", msg.ts, reasoningDelta, isDone))
	}

	/**
	 * Handle "ask" type messages.
	 */
	private handleAskMessage(msg: ClineMessage, isDone: boolean): void {
		switch (msg.ask) {
			case "tool":
				this.handleToolUseAsk(msg, "tool", isDone)
				break

			case "command":
				this.handleToolUseAsk(msg, "command", isDone)
				break

			case "use_mcp_server":
				this.handleToolUseAsk(msg, "mcp", isDone)
				break

			case "followup": {
				const contentToSend = this.getContentToSend(msg.ts, msg.text, msg.partial ?? false)

				// Skip if no new content for streaming partial messages
				if (msg.partial && this.isEmptyStreamingDelta(contentToSend)) {
					return
				}

				this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, "followup"))
				break
			}

			case "command_output":
				// Handled in say type
				break

			case "completion_result":
				if (msg.text && !msg.partial) {
					this.completionResultContent = msg.text
				}
				break

			default:
				if (msg.text) {
					const contentToSend = this.getContentToSend(msg.ts, msg.text, msg.partial ?? false)

					// Skip if no new content for streaming partial messages
					if (msg.partial && this.isEmptyStreamingDelta(contentToSend)) {
						return
					}

					this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, msg.ask))
				}
				break
		}
	}

	private handleToolUseAsk(msg: ClineMessage, subtype: "tool" | "command" | "mcp", isDone: boolean): void {
		const isStreamingPartial = this.mode === "stream-json" && msg.partial === true
		const toolInfo = parseToolInfo(msg.text)

		if (subtype === "command") {
			this.activeCommandToolUseId = msg.ts

			if (isStreamingPartial) {
				const commandDelta = this.computeStructuredDelta(msg.ts, msg.text)
				if (commandDelta === null) {
					return
				}

				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "command",
					content: commandDelta,
					tool_use: { name: "execute_command", input: { command: commandDelta } },
				})
				return
			}

			this.emitEvent({
				type: "tool_use",
				id: msg.ts,
				subtype: "command",
				tool_use: { name: "execute_command", input: { command: msg.text } },
				...(isDone ? { done: true } : {}),
			})
			return
		}

		if (subtype === "mcp") {
			if (isStreamingPartial) {
				const mcpDelta = this.computeStructuredDelta(msg.ts, msg.text)
				if (mcpDelta === null) {
					return
				}

				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "mcp",
					content: mcpDelta,
					tool_use: { name: "mcp_server" },
				})
				return
			}

			this.emitEvent({
				type: "tool_use",
				id: msg.ts,
				subtype: "mcp",
				tool_use: { name: "mcp_server", input: { raw: msg.text } },
				...(isDone ? { done: true } : {}),
			})
			return
		}

		if (isStreamingPartial) {
			const toolDelta = this.computeStructuredDelta(msg.ts, msg.text)
			if (toolDelta === null) {
				return
			}

			this.emitEvent({
				type: "tool_use",
				id: msg.ts,
				subtype: "tool",
				content: toolDelta,
				tool_use: { name: toolInfo?.name ?? "unknown_tool" },
			})
			return
		}

		this.emitEvent({
			type: "tool_use",
			id: msg.ts,
			subtype: "tool",
			tool_use: toolInfo ?? { name: "unknown_tool", input: { raw: msg.text } },
			...(isDone ? { done: true } : {}),
		})
	}

	/** Command output is reported under the id of the execute_command tool use that started it. */
	private handleCommandOutputMessage(msg: ClineMessage, isDone: boolean): void {
		this.emitCommandOutputEvent(this.activeCommandToolUseId ?? msg.ts, msg.text, isDone)
	}

	/**
	 * Handle task completion and emit result event.
	 */
	private handleTaskCompleted(event: TaskCompletedEvent): void {
		// Prefer the completion payload from the current event. If it is empty,
		// fall back to the most recent tracked completion text, then assistant text.
		const resultContent = event.message?.text || this.completionResultContent || this.lastAssistantText

		this.emitEvent({
			type: "result",
			id: event.message?.ts ?? Date.now(),
			content: resultContent,
			done: true,
			success: event.success,
			cost: this.getTaskCost(),
		})

		// Prevent stale completion content from leaking into later turns.
		this.completionResultContent = undefined
		this.lastAssistantText = undefined

		// For "json" mode, output the final accumulated result
		if (this.mode === "json") {
			this.outputFinalResult(event.success, resultContent)
		}
	}

	/**
	 * The cost of the task so far: the messages seen here, updated with the
	 * client's current copy of the task's messages (which holds the prices
	 * written after a message was first sent).
	 */
	private getTaskCost(): JsonEventCost | undefined {
		const byTs = new Map(this.costMessages)
		for (const msg of this.client?.getMessages() ?? []) {
			if (isCostMessage(msg)) {
				byTs.set(msg.ts, msg)
			}
		}
		return computeTaskCost([...byTs.values()].sort((a, b) => a.ts - b.ts))
	}

	/**
	 * Handle errors and emit error event.
	 */
	private handleError(error: Error): void {
		this.emitEvent({
			type: "error",
			id: Date.now(),
			content: error.message,
		})
	}

	/**
	 * Emit a JSON event.
	 * For stream-json mode: immediately output to stdout
	 * For json mode: accumulate for final output
	 */
	private emitEvent(event: JsonEvent): void {
		this.events.push(event)

		if (this.mode === "stream-json") {
			this.outputLine(event)
		}
	}

	/**
	 * Output a single JSON line (NDJSON format).
	 */
	private outputLine(data: unknown): void {
		this.writeToStdout(JSON.stringify(data) + "\n")
	}

	/**
	 * Output the final accumulated result (for "json" mode).
	 */
	private outputFinalResult(success: boolean, content?: string): void {
		const output: JsonFinalOutput = {
			type: "result",
			success,
			content,
			cost: this.getTaskCost(),
			events: this.events.filter((e) => e.type !== "result"), // Exclude the result event itself
		}

		this.writeToStdout(JSON.stringify(output, null, 2) + "\n")
	}

	private writeToStdout(content: string): void {
		const writePromise = new Promise<void>((resolve, reject) => {
			this.stdout.write(content, (error?: Error | null) => {
				if (error) {
					reject(error)
					return
				}
				resolve()
			})
		})

		this.pendingWrites.add(writePromise)

		void writePromise.finally(() => {
			this.pendingWrites.delete(writePromise)
		})
	}

	async flush(): Promise<void> {
		while (this.pendingWrites.size > 0) {
			await Promise.all([...this.pendingWrites])
		}
	}
}
