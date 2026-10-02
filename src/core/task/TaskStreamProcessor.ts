import { Anthropic } from "@anthropic-ai/sdk"
import EventEmitter from "events"

import {
	type ClineApiReqCancelReason,
	type ClineApiReqInfo,
	type ClineMessage,
	type ModelInfo,
	type ProviderSettings,
	type ToolName,
	getModelId,
	getApiProtocol,
	isRetiredProvider,
	TelemetryEventName,
} from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { type ApiHandler } from "../../api"
import { type ApiStream, type ApiStreamChunk, type GroundingSource } from "../../api/transform/stream"

import { calculateApiCost, findLastIndex, type ApiCostResult } from "@tumble-code/core/browser"

import { type AssistantMessageContent, presentAssistantMessage } from "../assistant-message"
import { NativeToolCallParser, PARTIAL_ARGS_PARSE_INTERVAL_MS } from "../assistant-message/NativeToolCallParser"
import { type ClineProvider } from "../webview/ClineProvider"

import { AssistantMessageAssembler, type AssistantMessageAssemblerAccess } from "./AssistantMessageAssembler"
import { StreamToolCallHandler, type StreamToolCallHandlerAccess } from "./StreamToolCallHandler"
import type { Task } from "./Task"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskMessageLog } from "./TaskMessageLog"
import { type DiffViewProvider } from "../../integrations/editor/DiffViewProvider"

import { type UpdateApiReqMsgFn, type AbortStreamFn, type TokenSnapshot } from "./StreamProcessorTypes"
import { IncrementalReasoningFormatter } from "./reasoningFormatter"
import { logger } from "../../utils/logging"
import { captureFinishReason, captureStreamedToolCall } from "../diagnostics/ErrorReporter"

const DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000 // 5 seconds

/**
 * Every partial update of the streamed reasoning posts the whole reasoning so
 * far to the webview, so a post per chunk is quadratic in the reasoning length
 * (a 44 KB reasoning in 4-character chunks posted 10,946 times, 245 million
 * characters). Partial updates are posted at most once per this interval, the
 * rate of the streamed tool-argument previews (API P2). The message in memory
 * is still updated on every chunk, and pending text is posted before any other
 * message, on abort, on a stream error and when the stream ends.
 */
export const REASONING_PARTIAL_POST_INTERVAL_MS = PARTIAL_ARGS_PARSE_INTERVAL_MS

export interface TaskStreamProcessorAccess extends StreamToolCallHandlerAccess, AssistantMessageAssemblerAccess {
	taskId: string
	instanceId: string
	abort: boolean
	abandoned: boolean
	apiConfiguration: ProviderSettings

	// Streaming state (mutable - the processor reads and writes these)
	currentStreamingContentIndex: number
	didCompleteReadingStream: boolean
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[]
	userMessageContentReady: boolean
	didRejectTool: boolean
	didAlreadyUseTool: boolean
	didToolFailInCurrentTurn: boolean
	assistantMessageSavedToHistory: boolean
	presentAssistantMessageLocked: boolean
	presentAssistantMessageHasPendingUpdates: boolean
	streamingToolCallIndices: Map<string, number>
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	cachedStreamingModel?: { id: string; info: ModelInfo }

	// Cline messages (for updating api_req_started)
	clineMessages: ClineMessage[]

	// Abort stream flag
	didFinishAbortingStream: boolean

	// API handler (for caching streaming model)
	api: ApiHandler

	// Delegated modules
	history: TaskMessageLog

	// Provider reference (for postStateToWebviewWithoutTaskHistory)
	providerRef: WeakRef<ClineProvider>

	// Methods
	emit: EventEmitter["emit"]
	pushToolResultToUserContent: (toolResult: Anthropic.ToolResultBlockParam) => boolean
	diffViewProvider: DiffViewProvider
}

