import type { ToolName, ClineAsk, ArtifactSpillSettings } from "@roo-code/types"
import { ConsecutiveMistakeError, TelemetryEventName, resolveMaxInlineToolResultBytes } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { customToolRegistry } from "@roo-code/core"

import { t } from "../../i18n"

import type { ToolParamName, ToolUse, McpToolUse } from "../../shared/tools"

import { Task } from "../task/Task"

import { useMcpToolTool } from "../tools/UseMcpToolTool"
import type { AttemptCompletionCallbacks } from "../tools/AttemptCompletionTool"
import type { ToolCallbacks } from "../tools/BaseTool"
import { describeToolUse } from "../tools/toolDescriptors"
import { isValidToolName, validateToolUse } from "../tools/validateToolUse"
import { isCheckpointedTool } from "../checkpoints/checkpointedTools"

import { formatResponse } from "../prompts/responses"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { tryAutoMaterializeDirectCall } from "../task/deferred-tools-resolver"

import { createToolCallbacks } from "./toolCallbacks"
import { getToolHandler } from "./toolHandlers"

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
async function prepareToolResultSpill(cline: Task, state?: ArtifactSpillSettings): Promise<void> {
	try {
		if (typeof cline.ensureToolResultSpill !== "function") {
			return
		}

		const resolvedState = state ?? (await cline.providerRef.deref()?.getState())
		await cline.ensureToolResultSpill(resolveMaxInlineToolResultBytes(resolvedState))
	} catch (error) {
		console.warn("[presentAssistantMessage] Could not prepare the tool-result spill policy:", error)
	}
}

