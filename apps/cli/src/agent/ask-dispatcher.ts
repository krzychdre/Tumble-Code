/**
 * AskDispatcher - Routes ask messages to appropriate handlers
 *
 * This dispatcher is responsible for:
 * - Categorizing ask types using type guards from client module
 * - Routing to the appropriate handler based on ask category
 * - Coordinating between OutputManager and PromptManager
 * - Tracking which asks have been handled (to avoid duplicates)
 *
 * Design notes:
 * - Uses isIdleAsk, isInteractiveAsk, isResumableAsk, isNonBlockingAsk type guards
 * - Single responsibility: Ask routing and handling only
 * - Delegates output to OutputManager, input to PromptManager
 * - Sends responses back through a provided callback
 */

import {
	type WebviewMessage,
	type ClineMessage,
	type ClineAsk,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
	isNonBlockingAsk,
	type UsableSuggestion,
	parseFollowUpData,
	suggestionModeToSwitch,
} from "@tumble-code/types"
import { debugLog } from "@tumble-code/core/cli"

import { FOLLOWUP_TIMEOUT_SECONDS } from "@/types/index.js"
import { parseMcpAsk } from "@/lib/utils/mcp-ask.js"

import type { OutputManager } from "./output-manager.js"
import type { PromptManager } from "./prompt-manager.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for AskDispatcher.
 */
export interface AskDispatcherOptions {
	/**
	 * OutputManager for displaying ask-related output.
	 */
	outputManager: OutputManager

	/**
	 * PromptManager for collecting user input.
	 */
	promptManager: PromptManager

	/**
	 * Callback to send responses to the extension.
	 */
	sendMessage: (message: WebviewMessage) => void

	/**
	 * Whether running in non-interactive mode (auto-approve).
	 */
	nonInteractive?: boolean

	/**
	 * Whether to exit on API request errors instead of retrying.
	 */
	exitOnError?: boolean

	/**
	 * Whether to disable ask handling (for TUI mode).
	 * In TUI mode, the TUI handles asks directly.
	 */
	disabled?: boolean
}

// =============================================================================
// AskDispatcher Class
// =============================================================================

export class AskDispatcher {
	private outputManager: OutputManager
	private promptManager: PromptManager
	private sendMessage: (message: WebviewMessage) => void
	private nonInteractive: boolean
	private exitOnError: boolean
	private disabled: boolean

	/**
	 * Track which asks have been handled to avoid duplicates.
	 * Key: message ts
	 */
	private handledAsks = new Set<number>()