export class TaskStreamProcessor {
	constructor(
		private readonly access: TaskStreamProcessorAccess,
		private readonly _task: Task,
	) {
		// Created in the constructor body (not as field initializers): with
		// useDefineForClassFields semantics, field initializers run before the
		// parameter properties above are assigned.
		this.toolCallHandler = new StreamToolCallHandler(access, _task)
		this.assistantMessageAssembler = new AssistantMessageAssembler(access)
	}

	private readonly toolCallHandler: StreamToolCallHandler
	private readonly assistantMessageAssembler: AssistantMessageAssembler

	// Accumulation state for the current streaming session
	private _reasoningMessage: string = ""
	/** Formats the streamed reasoning line by line instead of whole per chunk (API P3). */
	private readonly reasoningFormatter = new IncrementalReasoningFormatter()
	/** When a partial reasoning update was last posted to the webview. */
	private lastReasoningPostAt: number | undefined
	/** A partial reasoning message updated in memory but not posted yet. */
	private pendingReasoningPost: ClineMessage | undefined
	/** Posts `pendingReasoningPost` when the interval ends, if the stream goes quiet. */
	private reasoningPostTimer: ReturnType<typeof setTimeout> | undefined
	private _requestStartTs: number = 0
	private _firstChunkTs: number | undefined
	private _assistantMessage: string = ""
	private _inputTokens: number = 0
	private _outputTokens: number = 0
	private _cacheWriteTokens: number = 0
	private _cacheReadTokens: number = 0
	private _totalCost: number | undefined = undefined
	private _pendingGroundingSources: GroundingSource[] = []

	get reasoningMessage(): string {
		return this._reasoningMessage
	}
	get assistantMessage(): string {
		return this._assistantMessage
	}

	/**
	 * Append text to the assistant message.
	 * Used when the stream is interrupted (e.g., by user feedback or tool use result).
	 */
	appendAssistantMessage(text: string): void {
		this._assistantMessage += text
	}
	get inputTokens(): number {
		return this._inputTokens
	}
	get outputTokens(): number {
		return this._outputTokens
	}
	get cacheWriteTokens(): number {
		return this._cacheWriteTokens
	}
	get cacheReadTokens(): number {
		return this._cacheReadTokens
	}
	get totalCost(): number | undefined {
		return this._totalCost
	}
	get pendingGroundingSources(): GroundingSource[] {
		return this._pendingGroundingSources
	}

	/**
	 * Reset all streaming state at the start of each API request.
	 * This resets mutable streaming properties on the access interface,
	 * clears tool call parser state, and resets the diff view.
	 */
	async resetStreamingState(): Promise<void> {
		this.access.currentStreamingContentIndex = 0
		this.access.currentStreamingDidCheckpoint = false
		// Drop any checkpoint from a previous (possibly aborted) turn — it
		// captured state before that turn's writes, so it must not satisfy this
		// turn's pre-edit checkpoint.
		this._task.pendingCheckpointSave = undefined
		this.access.assistantMessageContent = []
		this.access.didCompleteReadingStream = false
		this.access.userMessageContent = []
		this.access.userMessageContentReady = false
		this.access.didRejectTool = false
		this.access.didAlreadyUseTool = false
		this.access.assistantMessageSavedToHistory = false
		// Reset tool failure flag for each new assistant turn - this ensures that tool failures
		// only prevent attempt_completion within the same assistant message, not across turns
		this.access.didToolFailInCurrentTurn = false
		this.access.presentAssistantMessageLocked = false
		this.access.presentAssistantMessageHasPendingUpdates = false
		// No legacy text-stream tool parser.
		this.toolCallHandler.reset()

		await this.access.diffViewProvider.reset()

		// Cache model info once per API request to avoid repeated calls during streaming
		this.access.cachedStreamingModel = this.access.api.getModel()

		// Reset accumulation state
		this._requestStartTs = performance.now()
		this._firstChunkTs = undefined
		this._reasoningMessage = ""
		this.reasoningFormatter.reset()
		this.flushReasoningPost()
		this.lastReasoningPostAt = undefined
		this._assistantMessage = ""
		this._inputTokens = 0
		this._outputTokens = 0
		this._cacheWriteTokens = 0
		this._cacheReadTokens = 0
		this._totalCost = undefined
		this._pendingGroundingSources = []
		this._partialBlocks = []
	}

