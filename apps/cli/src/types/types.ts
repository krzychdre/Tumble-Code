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

/** Facts about one model that the CLI cannot learn from the provider, keyed by model id in cli-settings.json. */
export interface CliModelSettings {
	/**
	 * Context window in tokens. Used with the openai provider (any
	 * OpenAI-compatible server), whose model list carries ids only, so the
	 * extension would otherwise assume 128,000.
	 */
	contextWindow?: number
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
	/**
	 * Per-model facts, keyed by model id exactly as the provider names it
	 * (e.g. "GLM-5.3-NVFP4"). An entry applies wherever that model runs: the
	 * global settings, a mode entry or --model.
	 */
	models?: Record<string, CliModelSettings>
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Require manual approval for tools/commands/browser/MCP actions */
	requireApproval?: boolean
	/** @deprecated Legacy inverse setting kept for backward compatibility */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
	/**
	 * File with the global MCP servers (same format as a project's
	 * .roo/mcp.json). Defaults to ~/.roo/mcp.json; point it at the VS Code
	 * extension's mcp_settings.json to share one list with the editor.
	 */
	mcpSettingsPath?: string
}
