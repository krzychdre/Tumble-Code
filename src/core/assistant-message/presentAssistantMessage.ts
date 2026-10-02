import type { ArtifactSpillSettings } from "@tumble-code/types"
import { TelemetryEventName, resolveMaxInlineToolResultBytes } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"
import { customToolRegistry } from "@tumble-code/core"

import type { ToolUse, McpToolUse } from "../../shared/tools"

import { Task } from "../task/Task"

import { useMcpToolTool } from "../tools/UseMcpToolTool"
import type { AttemptCompletionCallbacks } from "../tools/AttemptCompletionTool"
import type { ToolCallbacks } from "../tools/BaseTool"
import { describeToolUse } from "../tools/toolDescriptors"
import { isCheckpointedTool } from "../checkpoints/checkpointedTools"

import { sanitizeToolUseId } from "../../utils/tool-id"
import { tryAutoMaterializeDirectCall } from "../task/deferred-tools-resolver"

import { createToolCallbacks } from "./toolCallbacks"
import { getToolHandler } from "./toolHandlers"
import {
	rejectMissingToolCallId,
	skipToolAfterRejection,
	rejectMalformedToolCall,
	rejectInvalidToolUse,
	stopRepeatedToolCall,
} from "./steps/toolUseGuards"
import {
	recordToolUse,
	checkpointSaveAndMark,
	runCustomTool,
	answerDeferredDirectCall,
	rejectUnknownTool,
} from "./steps/toolUseRun"
import { logger } from "../../utils/logging"
import { beginToolCallProbe, finishToolCallProbe, noteToolCallKind } from "../diagnostics/ErrorReporter"

/**
 * Processes and presents assistant message content to the user interface.
 *
 * This function is the core message handling system that:
 * - Sequentially processes content blocks from the assistant's response.
 * - Displays text content to the user.
 * - Executes tool use requests with appropriate user approval.
 * - Manages the flow of conversation by determining when to proceed to the next content block.
 * - Coordinates file system checkpointing for modified files.
 * - Controls the conversation state to determine when to continue to the next request.
 *
 * The function uses a locking mechanism to prevent concurrent execution and handles
 * partial content blocks during streaming. It's designed to work with the streaming
 * API response pattern, where content arrives incrementally and needs to be processed
 * as it becomes available.
 */

/**
 * Makes sure the task can spill an oversized tool result to an artifact.
 *
 * The spill decision happens inside `Task#pushToolResultToUserContent`, which is
 * synchronous, so the artifact store (whose directory resolves asynchronously)
 * has to be primed here, on the dispatch path. Best-effort: a failure leaves the
 * policy off and every result stays inline, exactly as before the policy existed.
 */
async function prepareToolResultSpill(task: Task, state?: ArtifactSpillSettings): Promise<void> {
	try {
		if (typeof task.ensureToolResultSpill !== "function") {
			return
		}

		const resolvedState = state ?? (await task.providerRef.deref()?.getState())
		await task.ensureToolResultSpill(resolveMaxInlineToolResultBytes(resolvedState))
	} catch (error) {
		logger.warn("[presentAssistantMessage] Could not prepare the tool-result spill policy:", error)
	}
}

type ProviderState = Awaited<ReturnType<NonNullable<ReturnType<Task["providerRef"]["deref"]>>["getState"]>>

/**
 * The settings read for the tool block that is still streaming, per task
 * (CORE-R7 step 3). This function runs once per streamed argument chunk, and a
 * partial block only uses the settings for its one-line description, so they
 * are read once per block while it streams instead of once per chunk. The
 * complete block always reads them fresh: validation and execution depend on
 * them, and they may have changed while the block streamed (a mode switch).
 */
const streamingBlockState = new WeakMap<Task, { toolCallId: string; state: ProviderState | undefined }>()

async function getStateForToolBlock(task: Task, toolCallId: string, partial: boolean) {
	if (!partial) {
		streamingBlockState.delete(task)
		return task.providerRef.deref()?.getState()
	}

	const streaming = streamingBlockState.get(task)
	if (streaming && streaming.toolCallId === toolCallId) {
		return streaming.state
	}

	const state = await task.providerRef.deref()?.getState()
	streamingBlockState.set(task, { toolCallId, state })
	return state
}

