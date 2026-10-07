/**
 * ApiRequestBuilder - Handles building API request components
 *
 * This module extracts the API request building logic from TaskApiLoop,
 * including system prompt construction, tools array building, and
 * conversation history preparation.
 *
 * Extracted from: TaskApiLoop.ts (Phase 2A refactoring)
 */

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import pWaitFor from "p-wait-for"
import {
	type ModelInfo,
	type ProviderSettings,
	type ToolName,
	type ClineApiReqInfo,
	TumbleCodeEventName,
	getModelId,
	isParallelTasksEnabled,
} from "@tumble-code/types"
import { type ApiHandler } from "../../api"
import { getRuntimeProviderCapabilities } from "../../api/runtime-provider-registry"
import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { SYSTEM_PROMPT } from "../prompts/system"
import { buildSystemPromptInput, isMcpEnabledForPrompt } from "../prompts/system-prompt-input"
import { applyMicrocompactCleared } from "../context-management/microcompact"
import { applyReasoningTrims } from "../context-management/reasoningTrim"
import { buildNativeToolsArrayWithRestrictions } from "./build-tools"
import { type TaskContextManager, MAX_CONTEXT_WINDOW_RETRIES } from "./TaskContextManager"
import { getModelMaxOutputTokens } from "@tumble-code/core/browser"
import { type ClineProvider } from "../webview/ClineProvider"
import { type ProviderState } from "../webview/ProviderStateBuilder"
import { type ApiMessage } from "../task-persistence"
import { type RooIgnoreController } from "../ignore/RooIgnoreController"
import { logger } from "../../utils/logging"
import {
	TaskApiConfigurationAccess,
	TaskApiConversationHistoryAccess,
	TaskApiHandlerAccess,
	TaskBackgroundFlagAccess,
	TaskIdAccess,
	TaskProviderRefAccess,
	TaskWorkingDirectoryAccess,
} from "./access-groups"

/**
 * Whether the handler returns encrypted reasoning (OpenAI Native, Codex) and so can take
 * its own encrypted reasoning items back in the next request. The same check decides in
 * TaskMessageLog whether such an item is stored at all.
 */
function roundTripsEncryptedReasoning(api: ApiHandler): boolean {
	return typeof (api as { getEncryptedContent?: unknown }).getEncryptedContent === "function"
}

/**
 * Interface for access needed by ApiRequestBuilder.
 * This is a narrow interface to minimize coupling.
 */
export interface ApiRequestBuilderAccess
	extends TaskIdAccess,
		TaskProviderRefAccess,
		TaskApiHandlerAccess,
		TaskApiConfigurationAccess,
		TaskApiConversationHistoryAccess,
		TaskBackgroundFlagAccess,
		TaskWorkingDirectoryAccess {
	instanceId: string

	// Non-destructive microcompaction: transient set of tool_use_ids whose results
	// are cleared, and `reasoning:<ts>` keys (reasoningTrimKey) whose reasoning is
	// trimmed, on the OUTGOING request copy (stored history stays pristine).
	// Recomputed each request by the context manager. See applyMicrocompactCleared
	// and applyReasoningTrims.
	microcompactedIds: ReadonlySet<string>

	// Context manager for context management
	contextManager: TaskContextManager

	// The task's .rooignore controller. Its instructions go into the system prompt,
	// exactly as the "copy system prompt" preview (generateSystemPrompt) sends them.
	// Undefined once the task is disposed.
	readonly rooIgnoreController?: RooIgnoreController

	// Token usage
	getTokenUsage(): { contextTokens?: number }

	// The task's own mode (see Task#getTaskMode). Provider state holds the FOCUSED
	// task's mode, which a background subagent or a delegated child does not share.
	getTaskMode(): Promise<string>

	// Methods
	emit: (event: any, ...args: any[]) => boolean

	// Deferred-tool loading state (Phase 4 of ai_plans/archive/undated/deferred-tool-loading.md).
	// These come straight off the Task instance; the apiRequestBuilder reads
	// `materializedDeferredTools` to re-promote loaded schemas and writes back
	// the per-request `deferredToolDirectory` so `tools_load` can resolve names.
	materializedDeferredTools: Set<string>
	deferredToolDirectory: Map<string, OpenAI.Chat.ChatCompletionTool>
}

