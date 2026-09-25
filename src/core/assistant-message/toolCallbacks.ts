import { serializeError } from "serialize-error"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ToolName, ClineAsk, ToolProgressStatus } from "@roo-code/types"

import type {
	AskApproval,
	AskFinishSubTaskApproval,
	HandleError,
	PushToolResult,
	ToolResponse,
} from "../../shared/tools"

import { AskIgnoredError } from "../task/AskIgnoredError"
import type { Task } from "../task/Task"

import { formatResponse } from "../prompts/responses"
import { sanitizeToolUseId } from "../../utils/tool-id"

/**
 * Mistake accounting for a tool failure reported through `handleError`.
 *
 * Before this existed, only the malformed-call paths grew `consecutiveMistakeCount`: a tool
 * that failed at RUNTIME on every single turn (unreadable file, failing command, diff that
 * cannot be applied) was invisible to the circuit breaker and to `lastToolErrorName`, so the
 * mistake-limit guidance could not even name the tool that kept failing. Doing it here, in
 * the one callback every tool routes its failures through, means one rule for all call sites
 * and no per-tool bookkeeping to forget in the next tool.
 *
 * Four guards:
 *
 * - No `toolName`: the caller opted out on purpose. The custom-tool catch does its own
 *   accounting under the static `custom_tool` bucket, and counting it here as well would
 *   charge the model twice for one failure.
 * - `AskIgnoredError`: internal control flow (a newer ask superseded an older one), not a
 *   model mistake. The closures already return early on it; this guard keeps the helper
 *   correct on its own.
 * - `abort` / `abandoned`: a user cancel tears tools down mid-flight, and those failures
 *   belong to the cancel, not to the model.
 * - `resultAlreadyDelivered`: the tool ALREADY pushed its result for this block, so the
 *   failure now being reported happened after the call succeeded. Several tools push the
 *   success result and only then run their trailing cleanup (`diffViewProvider.reset()`,
 *   `processQueuedMessages()`) inside the same `try`, and the safety net in
 *   `BaseTool.handle` forwards anything that escapes there to this same closure. Counting
 *   it would charge the model a mistake for a tool that worked and would leave
 *   `lastToolErrorName` pointing at it, while `pushToolResult` drops the error envelope as
 *   a duplicate anyway, so the model never even learns why it was charged.
 */
function recordToolFailureAsMistake(
	cline: Task,
	error: Error,
	toolName: string | undefined,
	resultAlreadyDelivered: boolean,
): void {
	if (!toolName || resultAlreadyDelivered || error instanceof AskIgnoredError || cline.abort || cline.abandoned) {
		return
	}

	cline.consecutiveMistakeCount++
	// The cast is safe for every caller: `toolName` originates either from a tool class's
	// own `name` (typed `ToolName`) or from a static literal in `presentAssistantMessage`.
	cline.recordToolError(toolName as ToolName, error.message)
}

export interface ToolCallbackOptions {
	/** The block being executed. Only its kind is read, to label the duplicate-result warning. */
	block: { type: "tool_use" | "mcp_tool_use" }
	/**
	 * The provider's id for this tool call, echoed back as `tool_use_id`. A `tool_use` block
	 * always has one (the dispatcher rejects it earlier otherwise); an `mcp_tool_use` block may
	 * not, and then no result is pushed because there is nothing to pair it with.
	 */
	toolCallId: string | undefined
	/** The name the result is recorded under (spill policy, telemetry). */
	toolName: string
}

export interface ToolCallbackSet {
	askApproval: AskApproval
	handleError: HandleError
	pushToolResult: PushToolResult
	askFinishSubTaskApproval: AskFinishSubTaskApproval
	/** Whether this block already delivered its one tool result. */
	hasToolResult: () => boolean
}

/**
 * Builds the callbacks `presentAssistantMessage` hands to a tool for ONE block.
 *
 * Every call returns a fresh set with its own state (the one-result-per-block flag and the
 * approval feedback waiting to be merged into the result), so two blocks never share it.
 */
