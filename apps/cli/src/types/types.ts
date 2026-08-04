import type { ReasoningEffortExtended } from "@roo-code/types"
import type { OutputFormat } from "./json-events.js"
import type { SupportedProvider } from "@/lib/utils/provider-types.js"

export { supportedProviders, isSupportedProvider } from "@/lib/utils/provider-types.js"
export type { SupportedProvider } from "@/lib/utils/provider-types.js"

export type ReasoningEffortFlagOptions = ReasoningEffortExtended | "unspecified" | "disabled"

export type FlagOptions = {
	promptFile?: string
	createWithSessionId?: string
	sessionId?: string
	continue: boolean
	workspace?: string
	print: boolean
	stdinPromptStream: boolean
	signalOnlyExit: boolean
	extension?: string
	debug: boolean
	requireApproval: boolean
	exitOnError: boolean
	apiKey?: string
	provider?: SupportedProvider
	model?: string
	baseUrl?: string
	mode?: string
	terminalShell?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	consecutiveMistakeLimit?: number
	ephemeral: boolean
	oneshot: boolean
	outputFormat?: OutputFormat
}

export enum OnboardingProviderChoice {
	Byok = "byok",
}

export interface OnboardingResult {
	choice: OnboardingProviderChoice
	token?: string
	skipped: boolean
}

export interface CliSettings {
	onboardingProviderChoice?: OnboardingProviderChoice
	/** Default mode to use (e.g., "code", "architect", "ask", "debug") */
	mode?: string
	/** Default provider to use */
	provider?: SupportedProvider
	/** Default model to use */
	model?: string
	/** Default base URL for the selected provider (when the provider's schema has one) */
	baseUrl?: string
	/** Default reasoning effort level */
	reasoningEffort?: ReasoningEffortFlagOptions
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Require manual approval for tools/commands/browser/MCP actions */
	requireApproval?: boolean
	/** @deprecated Legacy inverse setting kept for backward compatibility */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
}
