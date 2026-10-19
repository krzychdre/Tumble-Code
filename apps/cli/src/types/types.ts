import type { ReasoningEffortExtended } from "@tumble-code/types"
import type { OutputFormat } from "./json-events.js"
import type { SupportedProvider } from "@/lib/utils/provider-types.js"
import type { MODEL_SIZES } from "./constants.js"

export { supportedProviders, isAcceptedProvider } from "@/lib/utils/provider-types.js"
export type { SupportedProvider } from "@/lib/utils/provider-types.js"

export type ReasoningEffortFlagOptions = ReasoningEffortExtended | "unspecified" | "disabled"

export type FlagOptions = {
	promptFile?: string
	createWithSessionId?: string
	sessionId?: string
	continue: boolean
	workspace?: string
	print: boolean
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
	/** Raw --command-execution-timeout value; run() validates it together with the settings value. */
	commandExecutionTimeout?: string
	ephemeral: boolean
	oneshot: boolean
	/** Start the TUI with the task history picker open. */
	resume: boolean
	outputFormat?: OutputFormat
}

/** Provider settings one mode may override in cli-settings.json. */
export interface CliModeSettings {
	provider?: SupportedProvider
	model?: string
	baseUrl?: string
	apiKey?: string
	apiKeyEnv?: string
	/** @deprecated Ignored with a warning: the reasoning effort is set per model, in `models`. */
	reasoningEffort?: unknown
}

/** Facts about one model that the CLI cannot learn from the provider, keyed by model id in cli-settings.json. */
export interface CliModelSettings {
	/**
	 * The connection this model runs on, for a model served elsewhere than the
	 * top level or the mode says (another server, another provider). Each
	 * field overrides the top level and the mode entry, and only the flags
	 * override it. An entry that names a different provider inherits none of
	 * their base URL or key, as a mode entry does.
	 */
	provider?: SupportedProvider
	baseUrl?: string
	apiKey?: string
	apiKeyEnv?: string
	/**
	 * Context window in tokens. Used with the openai provider (any
	 * OpenAI-compatible server), whose model list carries ids only, so the
	 * extension would otherwise assume 128,000.
	 */
	contextWindow?: number
	/**
	 * Prices in USD per million tokens, the same fields the VS Code settings
	 * set for an OpenAI-compatible model. Used with the openai provider, whose
	 * models would otherwise cost $0, so the task cost and the cost sent to
	 * Tumble Code Cloud stay at zero.
	 */
	inputPrice?: number
	outputPrice?: number
	/** Price of input tokens the server reports as read from its prompt cache. */
	cacheReadsPrice?: number
	/** Price of input tokens the server reports as written to its prompt cache (defaults to inputPrice). */
	cacheWritesPrice?: number
	/**
	 * Send the model's earlier reasoning back with every request, so it can
	 * build on what it thought in previous turns (the VS Code setting "Return
	 * reasoning to the model"). Used with the openai provider; whether a model
	 * reads its reasoning back depends on the model and the server. Defaults
	 * to false.
	 */
	preserveReasoning?: boolean
	/**
	 * When the context fills up, shorten the long reasoning blocks of older
	 * turns before anything else is cut (the VS Code setting "Shorten old
	 * reasoning when the context fills up"). Only the copy sent to the model
	 * changes, the task history keeps every block whole. Needs
	 * preserveReasoning, since without it no reasoning is sent back. Used with
	 * the openai provider. Defaults to false.
	 */
	trimOldReasoning?: boolean
	/**
	 * Whether the model can see images. false makes the extension treat it as
	 * text-only: read_file gives it a note instead of the image, naming the
	 * modes whose model can see images so it can hand the image to one of
	 * them (a vision mode), and images are left out of what it is sent. Used
	 * with the openai provider, whose model info otherwise says every model
	 * sees images. Defaults to true.
	 */
	supportsImages?: boolean
	/**
	 * The reasoning effort sent with every request to this model, one of the
	 * levels of --reasoning-effort. Set per model because the levels a model
	 * accepts are its own (GLM-5.3 takes "max", other models reject it). Works
	 * with every provider; the --reasoning-effort flag overrides it for a run.
	 * Without it the openai provider sends no effort and the others "medium".
	 */
	reasoningEffort?: ReasoningEffortFlagOptions
	/**
	 * How much system prompt and how many tools the model gets, the same choice
	 * as "Model size" in the VS Code profile settings: "standard" (the full
	 * prompt and every tool), "slim" (the full prompt, one obvious tool per
	 * job) or "compact" (for very small models: a short prompt, a minimal tool
	 * set with simple editing, shorter environment details, tighter output
	 * limits, no subtasks). Works with every provider. Defaults to "standard".
	 */
	modelSize?: CliModelSize
	/**
	 * With modelSize "slim", also hide the MCP tools, whose schemas are usually
	 * the largest part of the tool prompt. Defaults to true; "compact" always
	 * hides them.
	 */
	hideMcp?: boolean
	/**
	 * How many requests the provider serves for this model at once (a local
	 * server's parallel slots, a plan's concurrency limit), a whole number of 1
	 * or more. Caps the subagents run_parallel_tasks starts on the model: each
	 * takes one request, and the main task takes one when it runs on the same
	 * model. Works with every provider. Without it only the global subagent
	 * limit applies.
	 */
	maxConcurrentRequests?: number
	/**
	 * The modes that run this model, by slug (e.g. ["code", "debug"]). The
	 * same as writing `"modes": { "code": { "model": "<this id>" } }` for each
	 * of them, so a mode listed here runs the model on startup, on every mode
	 * switch, in subtasks and on resume. Works with every provider. Ignored for
	 * a run given any of --provider, --model, --base-url or --api-key, like
	 * `modes`.
	 */
	modes?: string[]
}

