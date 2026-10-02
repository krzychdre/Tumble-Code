import { type ToolName } from "@tumble-code/types"
import type { ToolUse } from "../../shared/tools"

import { type AssistantMessageContent, presentAssistantMessage } from "../assistant-message"
import { isCheckpointedTool } from "../checkpoints/checkpointedTools"
import { toolNamesWhere } from "../tools/toolDescriptors"
import { NativeToolCallParser, type ToolCallStreamEvent } from "../assistant-message/NativeToolCallParser"

import type { Task } from "./Task"
import { logger } from "../../utils/logging"

// Tools that cannot mutate the workspace (the `workspaceReadOnly` column of the
// tool descriptor table). An eager pre-edit checkpoint is only safe while every
// earlier tool block in the turn is in this set: anything else (execute_command,
// MCP tools, other writes) may still be mutating files when the write tool's
// arguments start streaming.
const WORKSPACE_READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(
	toolNamesWhere((tool) => tool.workspaceReadOnly),
)

/**
 * The state the tool-call handler reads and writes on the owning task. The
 * mutable members stay owned by the task (via `TaskStreamProcessorAccess`);
 * this interface is the typed read/write view, the same seam pattern as
 * `TaskApiLoopAccess` (D3).
 */
export interface StreamToolCallHandlerAccess {
	taskId: string
	currentStreamingDidCheckpoint: boolean
	assistantMessageContent: AssistantMessageContent[]
	userMessageContentReady: boolean
	streamingToolCallIndices: Map<string, number>
}

/**
 * Handles tool-call stream events for one task: raw tool_call_partial chunks,
 * finish_reason and the finalization of still-streaming calls, turning parser
 * events into partial/final `tool_use` blocks in `assistantMessageContent`
 * and presenting them. Extracted from `TaskStreamProcessor` (roadmap S2).
 */
export class StreamToolCallHandler {
	// Per-task parser instance — avoids cross-task state interference in parallel tasks
	private readonly toolCallParser = new NativeToolCallParser()

	constructor(
		private readonly access: StreamToolCallHandlerAccess,
		private readonly _task: Task,
	) {}

	/** Clears parser and tracking state left over from an interrupted stream. */
	reset(): void {
		this.access.streamingToolCallIndices.clear()
		// Clear any leftover streaming tool call state from previous interrupted streams
		this.toolCallParser.clearAllStreamingToolCalls()
		this.toolCallParser.clearRawChunkState()
	}

	/**
	 * Process a raw tool call chunk through the per-task parser instance
	 * which handles tracking, buffering, and emits events.
	 */
	processRawChunk(chunk: { index: number; id?: string; name?: string; arguments?: string }): void {
		const events = this.toolCallParser.processRawChunk({
			index: chunk.index,
			id: chunk.id,
			name: chunk.name,
			arguments: chunk.arguments,
		})
		this.handleToolCallEvents(events)
	}

	/** Process finish reason through the per-task parser instance. */
	processFinishReason(finishReason: string): void {
		const events = this.toolCallParser.processFinishReason(finishReason)
		this.handleToolCallEvents(events)
	}

	/** Finalize any remaining streaming tool calls that weren't explicitly ended. */
	finalizeRawChunks(): void {
		this.handleToolCallEvents(this.toolCallParser.finalizeRawChunks())
	}

