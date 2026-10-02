import type { ToolName, Experiments } from "@tumble-code/types"
import { TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"
import { customToolRegistry } from "@tumble-code/core"

import { t } from "../../../i18n"

import type { HandleError, PushToolResult, ToolUse } from "../../../shared/tools"

import type { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { sanitizeToolUseId } from "../../../utils/tool-id"
import { tryAutoMaterializeDirectCall } from "../../task/deferred-tools-resolver"
import { logger } from "../../../utils/logging"

/*
 * The steps that run a tool_use block once it passed the guards in
 * toolUseGuards.ts: usage accounting, the checkpoint, and the answers for a
 * name no built-in handler owns (custom tool, deferred tool, unknown tool).
 */

/** Record a complete tool call for usage stats and telemetry. */
export function recordToolUse(task: Task, block: ToolUse, stateExperiments: Experiments | undefined): void {
	// Check if this is a custom tool - if so, record as "custom_tool" (like MCP tools)
	const isCustomTool = stateExperiments?.customTools && customToolRegistry.has(block.name)
	const recordName = isCustomTool ? "custom_tool" : block.name
	task.recordToolUsage(recordName)
	TelemetryService.instance.capture(TelemetryEventName.TOOL_USED, {
		taskId: task.taskId,
		tool: recordName,
	})

	// Track legacy format usage for read_file tool (for migration monitoring)
	if (block.name === "read_file" && block.usedLegacyFormat) {
		const modelInfo = task.api.getModel()
		TelemetryService.instance.captureEvent(TelemetryEventName.READ_FILE_LEGACY_FORMAT_USED, {
			taskId: task.taskId,
			model: modelInfo?.id,
		})
	}
}

/**
 * save checkpoint and mark done in the current streaming task.
 * @param task The Task instance to checkpoint save and mark.
 * @returns
 */
export async function checkpointSaveAndMark(task: Task) {
	if (task.currentStreamingDidCheckpoint) {
		return
	}
	try {
		// Prefer the checkpoint started eagerly at tool_call_start (it overlapped
		// the write tool's argument streaming); fall back to a cold save.
		await (task.pendingCheckpointSave ?? task.checkpointSave(true))
		task.currentStreamingDidCheckpoint = true
	} catch (error) {
		logger.error(`[Task#presentAssistantMessage] Error saving checkpoint: ${error.message}`, error)
	} finally {
		task.pendingCheckpointSave = undefined
	}
}

type CustomTool = NonNullable<ReturnType<typeof customToolRegistry.get>>

/** Parse the arguments of a custom tool, run it and push its result. */
export async function runCustomTool(
	task: Task,
	block: ToolUse,
	customTool: CustomTool,
	taskMode: string,
	pushToolResult: PushToolResult,
	handleError: HandleError,
): Promise<void> {
	try {
		let customToolArgs

		if (customTool.parameters) {
			try {
				customToolArgs = customTool.parameters.parse(block.nativeArgs || block.params || {})
			} catch (parseParamsError) {
				const message = `Custom tool "${block.name}" argument validation failed: ${parseParamsError.message}`
				logger.error(message)
				task.consecutiveMistakeCount++
				await task.askSay.say("error", message)
				pushToolResult(formatResponse.toolError(message))
				return
			}
		}

		const result = await customTool.execute(customToolArgs, {
			mode: taskMode,
			task,
		})

		logger.debug(`${customTool.name}.execute(): ${JSON.stringify(customToolArgs)} -> ${JSON.stringify(result)}`)

		pushToolResult(result)
		task.consecutiveMistakeCount = 0
	} catch (executionError: any) {
		task.consecutiveMistakeCount++
		// Record custom tool error with static name
		task.recordToolError("custom_tool", executionError.message)
		// Deliberately 2-argument: the two lines above already did the mistake
		// accounting under the static `custom_tool` bucket, and passing a name
		// here would make `handleError` count the same failure a second time.
		// No example is lost either: a custom tool is called by its own
		// registered name and carries its own schema, so
		// `getToolMinimalExample` has nothing to attach for it by design.
		await handleError(`executing custom tool "${block.name}"`, executionError)
	}
}

/**
 * Auto-materialize check before falling through to "Unknown tool". If the
 * name resolves in the deferred-tool directory, the model called a deferred
 * tool directly (instead of via `tools_load`):
 *   - guidance: push schema as result.
 *   - ready: push a synthesised success-style guidance: we still cannot
 *     execute (no live handler on this turn) but the schema is now active,
 *     so the model retries next turn. Either way it's strictly better than
 *     an "Unknown tool" error.
 * Gated on the `deferredTools` experiment. See §8.3. Returns true when it
 * answered the block.
 */
export function answerDeferredDirectCall(
	task: Task,
	block: ToolUse,
	toolCallId: string,
	stateExperiments: Experiments | undefined,
): boolean {
	if (stateExperiments?.deferredTools !== true) {
		return false
	}

	const outcome = tryAutoMaterializeDirectCall({
		task,
		blockName: block.name,
		nativeArgs: block.nativeArgs,
		experiments: stateExperiments,
	})
	if (!outcome) {
		return false
	}

	const content =
		outcome.kind === "guidance"
			? outcome.payload
			: `Tool \`${block.name}\` was deferred but is now available. ` +
				`Its full schema will be in your tools list next turn \u2014 retry it then.`
	task.pushToolResultToUserContent({
		type: "tool_result",
		tool_use_id: sanitizeToolUseId(toolCallId),
		content,
	})
	return true
}

/** Answer a complete call of a tool that does not exist. */
export async function rejectUnknownTool(task: Task, block: ToolUse, toolCallId: string): Promise<void> {
	const errorMessage = `Unknown tool "${block.name}". This tool does not exist. Please use one of the available tools.`
	task.consecutiveMistakeCount++
	task.recordToolError(block.name as ToolName, errorMessage)
	await task.askSay.say("error", t("tools:unknownToolError", { toolName: block.name }))
	// Push tool_result directly WITHOUT setting didAlreadyUseTool
	// This prevents the stream from being interrupted with "Response interrupted by tool use result"
	task.pushToolResultToUserContent({
		type: "tool_result",
		tool_use_id: sanitizeToolUseId(toolCallId),
		// The name is passed for consistency with every other error envelope.
		// An unknown name yields no example, but a hallucinated variant of a real
		// name (`list_file`) yields nothing either, so nothing misleading is added.
		content: formatResponse.toolError(errorMessage, block.name),
		is_error: true,
	})
}
