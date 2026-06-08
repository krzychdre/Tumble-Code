import OpenAI from "openai"
import EventEmitter from "events"

import {
	type ProviderSettings,
	type TokenUsage,
	type ContextCondense,
	type ContextTruncation,
	RooCodeEventName,
	countEnabledMcpTools,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { type ApiHandler, type ApiHandlerCreateMessageMetadata } from "../../api"
import { getModelMaxOutputTokens } from "../../shared/api"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { McpHub } from "../../services/mcp/McpHub"
import { manageContext, willManageContext } from "../context-management"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { getMessagesSinceLastSummary, summarizeConversation, getEffectiveApiHistory } from "../condense"
import { buildNativeToolsArrayWithRestrictions } from "./build-tools"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
import { type ClineProvider } from "../webview/ClineProvider"
import { FileContextTracker } from "../context-tracking/FileContextTracker"
import { RooIgnoreController } from "../ignore/RooIgnoreController"

/**
 * Module-level constants for context management
 */
const FORCED_CONTEXT_REDUCTION_PERCENT = 75 // Keep 75% of context (remove 25%) on context window errors
const MAX_CONTEXT_WINDOW_RETRIES = 3 // Maximum retries for context window errors
// Auto-condense circuit breaker: after this many consecutive condense attempts
// that error or fail to reduce context, stop attempting condense for the task and
// fall back to microcompaction + truncation. Mirrors Claude Code's autocompact guard.
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

/**
 * Outcome fields from `manageContext` relevant to the auto-condense circuit breaker.
 * `summary`/`error` are set exclusively by the condense branch of `manageContext`,
 * so their presence is what tells us a condense was attempted in this pass.
 */
export interface CondenseOutcome {
	summary?: string
	error?: string
	prevContextTokens: number
	newContextTokens?: number
}

/**
 * Pure transition for the auto-condense circuit-breaker counter.
 *
 * - No condense attempted this pass (no `summary` and no `error`) → unchanged, so a
 *   tripped breaker stays latched and microcompaction-only / truncation-only / no-op
 *   passes never move the counter.
 * - Condense attempted and genuinely reduced context → reset to 0.
 * - Condense attempted but errored, or did not reduce context
 *   (`newContextTokens >= prevContextTokens`) → increment (a non-reducing summary is
 *   as futile as one that throws).
 *
 * The breaker is considered open once the returned count reaches
 * MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES.
 */
export function nextAutoCompactFailureCount(current: number, result: CondenseOutcome): number {
	const condenseAttempted = !!result.summary || !!result.error
	if (!condenseAttempted) {
		return current
	}
	const condenseReduced =
		!result.error && result.newContextTokens !== undefined && result.newContextTokens < result.prevContextTokens
	return condenseReduced ? 0 : current + 1
}

/**
 * Interface for Task access needed by TaskContextManager.
 * This is a narrow interface to minimize coupling between modules.
 */
export interface TaskContextManagerAccess {
	// Core identifiers
	taskId: string

	// API configuration and handler
	apiConfiguration: ProviderSettings
	api: ApiHandler

	// Conversation history
	apiConversationHistory: ApiMessage[]

	// Auto-condense circuit breaker counter (read AND written by the manager).
	consecutiveAutoCompactFailures: number

	// Non-destructive microcompaction: transient set of tool_use_ids to clear at
	// send time. Written by the manager each request; read by buildCleanConversationHistory.
	microcompactedToolUseIds: Set<string>

	// Workspace path
	cwd: string

	// Controllers
	rooIgnoreController?: RooIgnoreController
	fileContextTracker: FileContextTracker

	// Provider reference
	providerRef: WeakRef<ClineProvider>

	// Delegated modules
	history: TaskHistory
	askSay: TaskAskSay

	// Methods needed
	getTokenUsage(): TokenUsage
	getSystemPrompt(): Promise<string>
	emit: EventEmitter["emit"]
	processQueuedMessages(): void
}

/**
 * Parameters for manageContextIfNeeded
 */
export interface ManageContextParams {
	state: any
	systemPrompt: string
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, any>
	currentProfileId: string
	contextTokens: number
	maxTokens: number | undefined
	contextWindow: number
	lastMessageTokens: number
	customCondensingPrompt?: string
}

/**
 * Result from manageContextIfNeeded
 */
export interface ManageContextResult {
	messagesReplaced: boolean
	summary?: string
	cost?: number
	prevContextTokens?: number
	newContextTokens?: number
	error?: string
	truncationId?: string
	messagesRemoved?: number
	condenseId?: string
}

/**
 * Type for messages used in API conversation history
 */
export interface ApiMessage {
	role: "user" | "assistant"
	content: any
}

/**
 * TaskContextManager handles context condensing and context window management.
 * Extracted from Task.ts as part of the modularization refactoring.
 *
 * ## Responsibilities
 * - Manual context condensing (user-triggered via `condenseContext`)
 * - Automatic context management when context limits are approached
 * - Force truncation on context window exceeded errors
 * - MCP tools counting for warnings
 *
 * ## Usage
 * This module is instantiated by Task and accessed via delegation:
 * ```typescript
 * // In Task
 * this.contextManager = new TaskContextManager(this)
 * await this.contextManager.condenseContext()
 * ```
 */
export class TaskContextManager {
	constructor(private readonly access: TaskContextManagerAccess) {}

	/**
	 * Get files read by Roo, with error handling.
	 * Used when context management needs to know which files have been read.
	 *
	 * @param context - Context string for error logging (e.g., "condenseContext", "attemptApiRequest")
	 * @returns Array of file paths or undefined on error
	 */
	public async getFilesReadByRooSafely(context: string): Promise<string[] | undefined> {
		try {
			return await this.access.fileContextTracker.getFilesReadByRoo()
		} catch (error) {
			console.error(`[TaskContextManager#${context}] Failed to get files read by Roo:`, error)
			return undefined
		}
	}

	/**
	 * Manual context condensing triggered by user.
	 * This flushes pending tool results, builds condensing metadata, and calls summarizeConversation.
	 */
	public async condenseContext(): Promise<void> {
		// CRITICAL: Flush any pending tool results before condensing
		// to ensure tool_use/tool_result pairs are complete in history
		await this.access.history.flushPendingToolResultsToHistory()

		const systemPrompt = await this.access.getSystemPrompt()

		// Get condensing configuration
		const state = await this.access.providerRef.deref()?.getState()
		const customCondensingPrompt = state?.customSupportPrompts?.CONDENSE
		const { mode, apiConfiguration } = state ?? {}

		const { contextTokens: prevContextTokens } = this.access.getTokenUsage()

		// Build tools for condensing metadata (same tools used for normal API calls)
		const metadata = await this.buildCondensingMetadata(
			mode,
			state?.customModes,
			state?.experiments,
			apiConfiguration,
			state?.disabledTools,
		)

		// Generate environment details to include in the condensed summary
		const environmentDetails = await getEnvironmentDetails(this.access as any, true)

		const filesReadByRoo = await this.getFilesReadByRooSafely("condenseContext")

		const {
			messages,
			summary,
			cost,
			newContextTokens = 0,
			error,
			condenseId,
		} = await summarizeConversation({
			messages: this.access.apiConversationHistory,
			apiHandler: this.access.api,
			systemPrompt,
			taskId: this.access.taskId,
			isAutomaticTrigger: false,
			customCondensingPrompt,
			metadata,
			environmentDetails,
			filesReadByRoo,
			cwd: this.access.cwd,
			rooIgnoreController: this.access.rooIgnoreController,
		})

		if (error) {
			await this.access.askSay.say(
				"condense_context_error",
				error,
				undefined /* images */,
				false /* partial */,
				undefined /* checkpoint */,
				undefined /* progressStatus */,
				{ isNonInteractive: true } /* options */,
			)
			return
		}

		await this.access.history.overwriteApiConversationHistory(messages)

		const contextCondense: ContextCondense = {
			summary,
			cost,
			newContextTokens,
			prevContextTokens,
			condenseId: condenseId!,
		}
		await this.access.askSay.say(
			"condense_context",
			undefined /* text */,
			undefined /* images */,
			false /* partial */,
			undefined /* checkpoint */,
			undefined /* progressStatus */,
			{ isNonInteractive: true } /* options */,
			contextCondense,
		)

		// Process any queued messages after condensing completes
		this.access.processQueuedMessages()
	}

	/**
	 * Get enabled MCP tools count for this task.
	 * Returns the count along with the number of servers contributing.
	 *
	 * @returns Object with enabledToolCount and enabledServerCount
	 */
	public async getEnabledMcpToolsCount(): Promise<{ enabledToolCount: number; enabledServerCount: number }> {
		try {
			const provider = this.access.providerRef.deref()
			if (!provider) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const { mcpEnabled } = (await provider.getState()) ?? {}
			if (!(mcpEnabled ?? true)) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const mcpHub = await McpServerManager.getInstance(provider.context, provider)
			if (!mcpHub) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const servers = mcpHub.getServers()
			return countEnabledMcpTools(servers)
		} catch (error) {
			console.error("[TaskContextManager#getEnabledMcpToolsCount] Error counting MCP tools:", error)
			return { enabledToolCount: 0, enabledServerCount: 0 }
		}
	}

	/**
	 * Force-truncate context when context window is exceeded.
	 * Called when the API returns a context_window_exceeded error.
	 *
	 * This method:
	 * 1. Sends condenseTaskContextStarted to show in-progress indicator
	 * 2. Aggressively truncates to 75% of current context
	 * 3. Handles both condensation and sliding window truncation results
	 * 4. Always sends condenseTaskContextResponse to dismiss spinner
	 */
	public async handleContextWindowExceededError(): Promise<void> {
		const state = await this.access.providerRef.deref()?.getState()
		const { profileThresholds = {}, mode, apiConfiguration } = state ?? {}

		const { contextTokens } = this.access.getTokenUsage()
		const modelInfo = this.access.api.getModel().info

		const maxTokens = getModelMaxOutputTokens({
			modelId: this.access.api.getModel().id,
			model: modelInfo,
			settings: this.access.apiConfiguration,
		})

		const contextWindow = modelInfo.contextWindow

		// Get the current profile ID using helper
		const currentProfileId = this.getCurrentProfileId(state)

		// Log the context window error for debugging
		console.warn(
			`[TaskContextManager#${this.access.taskId}] Context window exceeded for model ${this.access.api.getModel().id}. ` +
				`Current tokens: ${contextTokens}, Context window: ${contextWindow}. ` +
				`Forcing truncation to ${FORCED_CONTEXT_REDUCTION_PERCENT}% of current context.`,
		)

		// Send condenseTaskContextStarted to show in-progress indicator
		await this.access.providerRef
			.deref()
			?.postMessageToWebview({ type: "condenseTaskContextStarted", text: this.access.taskId })

		// Build tools for condensing metadata
		const metadata = await this.buildCondensingMetadata(
			mode,
			state?.customModes,
			state?.experiments,
			apiConfiguration,
			state?.disabledTools,
		)

		try {
			// Generate environment details to include in the condensed summary
			const environmentDetails = await getEnvironmentDetails(this.access as any, true)

			// Force aggressive truncation by keeping only 75% of the conversation history
			const truncateResult = await manageContext({
				messages: this.access.apiConversationHistory,
				totalTokens: contextTokens || 0,
				maxTokens,
				contextWindow,
				apiHandler: this.access.api,
				autoCondenseContext: true,
				autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT,
				systemPrompt: await this.access.getSystemPrompt(),
				taskId: this.access.taskId,
				profileThresholds,
				currentProfileId,
				metadata,
				environmentDetails,
			})

			if (truncateResult.messages !== this.access.apiConversationHistory) {
				await this.access.history.overwriteApiConversationHistory(truncateResult.messages)
			}

			if (truncateResult.summary) {
				const { summary, cost, prevContextTokens, newContextTokens = 0 } = truncateResult
				const contextCondense: ContextCondense = { summary, cost, newContextTokens, prevContextTokens }
				await this.access.askSay.say(
					"condense_context",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					contextCondense,
				)
			} else if (truncateResult.truncationId) {
				// Sliding window truncation occurred (fallback when condensing fails or is disabled)
				const contextTruncation: ContextTruncation = {
					truncationId: truncateResult.truncationId,
					messagesRemoved: truncateResult.messagesRemoved ?? 0,
					prevContextTokens: truncateResult.prevContextTokens,
					newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
				}
				await this.access.askSay.say(
					"sliding_window_truncation",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					undefined /* contextCondense */,
					contextTruncation,
				)
			}
		} finally {
			// Notify webview that context management is complete (removes in-progress spinner)
			// IMPORTANT: Must always be sent to dismiss the spinner, even on error
			await this.access.providerRef
				.deref()
				?.postMessageToWebview({ type: "condenseTaskContextResponse", text: this.access.taskId })
		}
	}

	/**
	 * Check if context management will run and perform it if needed.
	 * This is extracted from the attemptApiRequest method.
	 *
	 * @param params - Parameters for context management
	 * @returns Result of context management, or undefined if it didn't run
	 */
	public async manageContextIfNeeded(params: ManageContextParams): Promise<ManageContextResult | undefined> {
		const {
			state,
			systemPrompt,
			autoCondenseContext,
			autoCondenseContextPercent,
			profileThresholds,
			currentProfileId,
			contextTokens,
			maxTokens,
			contextWindow,
			lastMessageTokens,
			customCondensingPrompt,
		} = params

		// Auto-condense circuit breaker: when too many consecutive condense attempts
		// have failed to reduce context, skip condense entirely (manageContext falls
		// back to microcompaction + truncation). When open we also skip the condense-
		// only prep work (folded files, environment details) and the condense spinner.
		const condenseCircuitOpen = this.access.consecutiveAutoCompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES

		// Check if context management will likely run (threshold check)
		// This allows us to show an in-progress indicator to the user
		const contextManagementWillRun = willManageContext({
			totalTokens: contextTokens,
			contextWindow,
			maxTokens,
			autoCondenseContext,
			autoCondenseContextPercent,
			profileThresholds,
			currentProfileId,
			lastMessageTokens,
		})

		// Send condenseTaskContextStarted BEFORE manageContext to show in-progress indicator.
		// Skip when the breaker is open: condense will not run, so a condense spinner would mislead.
		const willShowCondenseSpinner = contextManagementWillRun && autoCondenseContext && !condenseCircuitOpen
		if (willShowCondenseSpinner) {
			await this.access.providerRef
				.deref()
				?.postMessageToWebview({ type: "condenseTaskContextStarted", text: this.access.taskId })
		}

		// Build tools for condensing metadata
		const { mode, apiConfiguration } = state ?? {}
		const metadata = await this.buildCondensingMetadata(
			mode,
			state?.customModes,
			state?.experiments,
			apiConfiguration,
			state?.disabledTools,
		)

		// Only generate environment details / folded files when a condense could
		// actually run — both are condense-only inputs, wasted when the breaker is open.
		const environmentDetails =
			contextManagementWillRun && !condenseCircuitOpen
				? await getEnvironmentDetails(this.access as any, true)
				: undefined

		// Get files read by Roo for code folding - only when condense could run
		const filesReadByRoo =
			contextManagementWillRun && autoCondenseContext && !condenseCircuitOpen
				? await this.getFilesReadByRooSafely("attemptApiRequest")
				: undefined

		try {
			const truncateResult = await manageContext({
				messages: this.access.apiConversationHistory,
				totalTokens: contextTokens,
				maxTokens,
				contextWindow,
				apiHandler: this.access.api,
				autoCondenseContext,
				autoCondenseContextPercent,
				systemPrompt,
				taskId: this.access.taskId,
				customCondensingPrompt,
				profileThresholds,
				currentProfileId,
				metadata,
				environmentDetails,
				filesReadByRoo,
				cwd: this.access.cwd,
				rooIgnoreController: this.access.rooIgnoreController,
				condenseCircuitOpen,
			})

			// Update the auto-condense circuit breaker from the condense outcome
			// (see nextAutoCompactFailureCount for the success/failure/latch rules).
			this.access.consecutiveAutoCompactFailures = nextAutoCompactFailureCount(
				this.access.consecutiveAutoCompactFailures,
				truncateResult,
			)

			// Stash the non-destructive microcompaction decision as transient state.
			// Mutate the EXISTING set in place (rather than reassigning) so the
			// reference captured by ApiRequestBuilder at construction stays live.
			// Always overwrite (empty when nothing to clear) so a stale set from a
			// prior request — or a prior mode with a narrower context window — never
			// lingers. The send-time chokepoint applies it to the outgoing copy only.
			this.access.microcompactedToolUseIds.clear()
			for (const id of truncateResult.microcompactClearedToolUseIds ?? []) {
				this.access.microcompactedToolUseIds.add(id)
			}

			if (truncateResult.messages !== this.access.apiConversationHistory) {
				await this.access.history.overwriteApiConversationHistory(truncateResult.messages)
			}

			if (truncateResult.error) {
				await this.access.askSay.say("condense_context_error", truncateResult.error)
			}

			if (truncateResult.summary) {
				const { summary, cost, prevContextTokens, newContextTokens = 0, condenseId } = truncateResult
				const contextCondense: ContextCondense = {
					summary,
					cost,
					newContextTokens,
					prevContextTokens,
					condenseId,
				}
				await this.access.askSay.say(
					"condense_context",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					contextCondense,
				)
			} else if (truncateResult.truncationId) {
				// Sliding window truncation occurred (fallback when condensing fails or is disabled)
				const contextTruncation: ContextTruncation = {
					truncationId: truncateResult.truncationId,
					messagesRemoved: truncateResult.messagesRemoved ?? 0,
					prevContextTokens: truncateResult.prevContextTokens,
					newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
				}
				await this.access.askSay.say(
					"sliding_window_truncation",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					undefined /* contextCondense */,
					contextTruncation,
				)
			}

			return {
				messagesReplaced: truncateResult.messages !== this.access.apiConversationHistory,
				summary: truncateResult.summary,
				cost: truncateResult.cost,
				prevContextTokens: truncateResult.prevContextTokens,
				newContextTokens: truncateResult.newContextTokens,
				error: truncateResult.error,
				truncationId: truncateResult.truncationId,
				messagesRemoved: truncateResult.messagesRemoved,
			}
		} finally {
			// Notify webview that context management is complete (sets isCondensing = false)
			// IMPORTANT: Must always be sent to dismiss the spinner, even on error.
			// Mirror the start condition so we only dismiss a spinner we actually showed.
			if (willShowCondenseSpinner) {
				await this.access.providerRef
					.deref()
					?.postMessageToWebview({ type: "condenseTaskContextResponse", text: this.access.taskId })
			}
		}
	}

	/**
	 * Get the current profile ID from state.
	 * Helper method extracted from Task for use in context management.
	 */
	private getCurrentProfileId(state: any): string {
		return (
			state?.listApiConfigMeta?.find((profile: any) => profile.name === state?.currentApiConfigName)?.id ??
			"default"
		)
	}

	/**
	 * Build metadata for condensing API calls.
	 * This consolidates the duplicated tool-building logic across multiple methods.
	 */
	private async buildCondensingMetadata(
		mode: string | undefined,
		customModes: any,
		experiments: Record<string, boolean> | undefined,
		apiConfiguration: ProviderSettings | undefined,
		disabledTools: string[] | undefined,
	): Promise<ApiHandlerCreateMessageMetadata> {
		const provider = this.access.providerRef.deref()
		const modelInfo = this.access.api.getModel().info

		let allTools: OpenAI.Chat.ChatCompletionTool[] = []
		if (provider) {
			const toolsResult = await buildNativeToolsArrayWithRestrictions({
				provider,
				cwd: this.access.cwd,
				mode,
				customModes,
				experiments,
				apiConfiguration,
				disabledTools,
				modelInfo,
				includeAllToolsWithRestrictions: false,
			})
			allTools = toolsResult.tools
		}

		return {
			mode,
			taskId: this.access.taskId,
			...(allTools.length > 0
				? {
						tools: allTools,
						tool_choice: "auto",
						parallelToolCalls: true,
					}
				: {}),
		}
	}
}

// Export constants for use in Task.ts
export { FORCED_CONTEXT_REDUCTION_PERCENT, MAX_CONTEXT_WINDOW_RETRIES }