export async function presentAssistantMessage(task: Task) {
	// Every caller fires this without awaiting it, so a throw here could only become an unhandled rejection.
	// An aborted task simply stops presenting; the API loop notices the abort flag on its own.
	if (task.abort) {
		logger.debug(`[Task#presentAssistantMessage] task ${task.taskId}.${task.instanceId} aborted, skipping`)
		return
	}

	if (task.presentAssistantMessageLocked) {
		task.presentAssistantMessageHasPendingUpdates = true
		return
	}

	task.presentAssistantMessageLocked = true
	task.presentAssistantMessageHasPendingUpdates = false

	if (task.currentStreamingContentIndex >= task.assistantMessageContent.length) {
		// This may happen if the last content block was completed before
		// streaming could finish. If streaming is finished, and we're out of
		// bounds then this means we already  presented/executed the last
		// content block and are ready to continue to next request.
		if (task.didCompleteReadingStream) {
			task.userMessageContentReady = true
		}

		task.presentAssistantMessageLocked = false
		return
	}

	let block: any
	try {
		// Performance optimization: Use shallow copy instead of deep clone.
		// The block is used read-only throughout this function - we never mutate its properties.
		// We only need to protect against the reference changing during streaming, not nested mutations.
		// This provides 80-90% reduction in cloning overhead (5-100ms saved per block).
		block = { ...task.assistantMessageContent[task.currentStreamingContentIndex] }
	} catch (error) {
		logger.error(`ERROR cloning block:`, error)
		logger.error(
			`Block content:`,
			JSON.stringify(task.assistantMessageContent[task.currentStreamingContentIndex], null, 2),
		)
		task.presentAssistantMessageLocked = false
		return
	}

	// A complete tool call is watched while it runs, so a failure becomes one error report
	// (only while error reporting is active; see core/diagnostics/ErrorReporter.ts).
	const probe =
		(block.type === "tool_use" || block.type === "mcp_tool_use") && !block.partial
			? beginToolCallProbe(task, block)
			: undefined

	try {
		switch (block.type) {
			case "mcp_tool_use":
				await presentMcpToolUse(task, block as McpToolUse)
				break
			case "text":
				await presentText(task, block)
				break
			case "tool_use":
				await presentToolUse(task, block as ToolUse)
				break
		}
	} finally {
		finishToolCallProbe(task, probe)
	}

	// Seeing out of bounds is fine, it means that the next too call is being
	// built up and ready to add to assistantMessageContent to present.
	// When you see the UI inactive during this, it means that a tool is
	// breaking without presenting any UI. For example the write_to_file tool
	// was breaking when relpath was undefined, and for invalid relpath it never
	// presented UI.
	// This needs to be placed here, if not then calling
	// presentAssistantMessage(task) below would fail (sometimes) since it's
	// locked.
	task.presentAssistantMessageLocked = false

	// NOTE: When tool is rejected, iterator stream is interrupted and it waits
	// for `userMessageContentReady` to be true. Future calls to present will
	// skip execution since `didRejectTool` and iterate until `contentIndex` is
	// set to message length and it sets userMessageContentReady to true itself
	// (instead of preemptively doing it in iterator).
	if (!block.partial || task.didRejectTool || task.didAlreadyUseTool) {
		// Block is finished streaming and executing.
		if (task.currentStreamingContentIndex === task.assistantMessageContent.length - 1) {
			// It's okay that we increment if !didCompleteReadingStream, it'll
			// just return because out of bounds and as streaming continues it
			// will call `presentAssitantMessage` if a new block is ready. If
			// streaming is finished then we set `userMessageContentReady` to
			// true when out of bounds. This gracefully allows the stream to
			// continue on and all potential content blocks be presented.
			// Last block is complete and it is finished executing
			task.userMessageContentReady = true // Will allow `pWaitFor` to continue.
		}

		// Call next block if it exists (if not then read stream will call it
		// when it's ready).
		// Need to increment regardless, so when read stream calls this function
		// again it will be streaming the next block.
		task.currentStreamingContentIndex++

		if (task.currentStreamingContentIndex < task.assistantMessageContent.length) {
			// There are already more content blocks to stream, so we'll call
			// this function ourselves.
			presentAssistantMessage(task)
			return
		} else {
			// CRITICAL FIX: If we're out of bounds and the stream is complete, set userMessageContentReady
			// This handles the case where assistantMessageContent is empty or becomes empty after processing
			if (task.didCompleteReadingStream) {
				task.userMessageContentReady = true
			}
		}
	}

	// Block is partial, but the read stream may have finished.
	if (task.presentAssistantMessageHasPendingUpdates) {
		presentAssistantMessage(task)
	}
}