/**
 * Result of building tools array
 */
export interface ToolsArrayResult {
	allTools: OpenAI.Chat.ChatCompletionTool[]
	allowedFunctionNames: string[] | undefined
	/** Catalog of deferred (withheld) tools. See ai_plans/archive/undated/deferred-tool-loading.md. */
	deferredCatalog?: import("./deferred-tools").DeferredCatalog
}

/**
 * ApiRequestBuilder handles the construction of API request components.
 * This includes system prompts, tools arrays, and conversation history.
 */
/**
 * A reasoning block stored as the first content block of an assistant message.
 * Stored history holds these next to Anthropic blocks, but Anthropic's
 * ContentBlockParam union does not list them, hence this local shape.
 */
type EmbeddedReasoningBlock = {
	type: "reasoning"
	encrypted_content?: unknown
	text?: unknown
	summary?: unknown[]
	id?: string
}

function asEmbeddedReasoningBlock(block: unknown): EmbeddedReasoningBlock | undefined {
	return (block as { type?: unknown } | undefined)?.type === "reasoning"
		? (block as EmbeddedReasoningBlock)
		: undefined
}

export class ApiRequestBuilder {
	constructor(private readonly access: ApiRequestBuilderAccess) {}

	/**
	 * Build the system prompt with MCP, mode, and custom instructions.
	 *
	 * `cycleState` is the request cycle's state snapshot (P5): one
	 * `getState()` per cycle instead of two reads here. When it is omitted
	 * (standalone callers: `generateSystemPrompt`, condense paths) the
	 * builder reads live, as before. The MCP-enabled exception: the connect
	 * wait can take up to 10 s, and the documented invariant
	 * ("settings changed meanwhile are current", see the old comment below)
	 * must survive it — so when the wait ran, the post-wait read stays live.
	 */
	async buildSystemPrompt(cycleState?: ProviderState): Promise<string> {
		let mcpHub: McpHub | undefined
		if (isMcpEnabledForPrompt(cycleState ?? (await this.access.providerRef.deref()?.getState()))) {
			const provider = this.access.providerRef.deref()

			if (!provider) {
				throw new Error("Provider reference lost during view transition")
			}

			mcpHub = await McpServerManager.getInstance(provider.context, provider)

			if (!mcpHub) {
				throw new Error("Failed to get MCP hub from server manager")
			}

			await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(() => {
				logger.error("MCP servers failed to connect in time")
			})
		}

		// P5: use the cycle snapshot when no MCP wait ran above (the common
		// case — no hub work means nothing waited, so nothing could have
		// raced). When the wait DID run, read live: settings changed during
		// those up to 10 seconds must still be current (the pre-P5
		// invariant, kept deliberately for this case).
		const state = cycleState && !mcpHub ? cycleState : await this.access.providerRef.deref()?.getState()

		const provider = this.access.providerRef.deref()

		if (!provider) {
			throw new Error("Provider not available")
		}

		// The same builder serves the "copy system prompt" preview (generateSystemPrompt).
		return await SYSTEM_PROMPT(
			buildSystemPromptInput({
				context: provider.context,
				cwd: this.access.cwd,
				mode: await this.access.getTaskMode(),
				state,
				mcpHub,
				rooIgnoreController: this.access.rooIgnoreController,
				materializedDeferredTools: this.access.materializedDeferredTools,
				modelInfo: this.access.api.getModel().info,
				skillsManager: provider.getSkillsManager(),
			}),
		)
	}