export function createToolCallbacks(
	cline: Task,
	{ block, toolCallId, toolName }: ToolCallbackOptions,
): ToolCallbackSet {
	// Track if we've already pushed a tool result for this tool call: only ONE per call.
	let hasToolResult = false

	// Store approval feedback to merge into tool result (GitHub #10465)
	let approvalFeedback: { text: string; images?: string[] } | undefined

	const duplicateLabel = block.type === "mcp_tool_use" ? "mcp_tool_use" : "tool_use_id"

	const pushToolResult = (content: ToolResponse) => {
		if (hasToolResult) {
			console.warn(
				`[presentAssistantMessage] Skipping duplicate tool_result for ${duplicateLabel}: ${toolCallId}`,
			)
			return
		}

		let resultContent: string
		let imageBlocks: Anthropic.ImageBlockParam[] = []

		if (typeof content === "string") {
			resultContent = content || "(tool did not return anything)"
		} else {
			const textBlocks = content.filter((item) => item.type === "text")
			imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]
			resultContent =
				textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
				"(tool did not return anything)"
		}

		// Merge approval feedback into tool result (GitHub #10465)
		if (approvalFeedback) {
			const feedbackText = formatResponse.toolApprovedWithFeedback(approvalFeedback.text)
			resultContent = `${feedbackText}\n\n${resultContent}`

			// Feedback images go before the tool's own images.
			if (approvalFeedback.images) {
				const feedbackImageBlocks = formatResponse.imageBlocks(approvalFeedback.images)
				imageBlocks = [...feedbackImageBlocks, ...imageBlocks]
			}
		}

		if (toolCallId) {
			cline.pushToolResultToUserContent(
				{
					type: "tool_result",
					tool_use_id: sanitizeToolUseId(toolCallId),
					content: resultContent,
				},
				{ toolName },
			)

			if (imageBlocks.length > 0) {
				cline.userMessageContent.push(...imageBlocks)
			}
		}

		hasToolResult = true
	}

	const askApproval = async (
		type: ClineAsk,
		partialMessage?: string,
		progressStatus?: ToolProgressStatus,
		isProtected?: boolean,
	) => {
		const { response, text, images } = await cline.askSay.ask(
			type,
			partialMessage,
			false,
			progressStatus,
			isProtected || false,
		)

		if (response !== "yesButtonClicked") {
			// Handle both messageResponse and noButtonClicked with text.
			if (text) {
				await cline.askSay.say("user_feedback", text, images)
				pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
			} else {
				pushToolResult(formatResponse.toolDenied())
			}
			cline.didRejectTool = true
			return false
		}

		// Store approval feedback to be merged into tool result (GitHub #10465)
		// Don't push it as a separate tool_result here - that would create duplicates.
		// The tool will call pushToolResult, which will merge the feedback into the actual result.
		if (text) {
			await cline.askSay.say("user_feedback", text, images)
			approvalFeedback = { text, images }
		}

		return true
	}

	const askFinishSubTaskApproval = async () => {
		// Ask the user to approve this task has completed, and he has
		// reviewed it, and we can declare task is finished and return
		// control to the parent task to continue running the rest of
		// the sub-tasks.
		const toolMessage = JSON.stringify({ tool: "finishTask" })
		return await askApproval("tool", toolMessage)
	}

	const handleError = async (action: string, error: Error, failedToolName?: string) => {
		// Silently ignore AskIgnoredError - this is an internal control flow
		// signal, not an actual error. It occurs when a newer ask supersedes an older one.
		if (error instanceof AskIgnoredError) {
			return
		}
		// Count the failure before anything that can itself fail, so a broken UI
		// channel cannot silently drop the accounting. `hasToolResult` reports whether
		// this block already delivered its result: if it did, the tool SUCCEEDED and
		// this error comes from its trailing cleanup, which is not a model mistake
		// (and whose envelope `pushToolResult` drops as a duplicate anyway).
		// On an aborting task this call is already a no-op: the helper returns early
		// when `cline.abort` is set, so the guard below cannot lose any accounting.
		recordToolFailureAsMistake(cline, error, failedToolName, hasToolResult)

		// Silently ignore errors raised while the task is aborting. ask()/say()
		// throw a plain abort Error when access.abort is set; reporting it via
		// say() would re-throw (say() is itself abort-gated) and crash the
		// process. The abort is intentional, so there is nothing to surface.
		if (cline.abort) {
			return
		}

		const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`

		await cline.askSay.say(
			"error",
			`Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
		)

		// `failedToolName` rides beside the serialized error, never inside it, so the minimal
		// valid example lands as a nested object the model can copy verbatim.
		pushToolResult(formatResponse.toolError(errorString, failedToolName))
	}

	return {
		askApproval,
		handleError,
		pushToolResult,
		askFinishSubTaskApproval,
		hasToolResult: () => hasToolResult,
	}
}
