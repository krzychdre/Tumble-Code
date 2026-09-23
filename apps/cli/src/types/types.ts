import type { ReasoningEffortExtended } from "@roo-code/types"
import type { OutputFormat } from "./json-events.js"
import type { SupportedProvider } from "@/lib/utils/provider-types.js"

export {
	supportedProviders,
	isSupportedProvider,
	providerIdAliases,
	resolveProviderIdAlias,
	isAcceptedProvider,
} from "@/lib/utils/provider-types.js"
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

/** Provider settings one mode may override in cli-settings.json. */
export interface CliModeSettings {
	provider?: SupportedProvider
	model?: string
	baseUrl?: string
	apiKey?: string
	apiKeyEnv?: string
	reasoningEffort?: ReasoningEffortFlagOptions
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
	/** API key for the provider (keep the file readable only by you: chmod 600) */
	apiKey?: string
	/** Name of the environment variable holding the API key (used when apiKey is absent) */
	apiKeyEnv?: string
	/** Default reasoning effort level */
	reasoningEffort?: ReasoningEffortFlagOptions
	/**
	 * Per-mode overrides, keyed by mode slug. Each entry changes only what it
	 * names and inherits the rest; an entry that names a different provider
	 * starts from that provider's defaults (model, baseUrl and key are not
	 * carried across providers). Ignored for a run given any of --provider,
	 * --model, --base-url, --api-key or --reasoning-effort.
	 */
	modes?: Record<string, CliModeSettings>
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Require manual approval for tools/commands/browser/MCP actions */
	requireApproval?: boolean
	/** @deprecated Legacy inverse setting kept for backward compatibility */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
}