	/**
	 * Process a single chunk from the API stream.
	 * Handles reasoning, usage, grounding, tool_call_partial, tool_call, and text chunks.
	 */
	processChunk(chunk: ApiStreamChunk, streamModelInfo: ModelInfo): void {
		if (this._firstChunkTs === undefined) {
			this._firstChunkTs = performance.now()
		}
		if (chunk.type !== "reasoning") {
			// Deferred reasoning text is posted before anything else can post.
			this.flushReasoningPost()
		}
		switch (chunk.type) {
			case "reasoning": {
				const text = String(chunk.text)
				this._reasoningMessage += text
				// Line breaks before "...end of sentence.**Title Here**" section titles,
				// formatted incrementally (the same result as formatting the whole text).
				const formattedReasoning = this.reasoningFormatter.append(text)
				if (this.deferReasoningPost(formattedReasoning)) {
					break
				}
				if (!this.access.abort && this.pendingReasoningPost === this.access.clineMessages.at(-1)) {
					// `say` below posts this very message with the newer text
					// (an aborted task's `say` throws, so it flushes instead).
					this.dropPendingReasoningPost()
				} else {
					this.flushReasoningPost()
				}
				this.lastReasoningPostAt = Date.now()
				this.access.askSay.say("reasoning", formattedReasoning, undefined, true)
				break
			}
			case "usage":
				this._inputTokens += chunk.inputTokens
				this._outputTokens += chunk.outputTokens
				this._cacheWriteTokens += chunk.cacheWriteTokens ?? 0
				this._cacheReadTokens += chunk.cacheReadTokens ?? 0
				this._totalCost = chunk.totalCost
				break
			case "grounding":
				// Handle grounding sources separately from regular content
				// to prevent state persistence issues - store them separately
				if (chunk.sources && chunk.sources.length > 0) {
					this._pendingGroundingSources.push(...chunk.sources)
				}
				break
			case "tool_call_partial": {
				// Process raw tool call chunk through the per-task parser instance
				// which handles tracking, buffering, and emits events
				this.toolCallHandler.processRawChunk({
					index: chunk.index,
					id: chunk.id,
					name: chunk.name,
					arguments: chunk.arguments,
				})
				break
			}

			case "finish_reason": {
				// Process finish reason through the per-task parser instance
				// This replaces direct provider calls to NativeToolCallParser.processFinishReason
				this.toolCallHandler.processFinishReason(chunk.finishReason)
				captureFinishReason(this._task, chunk.finishReason)
				break
			}

			case "tool_call": {
				// Legacy: Handle complete tool calls (for backward compatibility)
				// Convert native tool call to ToolUse format
				captureStreamedToolCall(this._task, { id: chunk.id, name: chunk.name, arguments: chunk.arguments })
				const toolUse = NativeToolCallParser.parseToolCall({
					id: chunk.id,
					name: chunk.name as ToolName,
					arguments: chunk.arguments,
				})

				if (!toolUse) {
					logger.error(`Failed to parse tool call for task ${this.access.taskId}:`, chunk)
					break
				}

				// Store the tool call ID on the ToolUse object for later reference
				// This is needed to create tool_result blocks that reference the correct tool_use_id
				toolUse.id = chunk.id

				// Add the tool use to assistant message content
				this.access.assistantMessageContent.push(toolUse)

				// Mark that we have new content to process
				this.access.userMessageContentReady = false

				// Present the tool call to user - presentAssistantMessage will execute
				// tools sequentially and accumulate all results in userMessageContent
				presentAssistantMessage(this._task)
				break
			}
			case "text": {
				this._assistantMessage += chunk.text

				// Native tool calling: text chunks are plain text.
				// Create or update a text content block directly
				const lastBlock = this.access.assistantMessageContent[this.access.assistantMessageContent.length - 1]
				if (lastBlock?.type === "text" && lastBlock.partial) {
					lastBlock.content = this._assistantMessage
				} else {
					this.access.assistantMessageContent.push({
						type: "text",
						content: this._assistantMessage,
						partial: true,
					})
					this.access.userMessageContentReady = false
				}
				presentAssistantMessage(this._task)
				break
			}
		}
	}