	/**
	 * Build tools array for API request.
	 */
	async buildToolsArray(
		state: ProviderState | undefined,
		apiConfiguration: ProviderSettings | undefined,
		mode: string | undefined,
		modelInfo: ModelInfo,
	): Promise<ToolsArrayResult> {
		const provider = this.access.providerRef.deref()
		if (!provider) {
			throw new Error("Provider reference lost during tool building")
		}

		const supportsAllowedFunctionNames = getRuntimeProviderCapabilities(
			apiConfiguration?.apiProvider,
		).allowedFunctionNames

		// Background tasks (parallel subagents, memory writers) never get
		// delegation tools: a subtask is a small one-shot job that must return
		// to its parent, not fan out further. Foreground tasks lose
		// run_parallel_tasks when the user's concurrency cap turns the feature
		// Off (< 2). Routed through disabledTools so the existing
		// alias-resolving filter removes them.
		let disabledTools = state?.disabledTools
		if (this.access.isBackground) {
			disabledTools = [...(disabledTools ?? []), "new_task", "run_parallel_tasks"]
		} else if (!isParallelTasksEnabled(state?.parallelTasksMaxConcurrency)) {
			disabledTools = [...(disabledTools ?? []), "run_parallel_tasks"]
		}

		const toolsResult = await buildNativeToolsArrayWithRestrictions({
			provider,
			cwd: this.access.cwd,
			mode,
			customModes: state?.customModes,
			customModePrompts: state?.customModePrompts,
			experiments: state?.experiments,
			apiConfiguration,
			disabledTools,
			modelInfo,
			webToolsEnabled: state?.webToolsEnabled,
			includeAllToolsWithRestrictions: supportsAllowedFunctionNames,
			materializedDeferredTools: this.access.materializedDeferredTools,
		})

		// Persist the deferred-tools directory onto the Task so `tools_load`
		// can resolve names without re-querying the MCP hub. We snapshot the
		// catalog at request time because it can change between turns (a new
		// MCP server might connect, custom tool files might change on disk).
		const directory = this.access.deferredToolDirectory
		directory.clear()
		if (toolsResult.deferredCatalog) {
			const provider2 = this.access.providerRef.deref()
			const mcpTools = provider2?.getMcpHub()
				? (await import("../prompts/tools/native-tools")).getMcpServerTools(provider2.getMcpHub())
				: []
			const candidates = new Map<string, OpenAI.Chat.ChatCompletionTool>()
			for (const tool of mcpTools) {
				candidates.set((tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name, tool)
			}
			// Also include filesystem-discovered custom tools when the experiment is on.
			if (state?.experiments?.customTools) {
				const { customToolRegistry, formatNative } = await import("@tumble-code/core")
				const customSerialized = customToolRegistry.getAllSerialized()
				for (const tool of customSerialized) {
					const formatted = formatNative(tool)
					candidates.set(formatted.function.name, formatted)
				}
			}
			for (const entry of toolsResult.deferredCatalog.entries) {
				const tool = candidates.get(entry.name)
				if (tool) {
					directory.set(entry.name, tool)
				}
			}
		}

		return {
			allTools: toolsResult.tools,
			allowedFunctionNames: toolsResult.allowedFunctionNames,
			deferredCatalog: toolsResult.deferredCatalog,
		}
	}

	/**
	 * Build clean conversation history by stripping reasoning blocks.
	 */
	buildCleanConversationHistory(
		messages: ApiMessage[],
		preserveReasoning: boolean = false,
	): Array<
		| Anthropic.Messages.MessageParam
		| { type: "reasoning"; encrypted_content: string; id?: string; summary?: unknown[] }
	> {
		type ReasoningItemForRequest = {
			type: "reasoning"
			encrypted_content: string
			id?: string
			summary?: unknown[]
		}

		const cleanConversationHistory: (Anthropic.Messages.MessageParam | ReasoningItemForRequest)[] = []

		// Non-destructive microcompaction (send-time): clear the content of old
		// tool results and trim the reasoning of old turns, as selected by the
		// context manager for THIS request's model. One set holds both kinds of
		// keys; each apply step ignores the other kind. Operates on a copy (stored
		// history stays pristine), so it is cache-stable and correct across mid-task
		// mode switches (a wider-window mode passes an empty set and gets full
		// fidelity back). No-op (same ref) when the set is empty, which is the
		// common case.
		const microcompactedIds = this.access.microcompactedIds
		const sourceMessages =
			microcompactedIds && microcompactedIds.size > 0
				? applyReasoningTrims(applyMicrocompactCleared(messages, microcompactedIds), microcompactedIds)
				: messages

		// Encrypted reasoning is OpenAI ciphertext (TaskMessageLog stores it only from a handler
		// with getEncryptedContent: OpenAI Native and Codex). Only such a handler can read it
		// back; any other provider (a mode switch to xAI, Anthropic, Bedrock, ...) gets the
		// history without it (DEF-C46). Decided per request from the current handler, the
		// stored history keeps the items for a later OpenAI mode.
		const sendsEncryptedReasoning = roundTripsEncryptedReasoning(this.access.api)

		for (const msg of sourceMessages) {
			// Standalone reasoning: send encrypted, skip plain text
			if (msg.type === "reasoning") {
				if (msg.encrypted_content && sendsEncryptedReasoning) {
					cleanConversationHistory.push({
						type: "reasoning",
						summary: msg.summary,
						encrypted_content: msg.encrypted_content!,
						...(msg.id ? { id: msg.id } : {}),
					})
				}
				continue
			}

			// Preferred path: assistant message with embedded reasoning
			if (msg.role === "assistant") {
				const rawContent = msg.content

				const contentArray: Anthropic.Messages.ContentBlockParam[] = Array.isArray(rawContent)
					? (rawContent as Anthropic.Messages.ContentBlockParam[])
					: rawContent !== undefined
						? ([
								{ type: "text", text: rawContent } satisfies Anthropic.Messages.TextBlockParam,
							] as Anthropic.Messages.ContentBlockParam[])
						: []

				const [first, ...rest] = contentArray

				// Check for reasoning_details (OpenRouter format)
				if (msg.reasoning_details && Array.isArray(msg.reasoning_details)) {
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (contentArray.length === 0) {
						assistantContent = ""
					} else if (contentArray.length === 1 && contentArray[0].type === "text") {
						assistantContent = (contentArray[0] as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = contentArray
					}

					// A MessageParam plus the OpenRouter field; built as a typed
					// variable because the array's element type does not list it.
					const withDetails: Anthropic.Messages.MessageParam & Pick<ApiMessage, "reasoning_details"> = {
						role: "assistant",
						content: assistantContent,
						reasoning_details: msg.reasoning_details,
					}
					cleanConversationHistory.push(withDetails)

					continue
				}

				// Embedded reasoning: encrypted or plain text
				const reasoningBlock = asEmbeddedReasoningBlock(first)
				const hasPlainTextReasoning = typeof reasoningBlock?.text === "string"

				if (reasoningBlock && typeof reasoningBlock.encrypted_content === "string") {
					if (sendsEncryptedReasoning) {
						cleanConversationHistory.push({
							type: "reasoning",
							summary: reasoningBlock.summary ?? [],
							encrypted_content: reasoningBlock.encrypted_content,
							...(reasoningBlock.id ? { id: reasoningBlock.id } : {}),
						})
					}

					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (rest.length === 0) {
						assistantContent = ""
					} else if (rest.length === 1 && rest[0].type === "text") {
						assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = rest
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
					} satisfies Anthropic.Messages.MessageParam)

					continue
				} else if (hasPlainTextReasoning) {
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (preserveReasoning) {
						assistantContent = contentArray
					} else {
						if (rest.length === 0) {
							assistantContent = ""
						} else if (rest.length === 1 && rest[0].type === "text") {
							assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam).text
						} else {
							assistantContent = rest
						}
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
					} satisfies Anthropic.Messages.MessageParam)

					continue
				}
			}

			// Default path for regular messages
			if (msg.role) {
				cleanConversationHistory.push({
					role: msg.role,
					content: msg.content as Anthropic.Messages.ContentBlockParam[] | string,
				})
			}
		}

		return cleanConversationHistory
	}
}