/**
 * A native MCP tool call (from the mcp_serverName_toolName dynamic tools).
 * It runs through the same execution path as use_mcp_tool but keeps its
 * original name in the API history.
 */
async function presentMcpToolUse(task: Task, mcpBlock: McpToolUse): Promise<void> {
	if (task.didRejectTool) {
		// For native protocol, we must send a tool_result for every tool_use to avoid API errors
		const toolCallId = mcpBlock.id
		const errorMessage = !mcpBlock.partial
			? `Skipping MCP tool ${mcpBlock.name} due to user rejecting a previous tool.`
			: `MCP tool ${mcpBlock.name} was interrupted and not executed due to user rejecting a previous tool.`

		if (toolCallId) {
			task.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: errorMessage,
				is_error: true,
			})
		}
		return
	}

	const toolCallId = mcpBlock.id
	// MCP results are recorded under `use_mcp_tool`, the tool that runs them.
	const { askApproval, handleError, pushToolResult } = createToolCallbacks(task, {
		block: mcpBlock,
		toolCallId,
		toolName: "use_mcp_tool",
	})

	if (!mcpBlock.partial) {
		task.recordToolUsage("use_mcp_tool") // Record as use_mcp_tool for analytics
		TelemetryService.instance.capture(TelemetryEventName.TOOL_USED, {
			taskId: task.taskId,
			tool: "use_mcp_tool",
		})

		// Prepare the tool-result spill policy before the tool runs: MCP
		// servers are a classic source of multi-hundred-KB payloads.
		// Only on the final block, so streaming stays allocation-free.
		await prepareToolResultSpill(task)

		// Auto-materialize: if the model called a deferred MCP tool directly
		// (without using `tools_load` first), promote it to the active set so
		// the next turn carries the full schema. The live MCP execution below
		// works regardless. Gated on the deferredTools experiment so behaviour
		// is byte-identical with the flag off. See ai_plans/archive/undated/deferred-tool-loading.md §8.3.
		try {
			const stateForResolver = await task.providerRef.deref()?.getState()
			tryAutoMaterializeDirectCall({
				task,
				blockName: mcpBlock.name,
				nativeArgs: mcpBlock.arguments,
				experiments: stateForResolver?.experiments,
			})
		} catch (resolverErr) {
			// Resolver is best-effort: never block a live MCP execution if it throws.
			logger.warn("[presentAssistantMessage] auto-materialize hook failed:", resolverErr)
		}
	}

	// Resolve sanitized server name back to original server name
	// The serverName from parsing is sanitized (e.g., "my_server" from "my server")
	// We need the original name to find the actual MCP connection
	const mcpHub = task.providerRef.deref()?.getMcpHub()
	let resolvedServerName = mcpBlock.serverName
	if (mcpHub) {
		const originalName = mcpHub.findServerNameBySanitizedName(mcpBlock.serverName)
		if (originalName) {
			resolvedServerName = originalName
		}
	}

	// Execute the MCP tool using the same handler as use_mcp_tool
	// Create a synthetic ToolUse block that the useMcpToolTool can handle
	const syntheticToolUse: ToolUse<"use_mcp_tool"> = {
		type: "tool_use",
		id: mcpBlock.id,
		name: "use_mcp_tool",
		params: {
			server_name: resolvedServerName,
			tool_name: mcpBlock.toolName,
			arguments: JSON.stringify(mcpBlock.arguments),
		},
		partial: mcpBlock.partial,
		nativeArgs: {
			server_name: resolvedServerName,
			tool_name: mcpBlock.toolName,
			arguments: mcpBlock.arguments,
		},
	}

	await useMcpToolTool.handle(task, syntheticToolUse, {
		askApproval,
		handleError,
		pushToolResult,
	})
}

async function presentText(task: Task, block: { content?: string; partial?: boolean }): Promise<void> {
	if (task.didRejectTool || task.didAlreadyUseTool) {
		return
	}

	let content = block.content

	if (content) {
		// Have to do this for partial and complete since sending
		// content in thinking tags to markdown renderer will
		// automatically be removed.
		// Strip any streamed <thinking> tags from text output.
		content = content.replace(/<thinking>\s?/g, "")
		content = content.replace(/\s?<\/thinking>/g, "")
	}

	await task.askSay.say("text", content, undefined, block.partial)
}