	constructor(options: AskDispatcherOptions) {
		this.outputManager = options.outputManager
		this.promptManager = options.promptManager
		this.sendMessage = options.sendMessage
		this.nonInteractive = options.nonInteractive ?? false
		this.exitOnError = options.exitOnError ?? false
		this.disabled = options.disabled ?? false
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	/**
	 * Handle an ask message.
	 * Routes to the appropriate handler based on ask type.
	 *
	 * @param message - The ClineMessage with type="ask"
	 */
	async handleAsk(message: ClineMessage): Promise<void> {
		const ts = message.ts
		const ask = message.ask
		const text = message.text || ""

		// Disabled in TUI mode (the TUI handles asks directly), already handled,
		// not an ask, or partial (wait for the complete message).
		if (this.disabled || this.handledAsks.has(ts) || message.type !== "ask" || !ask || message.partial) {
			return
		}

		// Mark as being handled
		this.handledAsks.add(ts)

		try {
			// Route based on ask category
			if (isNonBlockingAsk(ask)) {
				// command_output: print mode writes the output from the transcript
				// (TranscriptPrinter); approve so the command goes on.
				this.sendApprovalResponse(true)
			} else if (isIdleAsk(ask)) {
				await this.handleIdleAsk(ask, text)
			} else if (isResumableAsk(ask)) {
				await this.handleResumeTask(ask, text)
			} else if (isInteractiveAsk(ask)) {
				await this.handleInteractiveAsk(ask, text)
			} else {
				debugLog("[AskDispatcher] Unknown ask type", { ask, ts })
				await this.handleUnknownAsk(ask, text)
			}
		} catch {
			// Re-allow handling on error
			this.handledAsks.delete(ts)
		}
	}

	/**
	 * Clear handled asks (call when starting new task).
	 */
	clear(): void {
		this.handledAsks.clear()
	}

	// ===========================================================================
	// Category Handlers
	// ===========================================================================

	/**
	 * Handle idle asks (completion_result, api_req_failed, etc.).
	 * These indicate the task has stopped.
	 */
	private async handleIdleAsk(ask: ClineAsk, text: string): Promise<void> {
		switch (ask) {
			case "completion_result":
				// Task complete - nothing to do here, TaskCompleted event handles it
				return

			case "api_req_failed":
				return this.handleApiFailedRetry(text)

			case "mistake_limit_reached":
				return this.handleLimitReached("mistake limit reached", "Continue anyway? (y/n): ", text)

			case "resume_completed_task":
				return this.handleResumeTask(ask, text)

			case "auto_approval_max_req_reached":
				return this.handleLimitReached(
					"auto-approval limit reached",
					"Continue with manual approval? (y/n): ",
					text,
				)
		}
	}

	/**
	 * Handle interactive asks (followup, command, tool, use_mcp_server).
	 * These require user approval or input.
	 */
	private async handleInteractiveAsk(ask: ClineAsk, text: string): Promise<void> {
		switch (ask) {
			case "followup":
				return this.handleFollowupQuestion(text)

			case "command":
				return this.handleCommandApproval(text)

			case "tool":
				return this.handleToolApproval(text)

			case "use_mcp_server":
				return this.handleMcpApproval(text)
		}
	}

	/**
	 * Handle unknown ask types.
	 */
	private async handleUnknownAsk(ask: ClineAsk, text: string): Promise<void> {
		if (this.nonInteractive) {
			if (text) {
				this.outputManager.output(`\n[${ask}]`, text)
			}
			return
		}

		this.outputManager.output(`\n[${ask}]`)
		if (text) {
			this.outputManager.output(`  ${text}`)
		}

		await this.askYesNo("Approve? (y/n): ")
	}

	// ===========================================================================
	// Specific Ask Handlers
	// ===========================================================================

	/**
	 * Handle followup questions - prompt for text input with suggestions.
	 */
	private async handleFollowupQuestion(text: string): Promise<void> {
		// Read by the rule shared with the webview: only suggestions with a
		// usable answer are offered (and numbered), so a blank one never
		// becomes the default reply.
		const parsed = parseFollowUpData(text)
		const question = parsed.question || text
		const suggestions = parsed.suggestions

		this.outputManager.output("\n[question]", question)

		if (suggestions.length > 0) {
			this.outputManager.output("\nSuggested answers:")
			suggestions.forEach((suggestion, index) => {
				const modeHint = suggestion.mode ? ` (mode: ${suggestion.mode})` : ""
				this.outputManager.output(`  ${index + 1}. ${suggestion.answer}${modeHint}`)
			})
			this.outputManager.output("")
		}

		const defaultSuggestion = suggestions[0]
		const defaultAnswer = defaultSuggestion?.answer ?? ""

		if (this.nonInteractive) {
			// Use timeout prompt in non-interactive mode
			const timeoutMs = FOLLOWUP_TIMEOUT_SECONDS * 1000
			const result = await this.promptManager.promptWithTimeout(
				suggestions.length > 0
					? `Enter number (1-${suggestions.length}) or type your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `
					: `Your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `,
				timeoutMs,
				defaultAnswer,
			)

			if (result.timedOut || result.cancelled) {
				this.outputManager.output(`[Using default: ${defaultAnswer || "(empty)"}]`)
				this.sendFollowupAnswer(defaultAnswer, defaultSuggestion, false)
			} else {
				this.sendTypedFollowupAnswer(result.value.trim(), suggestions)
			}

			return
		}

		// Interactive mode
		try {
			const answer = await this.promptManager.promptForInput(
				suggestions.length > 0
					? `Enter number (1-${suggestions.length}) or type your answer: `
					: "Your answer: ",
			)

			this.sendTypedFollowupAnswer(answer.trim(), suggestions)
		} catch {
			this.outputManager.output(`[Using default: ${defaultAnswer || "(empty)"}]`)
			this.sendFollowupAnswer(defaultAnswer, defaultSuggestion, false)
		}
	}

	/**
	 * Handle command execution approval.
	 */
	private async handleCommandApproval(text: string): Promise<void> {
		this.outputManager.output("\n[command request]")
		this.outputManager.output(`  Command: ${text || "(no command specified)"}`)

		// Auto-approved by extension settings in non-interactive mode
		if (!this.nonInteractive) {
			await this.askYesNo("Execute this command? (y/n): ")
		}
	}

	/**
	 * Handle tool execution approval.
	 */
	private async handleToolApproval(text: string): Promise<void> {
		let toolName = "unknown"
		let toolInfo: Record<string, unknown> = {}

		try {
			toolInfo = JSON.parse(text) as Record<string, unknown>
			toolName = (toolInfo.tool as string) || "unknown"
		} catch {
			// Use raw text if not JSON
		}

		const isProtected = toolInfo.isProtected === true

		if (isProtected) {
			this.outputManager.output(`\n[Tool Request] ${toolName} [PROTECTED CONFIGURATION FILE]`)
			this.outputManager.output(`⚠️  WARNING: This tool wants to modify a protected configuration file.`)
			this.outputManager.output(
				`    Protected files include .rooignore, .roo/*, and other sensitive config files.`,
			)
		} else {
			this.outputManager.output(`\n[Tool Request] ${toolName}`)
		}

		// Display tool details
		for (const [key, value] of Object.entries(toolInfo)) {
			if (key === "tool" || key === "isProtected") continue

			let displayValue: string
			if (typeof value === "string") {
				displayValue = value.length > 200 ? value.substring(0, 200) + "..." : value
			} else if (typeof value === "object" && value !== null) {
				const json = JSON.stringify(value)
				displayValue = json.length > 200 ? json.substring(0, 200) + "..." : json
			} else {
				displayValue = String(value)
			}

			this.outputManager.output(`  ${key}: ${displayValue}`)
		}

		// Auto-approved by extension settings in non-interactive mode (unless protected)
		if (!this.nonInteractive) {
			await this.askYesNo("Approve this action? (y/n): ")
		}
	}

	/**
	 * Handle MCP server access approval.
	 */
	private async handleMcpApproval(text: string): Promise<void> {
		const mcp = parseMcpAsk(text)

		this.outputManager.output("\n[mcp request]")
		this.outputManager.output(`  Server: ${mcp?.serverName ?? "unknown"}`)
		if (mcp?.toolName) {
			this.outputManager.output(`  Tool: ${mcp.toolName}`)
		}
		if (mcp?.uri) {
			this.outputManager.output(`  Resource: ${mcp.uri}`)
		}
		if (mcp && mcp.argumentLines.length > 0) {
			this.outputManager.output("  Arguments:")
			for (const line of mcp.argumentLines) {
				this.outputManager.output(`    ${line}`)
			}
		}

		// Auto-approved by extension settings in non-interactive mode
		if (!this.nonInteractive) {
			await this.askYesNo("Allow MCP access? (y/n): ")
		}
	}

	/**
	 * Handle API request failed - retry prompt.
	 */
	private async handleApiFailedRetry(text: string): Promise<void> {
		this.outputManager.output("\n[api request failed]")
		this.outputManager.output(`  Error: ${text || "Unknown error"}`)

		if (this.exitOnError) {
			// The host fails the run on this ask (waitForTaskCompletion); run.ts
			// then disposes it and exits with code 1.
			return
		}

		if (this.nonInteractive) {
			// Non-interactive runs with auto-approval on, where the core retries
			// transient errors itself and asks only for errors a retry cannot fix
			// (401 invalid key, 403 forbidden, 404 unknown model or endpoint).
			// Decline, so the task loop ends; the host then fails the run.
			this.outputManager.output(
				"[not retrying: this error needs a fix first, e.g. the API key, profile or model]",
			)
			this.sendApprovalResponse(false)
			return
		}

		await this.askYesNo("Retry the request? (y/n): ")
	}

	/**
	 * Handle the mistake limit and the auto-approval limit: show the details,
	 * then go on (non-interactive mode) or ask.
	 */
	private async handleLimitReached(title: string, question: string, text: string): Promise<void> {
		this.outputManager.output(`\n[${title}]`)
		if (text) {
			this.outputManager.output(`  Details: ${text}`)
		}

		if (this.nonInteractive) {
			// Auto-proceed in non-interactive mode
			this.sendApprovalResponse(true)
			return
		}

		await this.askYesNo(question)
	}

	/**
	 * Handle task resume prompt.
	 */
	private async handleResumeTask(ask: ClineAsk, text: string): Promise<void> {
		const isCompleted = ask === "resume_completed_task"
		this.outputManager.output(`\n[Resume ${isCompleted ? "Completed " : ""}Task]`)
		if (text) {
			this.outputManager.output(`  ${text}`)
		}

		if (this.nonInteractive) {
			this.outputManager.output("\n[continuing task]")
			// Auto-resume in non-interactive mode
			this.sendApprovalResponse(true)
			return
		}

		await this.askYesNo("Continue with this task? (y/n): ")
	}

	// ===========================================================================
	// Response Helpers
	// ===========================================================================

	/**
	 * Ask a yes/no question and send the answer; a prompt that fails answers no.
	 */
	private async askYesNo(question: string): Promise<void> {
		try {
			this.sendApprovalResponse(await this.promptManager.promptForYesNo(question))
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendApprovalResponse(false)
		}
	}

	/**
	 * Send a followup response (text answer) to the extension.
	 */
	private sendFollowupResponse(text: string): void {
		this.sendMessage({ type: "askResponse", askResponse: "messageResponse", text })
	}

	/**
	 * Send an approval response (yes/no) to the extension.
	 */
	private sendApprovalResponse(approved: boolean): void {
		this.sendMessage({
			type: "askResponse",
			askResponse: approved ? "yesButtonClicked" : "noButtonClicked",
		})
	}

	/**
	 * Answer with what the user typed: a suggestion's number picks that
	 * suggestion (a manual choice), anything else is sent as is.
	 */
	private sendTypedFollowupAnswer(input: string, suggestions: UsableSuggestion[]): void {
		const num = parseInt(input, 10)
		const selected = !isNaN(num) && num >= 1 && num <= suggestions.length ? suggestions[num - 1] : undefined

		if (selected) {
			this.outputManager.output(`Selected: ${selected.answer}`)
			this.sendFollowupAnswer(selected.answer, selected, true)
		} else {
			this.sendFollowupAnswer(input, undefined, true)
		}
	}

	/**
	 * Send a follow-up answer, switching first to the chosen suggestion's mode
	 * by the rule the webview follows. In non-interactive mode every action,
	 * mode switches included, is auto-approved.
	 */
	private sendFollowupAnswer(answer: string, suggestion: UsableSuggestion | undefined, manual: boolean): void {
		const mode = suggestion
			? suggestionModeToSwitch(suggestion, { manual, alwaysAllowModeSwitch: this.nonInteractive })
			: undefined

		if (mode) {
			this.sendMessage({ type: "mode", text: mode })
		}

		this.sendFollowupResponse(answer)
	}
}