export type CliModelSize = (typeof MODEL_SIZES)[number]

export interface CliSettings {
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
	/** @deprecated Ignored with a warning: the reasoning effort is set per model, in `models`. */
	reasoningEffort?: unknown
	/**
	 * Per-mode overrides, keyed by mode slug. Each entry changes only what it
	 * names and inherits the rest; an entry that names a different provider
	 * starts from that provider's defaults (model, baseUrl and key are not
	 * carried across providers). Ignored for a run given any of --provider,
	 * --model, --base-url or --api-key. A model can also name its modes in its
	 * own entry (`models.<id>.modes`), which sets the model of those modes.
	 */
	modes?: Record<string, CliModeSettings>
	/**
	 * Per-model facts, keyed by model id exactly as the provider names it
	 * (e.g. "GLM-5.3-NVFP4"). An entry applies wherever that model runs: the
	 * global settings, a mode entry, --model or /model.
	 */
	models?: Record<string, CliModelSettings>
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Seconds a shell command may run before it is stopped; 0 means no limit (default 300) */
	commandExecutionTimeout?: number
	/**
	 * How many parallel subagents may run at once in the whole run (default 3,
	 * at most 8; 0 or 1 turns subagents off), the extension's "Max parallel
	 * subagents". `models.<id>.maxConcurrentRequests` caps them further per
	 * model.
	 */
	maxParallelSubagents?: number
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
	/**
	 * The Tumble Code Cloud API (for example https://cloud.example.com) that
	 * `tumble auth cloud login` signs in to and a signed-in run sends its
	 * telemetry to. Without it the TUMBLE_CODE_API_URL environment variable
	 * applies.
	 */
	cloudApiUrl?: string
	/**
	 * IANA time zone (for example "Europe/Warsaw") for the times the CLI shows
	 * and tells the model. Only needed where the system zone is missing or
	 * wrong, such as a container without /etc/localtime; overrides TZ.
	 */
	timeZone?: string
}