export async function presentAssistantMessage(cline: Task) {
	if (cline.abort) {
		throw new Error(`[Task#presentAssistantMessage] task ${cline.taskId}.${cline.instanceId} aborted`)
	}

	if (cline.presentAssistantMessageLocked) {
		cline.presentAssistantMessageHasPendingUpdates = true
		return
	}

	cline.presentAssistantMessageLocked = true
	cline.presentAssistantMessageHasPendingUpdates = false

	if (cline.currentStreamingContentIndex >= cline.assistantMessageContent.length) {
		// This may happen if the last content block was completed before
		// streaming could finish. If streaming is finished, and we're out of
		// bounds then this means we already  presented/executed the last
		// content block and are ready to continue to next request.
		if (cline.didCompleteReadingStream) {
			cline.userMessageContentReady = true
		}

		cline.presentAssistantMessageLocked = false
		return
	}

	let block: any
	try {
		// Performance optimization: Use shallow copy instead of deep clone.
		// The block is used read-only throughout this function - we never mutate its properties.
		// We only need to protect against the reference changing during streaming, not nested mutations.
		// This provides 80-90% reduction in cloning overhead (5-100ms saved per block).
		block = { ...cline.assistantMessageContent[cline.currentStreamingContentIndex] }
	} catch (error) {
		console.error(`ERROR cloning block:`, error)
		console.error(
			`Block content:`,
			JSON.stringify(cline.assistantMessageContent[cline.currentStreamingContentIndex], null, 2),
		)
		cline.presentAssistantMessageLocked = false
		return
	}

	switch (block.type) {
		case "mcp_tool_use": {
			// Handle native MCP tool calls (from mcp_serverName_toolName dynamic tools)
			// These are converted to the same execution path as use_mcp_tool but preserve
			// their original name in API history
			const mcpBlock = block as McpToolUse

			if (cline.didRejectTool) {
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = mcpBlock.id
				const errorMessage = !mcpBlock.partial
					? `Skipping MCP tool ${mcpBlock.name} due to user rejecting a previous tool.`
					: `MCP tool ${mcpBlock.name} was interrupted and not executed due to user rejecting a previous tool.`

				if (toolCallId) {
					cline.pushToolResultToUserContent({
						type: "tool_result",
						tool_use_id: sanitizeToolUseId(toolCallId),
						content: errorMessage,
						is_error: true,
					})
				}
				break
			}

			const toolCallId = mcpBlock.id
			// MCP results are recorded under `use_mcp_tool`, the tool that runs them.
			const { askApproval, handleError, pushToolResult } = createToolCallbacks(cline, {
				block: mcpBlock,
				toolCallId,
				toolName: "use_mcp_tool",
			})

			if (!mcpBlock.partial) {
				cline.recordToolUsage("use_mcp_tool") // Record as use_mcp_tool for analytics
				TelemetryService.instance.captureToolUsage(cline.taskId, "use_mcp_tool")

				// Prepare the tool-result spill policy before the tool runs: MCP
				// servers are a classic source of multi-hundred-KB payloads.
				// Only on the final block, so streaming stays allocation-free.
				await prepareToolResultSpill(cline)

				// Auto-materialize: if the model called a deferred MCP tool directly
				// (without using `tools_load` first), promote it to the active set so
				// the next turn carries the full schema. The live MCP execution below
				// works regardless. Gated on the deferredTools experiment so behaviour
				// is byte-identical with the flag off. See ai_plans/deferred-tool-loading.md §8.3.
				try {
					const stateForResolver = await cline.providerRef.deref()?.getState()
					tryAutoMaterializeDirectCall({
						task: cline,
						blockName: mcpBlock.name,
						nativeArgs: mcpBlock.arguments,
						experiments: stateForResolver?.experiments,
					})
				} catch (resolverErr) {
					// Resolver is best-effort — never block a live MCP execution if it throws.
					console.warn("[presentAssistantMessage] auto-materialize hook failed:", resolverErr)
				}
			}

			// Resolve sanitized server name back to original server name
			// The serverName from parsing is sanitized (e.g., "my_server" from "my server")
			// We need the original name to find the actual MCP connection
			const mcpHub = cline.providerRef.deref()?.getMcpHub()
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

			await useMcpToolTool.handle(cline, syntheticToolUse, {
				askApproval,
				handleError,
				pushToolResult,
			})
			break
		}
		case "text": {
			if (cline.didRejectTool || cline.didAlreadyUseTool) {
				break
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

			await cline.askSay.say("text", content, undefined, block.partial)
			break
		}
		case "tool_use": {
			// Native tool calling is the only supported tool calling mechanism.
			// A tool_use block without an id is invalid and cannot be executed.
			const toolCallId = (block as any).id as string | undefined
			if (!toolCallId) {
				const errorMessage =
					"Invalid tool call: missing tool_use.id. XML tool calls are no longer supported. Remove any XML tool markup (e.g. <read_file>...</read_file>) and use native tool calling instead."
				// Record a tool error for visibility/telemetry. Use the reported tool name if present.
				try {
					if (
						typeof (cline as any).recordToolError === "function" &&
						typeof (block as any).name === "string"
					) {
						;(cline as any).recordToolError((block as any).name as ToolName, errorMessage)
					}
				} catch {
					// Best-effort only
				}
				cline.consecutiveMistakeCount++
				await cline.askSay.say("error", errorMessage)
				cline.userMessageContent.push({ type: "text", text: errorMessage })
				cline.didAlreadyUseTool = true
				break
			}

			// Fetch state early so it's available for toolDescription and validation
			const state = await cline.providerRef.deref()?.getState()
			const { customModes, experiments: stateExperiments, disabledTools } = state ?? {}
			// The task's own mode, not the one in provider state: that is the focused task's
			// mode, and a background subagent or a delegated child may run in another one.
			const taskMode = await cline.getTaskMode()

			// Prepare the tool-result spill policy before the tool runs, so the
			// (synchronous) push below can move an oversized result to disk.
			await prepareToolResultSpill(cline, state)

			// One line naming the call, from the tool's row in the descriptor table.
			const toolDescription = (): string => describeToolUse(block, { customModes })

			if (cline.didRejectTool) {
				// Ignore any tool content after user has rejected tool once.
				// For native tool calling, we must send a tool_result for every tool_use to avoid API errors
				const errorMessage = !block.partial
					? `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`
					: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`

				cline.pushToolResultToUserContent({
					type: "tool_result",
					tool_use_id: sanitizeToolUseId(toolCallId),
					content: errorMessage,
					is_error: true,
				})

				break
			}

			// If this is a native tool call but the parser couldn't construct nativeArgs
			// (e.g., malformed/unfinished JSON in a streaming tool call), we must NOT attempt to
			// execute the tool. Instead, emit exactly one structured tool_result so the provider
			// receives a matching tool_result for the tool_use_id.
			//
			// This avoids executing an invalid tool_use block and prevents duplicate/fragmented
			// error reporting.
			if (!block.partial) {
				const customTool = stateExperiments?.customTools ? customToolRegistry.get(block.name) : undefined
				const isKnownTool = isValidToolName(String(block.name), stateExperiments)
				// Allow-list: tools that own their own missing-args handling and
				// MUST be allowed to reach their handler with empty/undefined
				// nativeArgs. Weak tool-calling models routinely emit `tools_load`
				// with `input: {}` — the ToolsLoadTool handler converts that into
				// structured guidance instead of an error. Gated by `deferredTools`
				// so behaviour with the experiment OFF is byte-identical to today.
				// See ai_plans/deferred-tool-loading.md §8.2.
				const allowsEmptyNativeArgs = stateExperiments?.deferredTools === true && block.name === "tools_load"

				// Auto-materialize: a direct call to a deferred tool name without
				// args. Resolver returns `guidance` with the schema inlined so the
				// model can retry next turn with valid args. Gated on the
				// `deferredTools` experiment. See §8.3.
				if (!block.nativeArgs && !customTool && stateExperiments?.deferredTools === true) {
					const outcome = tryAutoMaterializeDirectCall({
						task: cline,
						blockName: block.name,
						nativeArgs: block.nativeArgs,
						experiments: stateExperiments,
					})
					if (outcome && outcome.kind === "guidance") {
						cline.pushToolResultToUserContent({
							type: "tool_result",
							tool_use_id: sanitizeToolUseId(toolCallId),
							content: outcome.payload,
						})
						break
					}
				}

				if (isKnownTool && !block.nativeArgs && !customTool && !allowsEmptyNativeArgs) {
					const errorMessage =
						`Invalid tool call for '${block.name}': missing nativeArgs. ` +
						`This usually means the model streamed invalid or incomplete arguments and the call could not be finalized.`

					cline.consecutiveMistakeCount++
					try {
						cline.recordToolError(block.name as ToolName, errorMessage)
					} catch {
						// Best-effort only
					}

					// Push tool_result directly without setting didAlreadyUseTool so streaming can
					// continue gracefully.
					cline.pushToolResultToUserContent({
						type: "tool_result",
						tool_use_id: sanitizeToolUseId(toolCallId),
						// This is the hot malformed-call path: the arguments never finalized, so
						// no tool ran and the model has nothing to learn from except the schema.
						// Send the minimal valid invocation with it.
						content: formatResponse.toolError(errorMessage, block.name),
						is_error: true,
					})

					break
				}
			}

			const { askApproval, handleError, pushToolResult, askFinishSubTaskApproval } = createToolCallbacks(cline, {
				block,
				toolCallId,
				toolName: String(block.name),
			})

			if (!block.partial) {
				// Check if this is a custom tool - if so, record as "custom_tool" (like MCP tools)
				const isCustomTool = stateExperiments?.customTools && customToolRegistry.has(block.name)
				const recordName = isCustomTool ? "custom_tool" : block.name
				cline.recordToolUsage(recordName)
				TelemetryService.instance.captureToolUsage(cline.taskId, recordName)

				// Track legacy format usage for read_file tool (for migration monitoring)
				if (block.name === "read_file" && block.usedLegacyFormat) {
					const modelInfo = cline.api.getModel()
					TelemetryService.instance.captureEvent(TelemetryEventName.READ_FILE_LEGACY_FORMAT_USED, {
						taskId: cline.taskId,
						model: modelInfo?.id,
					})
				}
			}

			// Validate tool use before execution - ONLY for complete (non-partial) blocks.
			// Validating partial blocks would cause validation errors to be thrown repeatedly
			// during streaming, pushing multiple tool_results for the same tool_use_id and
			// potentially causing the stream to appear frozen.
			if (!block.partial) {
				const modelInfo = cline.api.getModel()
				// Resolve aliases in includedTools before validation
				// e.g., "edit_file" should resolve to "apply_diff"
				const rawIncludedTools = modelInfo?.info?.includedTools
				const { resolveToolAlias } = await import("../prompts/tools/filter-tools-for-mode")
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
						cline.cwd,
					)
				} catch (error) {
					cline.consecutiveMistakeCount++
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
						cline.recordToolError(block.name as ToolName, error.message)
					}
					// For validation errors (unknown tool, tool not allowed for mode), we need to:
					// 1. Send a tool_result with the error (required for native tool calling)
					// 2. NOT set didAlreadyUseTool = true (the tool was never executed, just failed validation)
					// This prevents the stream from being interrupted with "Response interrupted by tool use result"
					// which would cause the extension to appear to hang
					const errorContent = formatResponse.toolError(error.message, block.name)
					// Push tool_result directly without setting didAlreadyUseTool
					cline.pushToolResultToUserContent({
						type: "tool_result",
						tool_use_id: sanitizeToolUseId(toolCallId),
						content: typeof errorContent === "string" ? errorContent : "(validation error)",
						is_error: true,
					})

					break
				}
			}

			// Check for identical consecutive tool calls.
			if (!block.partial) {
				// Use the detector to check for repetition, passing the ToolUse
				// block directly.
				const repetitionCheck = cline.toolRepetitionDetector.check(block)

				// If execution is not allowed, notify user and break.
				if (!repetitionCheck.allowExecution && repetitionCheck.askUser) {
					// Handle repetition similar to mistake_limit_reached pattern.
					const { response, text, images } = await cline.askSay.ask(
						repetitionCheck.askUser.messageKey as ClineAsk,
						repetitionCheck.askUser.messageDetail.replace("{toolName}", block.name),
					)

					if (response === "messageResponse") {
						// Add user feedback to userContent.
						cline.userMessageContent.push(
							{
								type: "text" as const,
								text: `Tool repetition limit reached. User feedback: ${text}`,
							},
							...formatResponse.imageBlocks(images),
						)

						// Add user feedback to chat.
						await cline.askSay.say("user_feedback", text, images)
					}

					// Track tool repetition in telemetry via PostHog exception tracking and event.
					TelemetryService.instance.captureConsecutiveMistakeError(cline.taskId)
					TelemetryService.instance.captureException(
						new ConsecutiveMistakeError(
							`Tool repetition limit reached for ${block.name}`,
							cline.taskId,
							cline.consecutiveMistakeCount,
							cline.consecutiveMistakeLimit,
							"tool_repetition",
							cline.apiConfiguration.apiProvider,
							cline.api.getModel().id,
						),
					)

					// Return tool result message about the repetition
					pushToolResult(
						formatResponse.toolError(
							`Tool call repetition limit reached for ${block.name}. Please try a different approach.`,
							block.name,
						),
					)
					break
				}
			}

			// One list decides which tools get a checkpoint before they run; the
			// early start in TaskStreamProcessor reads the same list.
			if (isCheckpointedTool(block.name)) {
				await checkpointSaveAndMark(cline)
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
				await handler.handle(cline, block, callbacks)
				break
			}

			// Handle unknown/invalid tool names OR custom tools
			// This is critical for native tool calling where every tool_use MUST have a tool_result

			// CRITICAL: Don't process partial blocks for unknown tools - just let them stream in.
			// If we try to show errors for partial blocks, we'd show the error on every streaming chunk,
			// creating a loop that appears to freeze the extension. Only handle complete blocks.
			if (block.partial) {
				break
			}

			const customTool = stateExperiments?.customTools ? customToolRegistry.get(block.name) : undefined

			if (customTool) {
				try {
					let customToolArgs

					if (customTool.parameters) {
						try {
							customToolArgs = customTool.parameters.parse(block.nativeArgs || block.params || {})
						} catch (parseParamsError) {
							const message = `Custom tool "${block.name}" argument validation failed: ${parseParamsError.message}`
							console.error(message)
							cline.consecutiveMistakeCount++
							await cline.askSay.say("error", message)
							pushToolResult(formatResponse.toolError(message))
							break
						}
					}

					const result = await customTool.execute(customToolArgs, {
						mode: taskMode,
						task: cline,
					})

					console.log(
						`${customTool.name}.execute(): ${JSON.stringify(customToolArgs)} -> ${JSON.stringify(result)}`,
					)

					pushToolResult(result)
					cline.consecutiveMistakeCount = 0
				} catch (executionError: any) {
					cline.consecutiveMistakeCount++
					// Record custom tool error with static name
					cline.recordToolError("custom_tool", executionError.message)
					// Deliberately 2-argument: the two lines above already did the mistake
					// accounting under the static `custom_tool` bucket, and passing a name
					// here would make `handleError` count the same failure a second time.
					// No example is lost either: a custom tool is called by its own
					// registered name and carries its own schema, so
					// `getToolMinimalExample` has nothing to attach for it by design.
					await handleError(`executing custom tool "${block.name}"`, executionError)
				}

				break
			}

			// Auto-materialize check before falling through to "Unknown tool".
			// If the name resolves in the deferred-tool directory, the model
			// called a deferred tool directly (instead of via `tools_load`):
			//   - guidance → push schema as result and break.
			//   - ready    → push a synthesised success-style guidance: we
			//                still cannot execute (no live handler on this
			//                turn) but the schema is now active, so the
			//                model retries next turn. Either way it's
			//                strictly better than an "Unknown tool" error.
			// Gated on the `deferredTools` experiment. See §8.3.
			if (stateExperiments?.deferredTools === true) {
				const outcome = tryAutoMaterializeDirectCall({
					task: cline,
					blockName: block.name,
					nativeArgs: block.nativeArgs,
					experiments: stateExperiments,
				})
				if (outcome) {
					const content =
						outcome.kind === "guidance"
							? outcome.payload
							: `Tool \`${block.name}\` was deferred but is now available. ` +
								`Its full schema will be in your tools list next turn — retry it then.`
					cline.pushToolResultToUserContent({
						type: "tool_result",
						tool_use_id: sanitizeToolUseId(toolCallId),
						content,
					})
					break
				}
			}

			// Not a custom tool - handle as unknown tool error
			const errorMessage = `Unknown tool "${block.name}". This tool does not exist. Please use one of the available tools.`
			cline.consecutiveMistakeCount++
			cline.recordToolError(block.name as ToolName, errorMessage)
			await cline.askSay.say("error", t("tools:unknownToolError", { toolName: block.name }))
			// Push tool_result directly WITHOUT setting didAlreadyUseTool
			// This prevents the stream from being interrupted with "Response interrupted by tool use result"
			cline.pushToolResultToUserContent({
				type: "tool_result",
				tool_use_id: sanitizeToolUseId(toolCallId),
				// The name is passed for consistency with every other error envelope.
				// An unknown name yields no example, but a hallucinated variant of a real
				// name (`list_file`) yields nothing either, so nothing misleading is added.
				content: formatResponse.toolError(errorMessage, block.name),
				is_error: true,
			})
			break
		}
	}

	// Seeing out of bounds is fine, it means that the next too call is being
	// built up and ready to add to assistantMessageContent to present.
	// When you see the UI inactive during this, it means that a tool is
	// breaking without presenting any UI. For example the write_to_file tool
	// was breaking when relpath was undefined, and for invalid relpath it never
	// presented UI.
	// This needs to be placed here, if not then calling
	// cline.presentAssistantMessage below would fail (sometimes) since it's
	// locked.
	cline.presentAssistantMessageLocked = false

	// NOTE: When tool is rejected, iterator stream is interrupted and it waits
	// for `userMessageContentReady` to be true. Future calls to present will
	// skip execution since `didRejectTool` and iterate until `contentIndex` is
	// set to message length and it sets userMessageContentReady to true itself
	// (instead of preemptively doing it in iterator).
	if (!block.partial || cline.didRejectTool || cline.didAlreadyUseTool) {
		// Block is finished streaming and executing.
		if (cline.currentStreamingContentIndex === cline.assistantMessageContent.length - 1) {
			// It's okay that we increment if !didCompleteReadingStream, it'll
			// just return because out of bounds and as streaming continues it
			// will call `presentAssitantMessage` if a new block is ready. If
			// streaming is finished then we set `userMessageContentReady` to
			// true when out of bounds. This gracefully allows the stream to
			// continue on and all potential content blocks be presented.
			// Last block is complete and it is finished executing
			cline.userMessageContentReady = true // Will allow `pWaitFor` to continue.
		}

		// Call next block if it exists (if not then read stream will call it
		// when it's ready).
		// Need to increment regardless, so when read stream calls this function
		// again it will be streaming the next block.
		cline.currentStreamingContentIndex++

		if (cline.currentStreamingContentIndex < cline.assistantMessageContent.length) {
			// There are already more content blocks to stream, so we'll call
			// this function ourselves.
			presentAssistantMessage(cline)
			return
		} else {
			// CRITICAL FIX: If we're out of bounds and the stream is complete, set userMessageContentReady
			// This handles the case where assistantMessageContent is empty or becomes empty after processing
			if (cline.didCompleteReadingStream) {
				cline.userMessageContentReady = true
			}
		}
	}

	// Block is partial, but the read stream may have finished.
	if (cline.presentAssistantMessageHasPendingUpdates) {
		presentAssistantMessage(cline)
	}
}

/**
 * save checkpoint and mark done in the current streaming task.
 * @param task The Task instance to checkpoint save and mark.
 * @returns
 */
async function checkpointSaveAndMark(task: Task) {
	if (task.currentStreamingDidCheckpoint) {
		return
	}
	try {
		// Prefer the checkpoint started eagerly at tool_call_start (it overlapped
		// the write tool's argument streaming); fall back to a cold save.
		await (task.pendingCheckpointSave ?? task.checkpointSave(true))
		task.currentStreamingDidCheckpoint = true
	} catch (error) {
		console.error(`[Task#presentAssistantMessage] Error saving checkpoint: ${error.message}`, error)
	} finally {
		task.pendingCheckpointSave = undefined
	}
}