	/**
	 * Process tool call events (start/delta/end) emitted by the parser.
	 * Shared between tool_call_partial and finish_reason chunk handling
	 * to avoid duplicating the ~100-line event loop.
	 */
	private handleToolCallEvents(events: ToolCallStreamEvent[]): void {
		for (const event of events) {
			if (event.type === "tool_call_start") {
				// Guard against duplicate tool_call_start events for the same tool ID.
				// This can occur due to stream retry, reconnection, or API quirks.
				// Without this check, duplicate tool_use blocks with the same ID would
				// be added to assistantMessageContent, causing API 400 errors:
				// "tool_use ids must be unique"
				if (this.access.streamingToolCallIndices.has(event.id)) {
					logger.warn(
						`[Task#${this.access.taskId}] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`,
					)
					continue
				}

				// Initialize streaming in the per-task parser
				this.toolCallParser.startStreamingToolCall(event.id, event.name as ToolName)

				// Eager pre-edit checkpoint: a checkpointed tool's arguments (whole file
				// contents / diffs) can stream for seconds. Start the checkpoint
				// now so it overlaps argument streaming instead of blocking the
				// tool execution in checkpointSaveAndMark. Only safe while every
				// earlier tool block this turn is workspace-read-only; otherwise
				// checkpointSaveAndMark falls back to the cold save after the
				// mutating tool finished. The stored promise is awaited there;
				// errors surface at the await site (the extra catch below only
				// suppresses an unhandled rejection when no write tool ends up
				// executing this turn).
				if (
					isCheckpointedTool(event.name) &&
					!this.access.currentStreamingDidCheckpoint &&
					typeof this._task?.checkpointSave === "function" &&
					this._task.pendingCheckpointSave === undefined &&
					this.access.assistantMessageContent.every(
						(b) =>
							b.type === "text" ||
							(b.type === "tool_use" && WORKSPACE_READ_ONLY_TOOLS.has(b.name as ToolName)),
					)
				) {
					const pending = this._task.checkpointSave(true) as Promise<void>
					pending.catch(() => {
						// Deliberate swallow: the rejection surfaces where the write
						// tool awaits pendingCheckpointSave; this handler only stops an
						// unhandled rejection when no write tool runs this turn.
					})
					this._task.pendingCheckpointSave = pending
				}

				// Before adding a new tool, finalize any preceding text block
				// This prevents the text block from blocking tool presentation
				const lastBlock = this.access.assistantMessageContent[this.access.assistantMessageContent.length - 1]
				if (lastBlock?.type === "text" && lastBlock.partial) {
					lastBlock.partial = false
				}

				// Track the index where this tool will be stored
				const toolUseIndex = this.access.assistantMessageContent.length
				this.access.streamingToolCallIndices.set(event.id, toolUseIndex)

				// Create initial partial tool use
				// Carries the ID for native protocol
				const partialToolUse: ToolUse = {
					type: "tool_use",
					id: event.id,
					name: event.name as ToolName,
					params: {},
					partial: true,
				}

				// Add to content and present
				this.access.assistantMessageContent.push(partialToolUse)
				this.access.userMessageContentReady = false
				presentAssistantMessage(this._task)
			} else if (event.type === "tool_call_delta") {
				// Process chunk using streaming JSON parser
				const partialToolUse = this.toolCallParser.processStreamingChunk(event.id, event.delta)

				if (partialToolUse) {
					// Get the index for this tool call
					const toolUseIndex = this.access.streamingToolCallIndices.get(event.id)
					if (toolUseIndex !== undefined) {
						// Store the ID for native protocol
						partialToolUse.id = event.id

						// Update the existing tool use with new partial data
						this.access.assistantMessageContent[toolUseIndex] = partialToolUse

						// Present updated tool use
						presentAssistantMessage(this._task)
					}
				}
			} else if (event.type === "tool_call_end") {
				// Finalize the streaming tool call
				const finalToolUse = this.toolCallParser.finalizeStreamingToolCall(event.id)

				// Get the index for this tool call
				const toolUseIndex = this.access.streamingToolCallIndices.get(event.id)

				if (finalToolUse) {
					// Store the tool call ID
					finalToolUse.id = event.id

					// Get the index and replace partial with final
					if (toolUseIndex !== undefined) {
						this.access.assistantMessageContent[toolUseIndex] = finalToolUse
					}

					// Clean up tracking
					this.access.streamingToolCallIndices.delete(event.id)

					// Mark that we have new content to process
					this.access.userMessageContentReady = false

					// Present the finalized tool call
					presentAssistantMessage(this._task)
				} else if (toolUseIndex !== undefined) {
					// finalizeStreamingToolCall returned null (malformed JSON or missing args)
					// Mark the tool as non-partial so it's presented as complete, but execution
					// will be short-circuited in presentAssistantMessage with a structured tool_result.
					this.markToolUseNonPartial(event.id, toolUseIndex)

					// Clean up tracking
					this.access.streamingToolCallIndices.delete(event.id)

					// Mark that we have new content to process
					this.access.userMessageContentReady = false

					// Present the tool call - validation will handle missing params
					presentAssistantMessage(this._task)
				} else {
					// TE-8: finalToolUse is null AND toolUseIndex is undefined.
					// This happens when a duplicate tool_call_start was deduped (so
					// streamingToolCallIndices never tracked this id under the
					// duplicate's index), but the parser's rawChunkTracker still has
					// an entry that emits a tool_call_end on finish_reason/finalize.
					// The first end already handled the content block; this second
					// end must not be silently swallowed.
					this.handleOrphanedToolCallEnd(event.id)
				}
			}
		}
	}

	/**
	 * Mark a tool_use block at the given index as non-partial (complete).
	 * Used when finalizeStreamingToolCall returns null (malformed JSON) but
	 * the tool call was tracked — the block must be presented so that
	 * presentAssistantMessage short-circuits with a structured error tool_result.
	 */
	private markToolUseNonPartial(toolCallId: string, toolUseIndex: number): void {
		const existingToolUse = this.access.assistantMessageContent[toolUseIndex]
		if (existingToolUse && existingToolUse.type === "tool_use") {
			existingToolUse.partial = false
			// Ensure it has the ID for native protocol
			existingToolUse.id = toolCallId
		}
	}

	/**
	 * Handle a tool_call_end event for an id that has no tracking index
	 * (streamingToolCallIndices has no entry). This is reachable when:
	 *   - A duplicate tool_call_start was deduped by the guard, so the id
	 *     was tracked under the first start's index, and the first
	 *     tool_call_end already cleaned up tracking.
	 *   - Or a state inconsistency caused the tracking to be lost.
	 *
	 * We scan assistantMessageContent for a block with the matching id.
	 * If found and still partial, we mark it non-partial (reusing the same
	 * logic as the null-finalize-with-index branch). If not found at all,
	 * there is nothing to repair in content — we log a loud error so the
	 * orphaned end is never silently swallowed.
	 */
	private handleOrphanedToolCallEnd(toolCallId: string): void {
		// Scan for a content block with this id.
		const contentIndex = this.access.assistantMessageContent.findIndex(
			(block) => block.type !== "text" && block.id === toolCallId,
		)

		if (contentIndex !== -1) {
			const block = this.access.assistantMessageContent[contentIndex]
			if (block && block.type === "tool_use" && block.partial) {
				// Repair: mark the block non-partial so presentAssistantMessage
				// can process it (will short-circuit with a structured error
				// tool_result if params are invalid).
				block.partial = false
				this.access.userMessageContentReady = false
				presentAssistantMessage(this._task)
			}
			// If already non-partial, the first end already handled it — nothing to do.
		} else {
			// No content block exists for this id. This is not expected through
			// normal parser event flow (the parser only emits tool_call_end for
			// started tool calls, and a start always creates a content block).
			// Log a loud error so the orphaned end is never silently swallowed.
			logger.error(
				`[Task#${this.access.taskId}] Orphaned tool_call_end: no content block found for tool call ID: ${toolCallId}`,
			)
		}

		// Defensive: ensure tracking is clean even if an entry somehow exists.
		this.access.streamingToolCallIndices.delete(toolCallId)
	}
}