	/**
	 * Updates the partial reasoning message in memory without posting it, when
	 * the last post was less than an interval ago. Returns false when the chunk
	 * must go through `say` as before: the first chunk of a message (the last
	 * message is not a partial reasoning), an aborted task, or the interval passed.
	 */
	private deferReasoningPost(formattedReasoning: string): boolean {
		const last = this.access.clineMessages.at(-1)
		const now = Date.now()
		if (
			this.access.abort ||
			this.lastReasoningPostAt === undefined ||
			now - this.lastReasoningPostAt >= REASONING_PARTIAL_POST_INTERVAL_MS ||
			!last ||
			last.type !== "say" ||
			last.say !== "reasoning" ||
			!last.partial
		) {
			return false
		}

		// The in-place update `say` makes for a partial message, minus the post.
		last.text = formattedReasoning
		this.pendingReasoningPost = last
		if (this.reasoningPostTimer === undefined) {
			this.reasoningPostTimer = setTimeout(
				() => {
					if (this.access.abandoned) {
						this.dropPendingReasoningPost()
						return
					}
					this.flushReasoningPost()
				},
				this.lastReasoningPostAt + REASONING_PARTIAL_POST_INTERVAL_MS - now,
			)
			this.reasoningPostTimer.unref?.()
		}
		return true
	}

	/**
	 * Posts the deferred partial reasoning update, if any. A message that was
	 * already closed (no longer partial) was posted by whatever closed it.
	 */
	private flushReasoningPost(): void {
		const message = this.pendingReasoningPost
		this.dropPendingReasoningPost()
		if (!message?.partial) {
			return
		}
		this.lastReasoningPostAt = Date.now()
		void this.access.history.updateClineMessage(message)
	}

	/** Forgets the deferred reasoning post and clears its timer. */
	private dropPendingReasoningPost(): void {
		if (this.reasoningPostTimer !== undefined) {
			clearTimeout(this.reasoningPostTimer)
			this.reasoningPostTimer = undefined
		}
		this.pendingReasoningPost = undefined
	}

	/** Drops a deferred reasoning post and its timer: the task is going away. */
	dispose(): void {
		this.dropPendingReasoningPost()
	}

	/**
	 * Finalize the stream after all chunks have been read.
	 * Completes remaining tool calls, marks partial blocks as complete,
	 * and saves the reasoning message.
	 */
	async finalizeStream(): Promise<void> {
		this.access.didCompleteReadingStream = true

		// The last partial reasoning update carries the whole text, as before.
		this.flushReasoningPost()

		// Set any blocks to be complete to allow `presentAssistantMessage`
		// to finish and set `userMessageContentReady` to true.
		// (Could be a text block that had no subsequent tool uses, or a
		// text block at the very end, or an invalid tool use, etc. Whatever
		// the case, `presentAssistantMessage` relies on these blocks either
		// to be completed or the user to reject a block in order to proceed
		// and eventually set userMessageContentReady to true.)

		// Finalize any remaining streaming tool calls that weren't explicitly ended
		// This is critical for MCP tools which need tool_call_end events to be properly
		// converted from ToolUse to McpToolUse via finalizeStreamingToolCall()
		this.toolCallHandler.finalizeRawChunks()

		// IMPORTANT: Capture partialBlocks AFTER finalizeRawChunks() to avoid double-presentation.
		// Tools finalized above are already presented, so we only want blocks still partial after finalization.
		const partialBlocks = this.access.assistantMessageContent.filter((block) => block.partial)
		partialBlocks.forEach((block) => (block.partial = false))

		// Can't just do this b/c a tool could be in the middle of executing.
		// this.assistantMessageContent.forEach((e) => (e.partial = false))

		// No legacy streaming parser to finalize.

		// Note: updateApiReqMsg() is now called from within drainStreamInBackgroundToFindAllUsage
		// to ensure usage data is captured even when the stream is interrupted. The background task
		// uses local variables to accumulate usage data before atomically updating the shared state.

		// Complete the reasoning message if it exists
		// We can't use say() here because the reasoning message may not be the last message
		// (other messages like text blocks or tool uses may have been added after it during streaming)
		if (this._reasoningMessage) {
			const lastReasoningIndex = findLastIndex(
				this.access.clineMessages,
				(m) => m.type === "say" && m.say === "reasoning",
			)

			if (lastReasoningIndex !== -1 && this.access.clineMessages[lastReasoningIndex].partial) {
				this.access.clineMessages[lastReasoningIndex].partial = false
				await this.access.history.updateClineMessage(this.access.clineMessages[lastReasoningIndex])
			}
		}

		await this.access.history.saveClineMessages()
		await this.access.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()

		// Return partialBlocks for later presentation
		// The caller needs to present them AFTER saving the assistant message to API history
		this._partialBlocks = partialBlocks
	}