/**
 * A native tool call, through its steps in order: the missing-id guard, the
 * settings and spill policy, the rejected-tool guard, the malformed-args
 * guard, usage accounting, validation, the repetition check, the checkpoint,
 * the built-in handler, then the custom, deferred or unknown tool answer.
 * Each guard that answers the block ends it.
 */
async function presentToolUse(task: Task, block: ToolUse): Promise<void> {
	if (await rejectMissingToolCallId(task, block)) {
		noteToolCallKind(task, "invalid_tool_call")
		return
	}
	const toolCallId = block.id as string

	// Fetch state early so it's available for toolDescription and validation
	// (read once per block while it streams, fresh for the complete block).
	const state = await getStateForToolBlock(task, toolCallId, block.partial === true)
	const { customModes, experiments: stateExperiments, disabledTools } = state ?? {}
	// The task's own mode, not the one in provider state: that is the focused task's
	// mode, and a background subagent or a delegated child may run in another one.
	const taskMode = await task.getTaskMode()

	// Prepare the tool-result spill policy before the tool runs, so the
	// (synchronous) push below can move an oversized result to disk. Only on
	// the complete block: a streaming chunk runs no tool and pushes at most a
	// one-line "interrupted" result.
	if (!block.partial) {
		await prepareToolResultSpill(task, state)
	}

	// One line naming the call, from the tool's row in the descriptor table.
	const toolDescription = (): string => describeToolUse(block, { customModes })

	if (skipToolAfterRejection(task, block, toolCallId, toolDescription)) {
		return
	}

	if (!block.partial && rejectMalformedToolCall(task, block, toolCallId, stateExperiments)) {
		noteToolCallKind(task, "invalid_tool_call")
		return
	}

	const { askApproval, handleError, pushToolResult, askFinishSubTaskApproval } = createToolCallbacks(task, {
		block,
		toolCallId,
		toolName: String(block.name),
	})

	if (!block.partial) {
		recordToolUse(task, block, stateExperiments)
	}

	if (
		!block.partial &&
		(await rejectInvalidToolUse(task, block, toolCallId, {
			taskMode,
			customModes,
			disabledTools,
			stateExperiments,
		}))
	) {
		noteToolCallKind(task, "invalid_tool_call")
		return
	}

	// Check for identical consecutive tool calls.
	if (!block.partial && (await stopRepeatedToolCall(task, block, pushToolResult))) {
		return
	}

	// One list decides which tools get a checkpoint before they run; the
	// early start in TaskStreamProcessor reads the same list.
	if (isCheckpointedTool(block.name)) {
		await checkpointSaveAndMark(task)
	}

	// Every built-in tool runs through its row in the handler table. Each one gets the
	// same callbacks, including the call id (tools that do not use it ignore it);
	// attempt_completion additionally gets the sub-task approval and its description.
	const handler = getToolHandler(block.name)
	if (handler) {
		const callbacks: ToolCallbacks | AttemptCompletionCallbacks =
			block.name === "attempt_completion"
				? {
						askApproval,
						handleError,
						pushToolResult,
						toolCallId,
						askFinishSubTaskApproval,
						toolDescription,
					}
				: { askApproval, handleError, pushToolResult, toolCallId }
		await handler.handle(task, block, callbacks)
		return
	}

	// Handle unknown/invalid tool names OR custom tools
	// This is critical for native tool calling where every tool_use MUST have a tool_result

	// CRITICAL: Don't process partial blocks for unknown tools - just let them stream in.
	// If we try to show errors for partial blocks, we'd show the error on every streaming chunk,
	// creating a loop that appears to freeze the extension. Only handle complete blocks.
	if (block.partial) {
		return
	}

	const customTool = stateExperiments?.customTools ? customToolRegistry.get(block.name) : undefined

	if (customTool) {
		await runCustomTool(task, block, customTool, taskMode, pushToolResult, handleError)
		return
	}

	if (answerDeferredDirectCall(task, block, toolCallId, stateExperiments)) {
		return
	}

	// Not a custom tool - handle as unknown tool error
	noteToolCallKind(task, "invalid_tool_call")
	await rejectUnknownTool(task, block, toolCallId)
}
