import type { ToolName, ClineAsk, Experiments, ModeConfig } from "@tumble-code/types"
import { ConsecutiveMistakeError, TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"
import { customToolRegistry } from "@tumble-code/core"

import type { PushToolResult, ToolUse } from "../../../shared/tools"

import type { Task } from "../../task/Task"
import { isValidToolName, validateToolUse } from "../../tools/validateToolUse"
import { formatResponse } from "../../prompts/responses"
import { sanitizeToolUseId } from "../../../utils/tool-id"
import { tryAutoMaterializeDirectCall } from "../../task/deferred-tools-resolver"

/*
 * The checks a tool_use block passes before its tool runs, in the order
 * presentToolUse calls them. Each returns true when it has answered the block
 * (pushed its tool_result or error) and the block must not go further.
 */

/**
 * Native tool calling is the only supported tool calling mechanism. A
 * tool_use block without an id is invalid and cannot be executed.
 */
export async function rejectMissingToolCallId(task: Task, block: ToolUse): Promise<boolean> {
	if (block.id) {
		return false
	}

	const errorMessage =
		"Invalid tool call: missing tool_use.id. XML tool calls are no longer supported. Remove any XML tool markup (e.g. <read_file>...</read_file>) and use native tool calling instead."
	// Record a tool error for visibility/telemetry. Use the reported tool name if present.
	try {
		if (typeof block.name === "string") {
			task.recordToolError(block.name as ToolName, errorMessage)
		}
	} catch {
		// Best-effort only
	}
	task.consecutiveMistakeCount++
	await task.askSay.say("error", errorMessage)
	task.userMessageContent.push({ type: "text", text: errorMessage })
	task.didAlreadyUseTool = true
	return true
}

/**
 * Ignore any tool content after the user has rejected a tool once. For native
 * tool calling, every tool_use still needs a tool_result to avoid API errors.
 */
export function skipToolAfterRejection(
	task: Task,
	block: ToolUse,
	toolCallId: string,
	toolDescription: () => string,
): boolean {
	if (!task.didRejectTool) {
		return false
	}

	const errorMessage = !block.partial
		? `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`
		: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`

	task.pushToolResultToUserContent({
		type: "tool_result",
		tool_use_id: sanitizeToolUseId(toolCallId),
		content: errorMessage,
		is_error: true,
	})

	return true
}

/**
 * A complete native tool call whose arguments the parser could not construct
 * (e.g., malformed/unfinished JSON in a streaming tool call) must NOT be
 * executed. Instead, emit exactly one structured tool_result so the provider
 * receives a matching tool_result for the tool_use_id.
 *
 * This avoids executing an invalid tool_use block and prevents
 * duplicate/fragmented error reporting.
 */
export function rejectMalformedToolCall(
	task: Task,
	block: ToolUse,
	toolCallId: string,
	stateExperiments: Experiments | undefined,
): boolean {
	const customTool = stateExperiments?.customTools ? customToolRegistry.get(block.name) : undefined
	const isKnownTool = isValidToolName(String(block.name), stateExperiments)
	// Allow-list: tools that own their own missing-args handling and
	// MUST be allowed to reach their handler with empty/undefined
	// nativeArgs. Weak tool-calling models routinely emit `tools_load`
	// with `input: {}`: the ToolsLoadTool handler converts that into
	// structured guidance instead of an error. Gated by `deferredTools`
	// so behaviour with the experiment OFF is byte-identical to today.
	// See ai_plans/archive/undated/deferred-tool-loading.md §8.2.
	const allowsEmptyNativeArgs = stateExperiments?.deferredTools === true && block.name === "tools_load"

	// Auto-materialize: a direct call to a deferred tool name without
	// args. Resolver returns `guidance` with the schema inlined so the
	// model can retry next turn with valid args. Gated on the
	// `deferredTools` experiment. See §8.3.
	if (!block.nativeArgs && !customTool && stateExperiments?.deferredTools === true) {
		const outcome = tryAutoMaterializeDirectCall({
			task,
			blockName: block.name,
			nativeArgs: block.nativeArgs,
			experiments: stateExperiments,
		})
		if (outcome && outcome.kind === "guidance") {
			task.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				content: outcome.payload,
			})
			return true
		}
	}

	if (isKnownTool && !block.nativeArgs && !customTool && !allowsEmptyNativeArgs) {
		const errorMessage =
			`Invalid tool call for '${block.name}': missing nativeArgs. ` +
			`This usually means the model streamed invalid or incomplete arguments and the call could not be finalized.`

		task.consecutiveMistakeCount++
		try {
			task.recordToolError(block.name as ToolName, errorMessage)
		} catch {
			// Best-effort only
		}

		// Push tool_result directly without setting didAlreadyUseTool so streaming can
		// continue gracefully.
		task.pushToolResultToUserContent({
			type: "tool_result",
			tool_use_id: sanitizeToolUseId(toolCallId),
			// This is the hot malformed-call path: the arguments never finalized, so
			// no tool ran and the model has nothing to learn from except the schema.
			// Send the minimal valid invocation with it.
			content: formatResponse.toolError(errorMessage, block.name),
			is_error: true,
		})

		return true
	}

	return false
}

/** The settings validation reads, from the provider state of this block. */
export interface ToolUseValidationContext {
	taskMode: string
	customModes: ModeConfig[] | undefined
	disabledTools: string[] | undefined
	stateExperiments: Experiments | undefined
}

/**
 * Validate a complete tool call before execution. Validating partial blocks
 * would throw repeatedly during streaming, pushing multiple tool_results for
 * the same tool_use_id and potentially making the stream appear frozen.
 */
export async function rejectInvalidToolUse(
	task: Task,
	block: ToolUse,
	toolCallId: string,
	{ taskMode, customModes, disabledTools, stateExperiments }: ToolUseValidationContext,
): Promise<boolean> {
	const modelInfo = task.api.getModel()
	// Resolve aliases in includedTools before validation
	// e.g., "edit_file" should resolve to "apply_diff"
	const rawIncludedTools = modelInfo?.info?.includedTools
	const { resolveToolAlias } = await import("../../prompts/tools/filter-tools-for-mode")
	const includedTools = rawIncludedTools?.map((tool) => resolveToolAlias(tool))

	try {
		const toolRequirements =
			disabledTools?.reduce(
				(acc: Record<string, boolean>, tool: string) => {
					acc[tool] = false
					const resolvedToolName = resolveToolAlias(tool)
					acc[resolvedToolName] = false
					return acc
				},
				{} as Record<string, boolean>,
			) ?? {}

		validateToolUse(
			block.name as ToolName,
			taskMode,
			customModes ?? [],
			toolRequirements,
			block.params,
			stateExperiments,
			includedTools,
			task.cwd,
		)
	} catch (error) {
		task.consecutiveMistakeCount++
		// The counter already grew on the line above, so record only the name here:
		// without this, `lastToolErrorName` stays stale and the mistake-limit guidance
		// names the wrong tool (or none) after a run of rejected calls.
		//
		// `validateToolUse` throws for a hallucinated tool name too, and `block.name`
		// is an arbitrary model-supplied string at this point. Recording it would let
		// that string into `Task.toolUsage` and into the `TaskToolFailed` telemetry
		// event, where every consumer expects a real `ToolName`. So record only names
		// that pass the same validity check the dispatcher uses; for an invalid name
		// the counter bump and the error envelope below are the whole response.
		if (isValidToolName(String(block.name), stateExperiments)) {
			task.recordToolError(block.name as ToolName, error.message)
		}
		// For validation errors (unknown tool, tool not allowed for mode), we need to:
		// 1. Send a tool_result with the error (required for native tool calling)
		// 2. NOT set didAlreadyUseTool = true (the tool was never executed, just failed validation)
		// This prevents the stream from being interrupted with "Response interrupted by tool use result"
		// which would cause the extension to appear to hang
		const errorContent = formatResponse.toolError(error.message, block.name)
		// Push tool_result directly without setting didAlreadyUseTool
		task.pushToolResultToUserContent({
			type: "tool_result",
			tool_use_id: sanitizeToolUseId(toolCallId),
			content: typeof errorContent === "string" ? errorContent : "(validation error)",
			is_error: true,
		})

		return true
	}

	return false
}

/** Stop a complete tool call that repeats the previous identical calls too often. */
export async function stopRepeatedToolCall(
	task: Task,
	block: ToolUse,
	pushToolResult: PushToolResult,
): Promise<boolean> {
	// Use the detector to check for repetition, passing the ToolUse
	// block directly.
	const repetitionCheck = task.toolRepetitionDetector.check(block)

	// If execution is not allowed, notify user and stop.
	if (repetitionCheck.allowExecution || !repetitionCheck.askUser) {
		return false
	}

	// Handle repetition similar to mistake_limit_reached pattern.
	const { response, text, images } = await task.askSay.ask(
		repetitionCheck.askUser.messageKey as ClineAsk,
		repetitionCheck.askUser.messageDetail.replace("{toolName}", block.name),
	)

	if (response === "messageResponse") {
		// Add user feedback to userContent.
		task.userMessageContent.push(
			{
				type: "text" as const,
				text: `Tool repetition limit reached. User feedback: ${text}`,
			},
			...formatResponse.imageBlocks(images),
		)

		// Add user feedback to chat.
		await task.askSay.say("user_feedback", text, images)
	}

	// Track tool repetition in telemetry as an exception and an event.
	TelemetryService.instance.capture(TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR, {
		taskId: task.taskId,
	})
	TelemetryService.instance.captureException(
		new ConsecutiveMistakeError(
			`Tool repetition limit reached for ${block.name}`,
			task.taskId,
			task.consecutiveMistakeCount,
			task.consecutiveMistakeLimit,
			"tool_repetition",
			task.apiConfiguration.apiProvider,
			task.api.getModel().id,
		),
	)

	// Return tool result message about the repetition
	pushToolResult(
		formatResponse.toolError(
			`Tool call repetition limit reached for ${block.name}. Please try a different approach.`,
			block.name,
		),
	)
	return true
}