	// Store partial blocks from finalizeStream for later use
	private _partialBlocks: AssistantMessageContent[] = []

	get partialBlocks(): AssistantMessageContent[] {
		return this._partialBlocks
	}

	/**
	 * Assemble and save the assistant message to API conversation history.
	 * Builds the assistant content array for API history, handles tool_use deduplication,
	 * and new_task isolation.
	 */
	async assembleAndSaveAssistantMessage(): Promise<void> {
		await this.assistantMessageAssembler.assembleAndSave({
			text: this._assistantMessage,
			reasoning: this._reasoningMessage,
			groundingSources: this._pendingGroundingSources,
		})
	}

	/**
	 * Token totals and cost of a request, priced the way the configured provider counts input
	 * tokens (Anthropic-style providers report the uncached input only).
	 */
	private costOf(
		modelInfo: ModelInfo,
		tokens: { input: number; output: number; cacheWrite: number; cacheRead: number },
	): ApiCostResult {
		const apiProvider = this.access.apiConfiguration.apiProvider
		const protocol = getApiProtocol(
			apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
			getModelId(this.access.apiConfiguration),
		)
		return calculateApiCost(protocol, modelInfo, {
			inputTokens: tokens.input,
			outputTokens: tokens.output,
			cacheWriteTokens: tokens.cacheWrite,
			cacheReadTokens: tokens.cacheRead,
		})
	}

	/**
	 * Create the updateApiReqMsg closure.
	 * Returns a function that updates the API request message with token/cost data.
	 */
	createUpdateApiReqMsgFn(lastApiReqIndex: number, streamModelInfo: ModelInfo): UpdateApiReqMsgFn {
		return (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
			if (lastApiReqIndex < 0 || !this.access.clineMessages[lastApiReqIndex]) {
				return
			}

			const existingData = JSON.parse(this.access.clineMessages[lastApiReqIndex].text || "{}")

			const costResult = this.costOf(streamModelInfo, {
				input: this._inputTokens,
				output: this._outputTokens,
				cacheWrite: this._cacheWriteTokens,
				cacheRead: this._cacheReadTokens,
			})

			this.access.clineMessages[lastApiReqIndex].text = JSON.stringify({
				...existingData,
				tokensIn: costResult.totalInputTokens,
				tokensOut: costResult.totalOutputTokens,
				cacheWrites: this._cacheWriteTokens,
				cacheReads: this._cacheReadTokens,
				cost: this._totalCost ?? costResult.totalCost,
				cancelReason,
				streamingFailedMessage,
			} satisfies ClineApiReqInfo)
		}
	}

	/**
	 * Create the abortStream closure.
	 * Returns a function that gracefully aborts the stream.
	 */
	createAbortStreamFn(lastApiReqIndex: number, updateApiReqMsg: UpdateApiReqMsgFn): AbortStreamFn {
		return async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
			// Deferred reasoning text is posted while the message is still partial.
			this.flushReasoningPost()

			if (this.access.diffViewProvider.isEditing) {
				await this.access.diffViewProvider.revertChanges() // closes diff view
			}

			// if last message is a partial we need to update and save it
			const lastMessage = this.access.clineMessages.at(-1)

			const finishedPartial = lastMessage?.partial ? lastMessage : undefined

			if (lastMessage && lastMessage.partial) {
				// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
				lastMessage.partial = false
				// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
			}

			// Update `api_req_started` to have cancelled and cost, so that
			// we can display the cost of the partial stream and the cancellation reason
			updateApiReqMsg(cancelReason, streamingFailedMessage)
			await this.access.history.saveClineMessages()

			// Both rows changed in place; a view that gets new messages alone
			// would not see it with the next message (CORE-R7).
			if (finishedPartial) {
				void this.access.history.postEditedClineMessage(finishedPartial)
			}
			const apiReqMessage = this.access.clineMessages[lastApiReqIndex]
			if (apiReqMessage && apiReqMessage !== finishedPartial) {
				void this.access.history.postEditedClineMessage(apiReqMessage)
			}

			// Signals to provider that it can retrieve the saved messages
			// from disk, as abortTask can not be awaited on in nature.
			this.access.didFinishAbortingStream = true
		}
	}

	/**
	 * Create the background usage drain function.
	 * This drains the remaining stream in the background to find all usage data.
	 *
	 * @param lastApiReqIndex - The index of the last API request message
	 * @param currentTokens - Snapshot of current token counts
	 * @param streamModelInfo - Model info for cost calculation
	 * @param iterator - The async iterator for the stream
	 * @param currentItem - The current iterator result (captured from the main loop)
	 * @param updateApiReqMsg - The function to update API request messages
	 * @returns A function that drains remaining usage data from the stream
	 */
	createBackgroundUsageDrain(
		lastApiReqIndex: number,
		currentTokens: TokenSnapshot,
		streamModelInfo: ModelInfo,
		iterator: AsyncGenerator<ApiStreamChunk>,
		currentItem: IteratorResult<ApiStreamChunk> | undefined,
		updateApiReqMsg: UpdateApiReqMsgFn,
	): (apiReqIndex: number) => Promise<void> {
		const access = this.access

		// Snapshot per-request metrics now: this drain is fire-and-forget and can
		// outlive resetStreamingState() for the next request, which clears them.
		const ttftMs =
			this._firstChunkTs !== undefined ? Math.round(this._firstChunkTs - this._requestStartTs) : undefined
		const reasoningChars = this._reasoningMessage.length
		const toolCount = (access.assistantMessageContent ?? []).filter(
			(block) => block.type === "tool_use" || block.type === "mcp_tool_use",
		).length

		return async (apiReqIndex: number) => {
			const timeoutMs = DEFAULT_USAGE_COLLECTION_TIMEOUT_MS
			const startTime = performance.now()
			const modelId = getModelId(access.apiConfiguration)

			// Local variables to accumulate usage data without affecting the main flow
			let bgInputTokens = currentTokens.input
			let bgOutputTokens = currentTokens.output
			let bgCacheWriteTokens = currentTokens.cacheWrite
			let bgCacheReadTokens = currentTokens.cacheRead
			let bgTotalCost = currentTokens.total

			// Helper function to capture telemetry and update messages
			const captureUsageData = async (
				tokens: {
					input: number
					output: number
					cacheWrite: number
					cacheRead: number
					total?: number
				},
				messageIndex: number = apiReqIndex,
			) => {
				if (tokens.input > 0 || tokens.output > 0 || tokens.cacheWrite > 0 || tokens.cacheRead > 0) {
					// Update the shared variables atomically
					this._inputTokens = tokens.input
					this._outputTokens = tokens.output
					this._cacheWriteTokens = tokens.cacheWrite
					this._cacheReadTokens = tokens.cacheRead
					this._totalCost = tokens.total

					// Update the API request message with the latest usage data
					updateApiReqMsg()
					// Do not persist task history once the owning task has been aborted/abandoned.
					// This drain is fire-and-forget (launched, not awaited, in TaskApiLoop) and can
					// outlive the task by up to DEFAULT_USAGE_COLLECTION_TIMEOUT_MS. For a parent
					// disposed by delegation, a late save here re-stamps the task's status from its
					// initialStatus ("active") via taskMetadata, clobbering the "delegated" metadata
					// delegateParentAndOpenChild just wrote — which makes the child's attempt_completion
					// finalize the whole task instead of returning to the parent. The guard lives here
					// (not in saveClineMessages) because abortTask deliberately persists final state.
					// See ai_plans/archive/2026-06/2026-06-08_delegated-subtask-no-return.md.
					if (!access.abort && !access.abandoned) {
						await access.history.saveClineMessages()
					}

					// Update the specific message in the webview
					const apiReqMessage = access.clineMessages[messageIndex]
					if (apiReqMessage) {
						await access.history.updateClineMessage(apiReqMessage)
					}

					const costResult = this.costOf(streamModelInfo, tokens)

					TelemetryService.instance.capture(TelemetryEventName.LLM_COMPLETION, {
						...(access.taskId && { taskId: access.taskId }),
						inputTokens: costResult.totalInputTokens,
						outputTokens: costResult.totalOutputTokens,
						cacheWriteTokens: tokens.cacheWrite,
						cacheReadTokens: tokens.cacheRead,
						cost: tokens.total ?? costResult.totalCost,
						ttftMs,
						reasoningChars,
						toolCount,
						// Stated rather than left to default, so a reader never has
						// to tell "a turn of the conversation" from "written before
						// the kind existed" — both are task turns, but only this one
						// is a claim.
						completionKind: "task",
						usageReported: true,
					})
				}
			}

			try {
				// Continue processing the original stream from where the main loop left off
				let usageFound = false
				let chunkCount = 0

				// Use the same iterator that the main loop was using
				// Start from the current item state captured when the main loop ended
				let item = currentItem
				while (item && !item.done) {
					// Check for timeout
					if (performance.now() - startTime > timeoutMs) {
						logger.warn(
							`[Background Usage Collection] Timed out after ${timeoutMs}ms for model: ${modelId}, processed ${chunkCount} chunks`,
						)
						// Clean up the iterator before breaking
						if (iterator.return) {
							await iterator.return(undefined)
						}
						break
					}

					const chunk = item.value
					item = await iterator.next()
					chunkCount++

					if (chunk && chunk.type === "usage") {
						usageFound = true
						bgInputTokens += chunk.inputTokens
						bgOutputTokens += chunk.outputTokens
						bgCacheWriteTokens += chunk.cacheWriteTokens ?? 0
						bgCacheReadTokens += chunk.cacheReadTokens ?? 0
						bgTotalCost = chunk.totalCost
					}
				}

				if (
					usageFound ||
					bgInputTokens > 0 ||
					bgOutputTokens > 0 ||
					bgCacheWriteTokens > 0 ||
					bgCacheReadTokens > 0
				) {
					// We have usage data either from a usage chunk or accumulated tokens
					await captureUsageData(
						{
							input: bgInputTokens,
							output: bgOutputTokens,
							cacheWrite: bgCacheWriteTokens,
							cacheRead: bgCacheReadTokens,
							total: bgTotalCost,
						},
						lastApiReqIndex,
					)
				} else {
					logger.warn(
						`[Background Usage Collection] Suspicious: request ${apiReqIndex} is complete, but no usage info was found. Model: ${modelId}`,
					)
				}
			} catch (error) {
				logger.error("Error draining stream for usage data:", error)
				// Still try to capture whatever usage data we have collected so far
				if (bgInputTokens > 0 || bgOutputTokens > 0 || bgCacheWriteTokens > 0 || bgCacheReadTokens > 0) {
					await captureUsageData(
						{
							input: bgInputTokens,
							output: bgOutputTokens,
							cacheWrite: bgCacheWriteTokens,
							cacheRead: bgCacheReadTokens,
							total: bgTotalCost,
						},
						lastApiReqIndex,
					)
				}
			}
		}
	}
}
