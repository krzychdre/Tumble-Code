import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createElement } from "react"

import { setLogger } from "@tumble-code/vscode-shim"
import { MAX_PARALLEL_TASKS_MAX_CONCURRENCY } from "@tumble-code/types"
import { debugLog, getDebugLogPath } from "@tumble-code/core/cli"

import {
	type CliSettings,
	FlagOptions,
	isAcceptedProvider,
	supportedProviders,
	DEFAULT_FLAGS,
	MAX_COMMAND_EXECUTION_TIMEOUT_SECONDS,
	REASONING_EFFORTS,
	OutputFormat,
} from "@/types/index.js"
import { getOpenAiCodexAuthStatus } from "@/commands/auth/openai-codex.js"
import { isValidOutputFormat } from "@/types/json-events.js"
import { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import {
	createModelChoiceSaver,
	getSettingsPath,
	isSettingsFileReadableByOthers,
	loadSettings,
	resolveMcpSettingsPath,
} from "@/lib/storage/index.js"
import { cloudApiUrlSetting } from "@/lib/auth/cloud-api-url.js"
import { applyTimeZoneSetting } from "@/lib/utils/time-zone.js"
import { readWorkspaceTaskSessions, resolveWorkspaceResumeSessionId } from "@/lib/task-history/index.js"
import {
	getApiKeyField,
	getEnvVarName,
	getProviderSettings,
	providerRequiresApiKey,
	providerRequiresModelId,
} from "@/lib/utils/provider.js"
import {
	modelConnectionLayer,
	pickProviderConfig,
	resolveProviderConfigWithModel,
	resolveReasoningEffort,
	toProviderSettings,
	type ResolvedProviderConfig,
} from "@/lib/utils/provider-config.js"
import {
	MODEL_SETTINGS_PROVIDER,
	findModeBindingProblems,
	findModelSettingsProblems,
	getConfiguredModelSettings,
	getEffectiveModeSettings,
	listSetModelSettings,
} from "@/lib/utils/model-settings.js"
import { readVsCodeConfig } from "@/lib/utils/vscode-config.js"
import { validateTerminalShellPath } from "@/lib/utils/shell.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { isValidSessionId } from "@/lib/utils/session-id.js"
import { VERSION } from "@/lib/utils/version.js"
import { CLEAR_SCREEN } from "@/ui/utils/clearTerminal.js"

import { ExtensionHost, ExtensionHostOptions } from "@/agent/index.js"
import { installProcessGuards } from "@/lib/process-guards.js"
import { formatCrashHint, formatCrashReport } from "@/lib/crash-report.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

/**
 * A command execution timeout as whole seconds, or undefined when the value is
 * not one. Strict on purpose: the extension turns "10m" into NaN and "" into
 * 0, and both silently remove the limit.
 */
function parseCommandExecutionTimeout(value: unknown): number | undefined {
	const seconds = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value

	return typeof seconds === "number" &&
		Number.isInteger(seconds) &&
		seconds >= 0 &&
		seconds <= MAX_COMMAND_EXECUTION_TIMEOUT_SECONDS
		? seconds
		: undefined
}

function missingApiKeyEnvMessage(env: string): string {
	return `apiKeyEnv names ${env}, but that environment variable is empty or unset.`
}

/** The key to hand the extension: only providers with an API-key field get it. */
function keyFor(config: ResolvedProviderConfig): string | undefined {
	return getApiKeyField(config.provider) !== null ? config.apiKey : undefined
}

/**
 * What is wrong with one resolved provider configuration, as the lines to
 * print (the first becomes the error line), or undefined when it can run.
 */
async function findProviderConfigProblem(
	config: ResolvedProviderConfig,
	{ ephemeral }: { ephemeral: boolean },
): Promise<string[] | undefined> {
	// The raw (possibly aliased) id must be accepted; the resolved provider is
	// already the alias target (tumble -> openrouter).
	if (!isAcceptedProvider(config.rawProvider)) {
		return [`Invalid provider: ${config.rawProvider}; must be one of: ${supportedProviders.join(", ")}`]
	}

	if (config.provider === "openai-codex") {
		// OAuth credentials live in persistent vscode-shim SecretStorage. An
		// ephemeral host starts with an empty store, so fail here with an
		// actionable message instead of a generic provider auth error.
		if (ephemeral) {
			return [
				"--ephemeral cannot be used with the openai-codex provider.",
				"Run `tumble auth codex login`, then retry without --ephemeral.",
			]
		}

		const authStatus = await getOpenAiCodexAuthStatus({ quiet: true })
		if (!authStatus.authenticated) {
			return ["OpenAI Codex is not authenticated.", "Run `tumble auth codex login`, then retry."]
		}
	}

	// A base-url is only valid where the provider's settings schema has a
	// base-url field. Reject early with the provider's name (decision 5).
	if (config.baseUrl) {
		try {
			getProviderSettings(config.provider, undefined, undefined, config.baseUrl)
		} catch (error) {
			return [(error as Error).message]
		}
	}

	// API-key gate: the rule the settings UI validates profiles with. OAuth,
	// local and SDK-credential providers (openai-codex, qwen-code, lmstudio,
	// bedrock, vertex) and Ollama, whose key is optional, run without one.
	if (providerRequiresApiKey(config.provider) && !config.apiKey) {
		if (config.missingApiKeyEnv) {
			return [missingApiKeyEnvMessage(config.missingApiKeyEnv)]
		}

		return [
			`No API key provided. Use --api-key, set apiKey or apiKeyEnv in ${getSettingsPath()}, or set the provider's environment variable.`,
			`For ${config.provider}, set ${getEnvVarName(config.provider)}`,
		]
	}

	// The provider needs a model named when it has no default model (openai,
	// ollama, lmstudio); the settings UI requires one for the same providers.
	if (!config.model && providerRequiresModelId(config.provider)) {
		return [`No model given for ${config.provider}. Use --model or set model in ${getSettingsPath()}.`]
	}

	return undefined
}

/** The prompt and the session flags, checked against each other. */
interface PromptAndSession {
	prompt: string | undefined
	requestedSessionId: string | undefined
	requestedCreateSessionId: string | undefined
	isResumeRequested: boolean
}

function readPromptAndSession(promptArg: string | undefined, flagOptions: FlagOptions): PromptAndSession {
	let prompt = promptArg

	if (flagOptions.promptFile) {
		if (!fs.existsSync(flagOptions.promptFile)) {
			console.error(`[CLI] Error: Prompt file does not exist: ${flagOptions.promptFile}`)
			process.exit(1)
		}

		prompt = fs.readFileSync(flagOptions.promptFile, "utf-8")
	}

	const requestedSessionId = flagOptions.sessionId?.trim()
	const requestedCreateSessionId = flagOptions.createWithSessionId?.trim()
	const shouldContinueSession = flagOptions.continue
	const isResumeRequested = Boolean(requestedSessionId || shouldContinueSession)

	if (flagOptions.createWithSessionId !== undefined && !requestedCreateSessionId) {
		console.error("[CLI] Error: --create-with-session-id requires a non-empty session id")
		process.exit(1)
	}

	if (flagOptions.sessionId !== undefined && !requestedSessionId) {
		console.error("[CLI] Error: --session-id requires a non-empty session id")
		process.exit(1)
	}

	if (requestedCreateSessionId && !isValidSessionId(requestedCreateSessionId)) {
		console.error("[CLI] Error: --create-with-session-id must be a valid UUID session id")
		process.exit(1)
	}

	if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
		console.error("[CLI] Error: --session-id must be a valid UUID session id")
		process.exit(1)
	}

	if (requestedCreateSessionId && isResumeRequested) {
		console.error("[CLI] Error: cannot use --create-with-session-id with --session-id/--continue")
		process.exit(1)
	}

	if (requestedSessionId && shouldContinueSession) {
		console.error("[CLI] Error: cannot use --session-id with --continue")
		process.exit(1)
	}

	if (flagOptions.resume && (flagOptions.print || isResumeRequested || requestedCreateSessionId || prompt)) {
		console.error(
			"[CLI] Error: --resume opens the interactive task picker; it cannot be combined with --print, a prompt, --session-id, --continue or --create-with-session-id",
		)
		process.exit(1)
	}

	if (isResumeRequested && prompt) {
		console.error("[CLI] Error: cannot use prompt or --prompt-file with --session-id/--continue")
		console.error("[CLI] Usage: tumble [--session-id <session-id> | --continue] [options]")
		process.exit(1)
	}

	return { prompt, requestedSessionId, requestedCreateSessionId, isResumeRequested }
}

/** cli-settings.json, with its time zone applied and a warning when others can read a key in it. */
async function loadRunSettings(): Promise<CliSettings> {
	const settings = await loadSettings()
	applyTimeZoneSetting(settings, (message) => console.error(`[CLI] Warning: ignoring ${message}`))

	const settingsHoldAKey = [
		settings,
		...Object.values(settings.modes ?? {}),
		...Object.values(settings.models ?? {}),
	].some((entry) => entry?.apiKey)
	if (settingsHoldAKey && (await isSettingsFileReadableByOthers())) {
		console.warn(
			`[CLI] Warning: ${getSettingsPath()} holds an apiKey and other users can read it. Run: chmod 600 ${getSettingsPath()}`,
		)
	}

	return settings
}

/**
 * The provider configurations of the run: the base one, one per mode entry
 * (none under provider flags), the one the session starts with, and the
 * configuration /model gives a model in a mode.
 */
function resolveProviders(
	settings: CliSettings,
	flagOptions: FlagOptions,
	vsCodeConfig: ReturnType<typeof readVsCodeConfig>,
) {
	const settingsProviderConfig = pickProviderConfig(settings)
	const flagProviderConfig = {
		provider: flagOptions.provider,
		model: flagOptions.model,
		baseUrl: flagOptions.baseUrl,
		apiKey: flagOptions.apiKey,
	}
	// A model whose `models` entry sets a provider, base URL or key runs on
	// that connection, under the flags.
	const baseProviderConfig = resolveProviderConfigWithModel({
		fallback: vsCodeConfig,
		layers: [settingsProviderConfig],
		top: flagProviderConfig,
		models: settings.models,
	})

	// Per-mode overrides from the settings file (`modes`, and the modes a
	// `models` entry lists), each resolved on top of the file's global values.
	// Any provider flag makes this run use one configuration for every mode,
	// so the overrides are dropped.
	const isProviderForcedByFlags = Object.values(flagProviderConfig).some((value) => value !== undefined)
	const modeEntries = getEffectiveModeSettings(settings)
	const modeProviderConfigs: Record<string, ResolvedProviderConfig> = isProviderForcedByFlags
		? {}
		: Object.fromEntries(
				Object.entries(modeEntries).map(([modeSlug, { settings: modeSettings }]) => [
					modeSlug,
					resolveProviderConfigWithModel({
						fallback: vsCodeConfig,
						layers: [settingsProviderConfig, pickProviderConfig(modeSettings)],
						models: settings.models,
					}),
				]),
			)

	const effectiveMode = flagOptions.mode || settings.mode || DEFAULT_FLAGS.mode
	// The session starts with the configuration of the mode it starts in.
	const providerConfig = modeProviderConfigs[effectiveMode] ?? baseProviderConfig
	// `models` entries follow the model wherever it runs, flags included, and
	// so does the reasoning effort, which is read from them.
	const modelSettingsFor = (config: ResolvedProviderConfig) =>
		getConfiguredModelSettings(settings.models, config.model)
	const reasoningEffortFor = (config: ResolvedProviderConfig) =>
		resolveReasoningEffort(config.provider, modelSettingsFor(config), flagOptions.reasoningEffort, config.model)
	// The configuration /model gives `model` in `mode`: the mode's layers (none
	// under provider flags) with the model's own connection on top, so a model
	// without one goes back to the mode's connection even after a model that
	// had its own. The flags stay on top, without their model.
	const resolveForModel = (mode: string | undefined, model: string) => {
		const modeSettings = isProviderForcedByFlags || !mode ? undefined : modeEntries[mode]?.settings
		return resolveProviderConfigWithModel({
			fallback: vsCodeConfig,
			layers: [settingsProviderConfig, ...(modeSettings ? [pickProviderConfig(modeSettings)] : [])],
			top: { ...flagProviderConfig, model: undefined },
			models: settings.models,
			model,
		})
	}
	// The provider settings the extension runs `config` with.
	const settingsFor = (config: ResolvedProviderConfig) =>
		toProviderSettings({
			...config,
			apiKey: keyFor(config),
			reasoningEffort: reasoningEffortFor(config),
			modelSettings: modelSettingsFor(config),
		})

	return {
		isProviderForcedByFlags,
		modeEntries,
		modeProviderConfigs,
		baseProviderConfig,
		effectiveMode,
		providerConfig,
		modelSettingsFor,
		reasoningEffortFor,
		resolveForModel,
		settingsFor,
	}
}

type RunProviders = ReturnType<typeof resolveProviders>

/** The mistake limit, the command timeout, the subagent cap and the terminal shell, from flags and settings. */
async function resolveRunLimits(settings: CliSettings, flagOptions: FlagOptions) {
	const rawConsecutiveMistakeLimit =
		flagOptions.consecutiveMistakeLimit ?? settings.consecutiveMistakeLimit ?? DEFAULT_FLAGS.consecutiveMistakeLimit
	const effectiveConsecutiveMistakeLimit = Number(rawConsecutiveMistakeLimit)

	if (!Number.isInteger(effectiveConsecutiveMistakeLimit) || effectiveConsecutiveMistakeLimit < 0) {
		console.error(
			`[CLI] Error: Invalid consecutive mistake limit: ${rawConsecutiveMistakeLimit}; must be a non-negative integer`,
		)
		process.exit(1)
	}

	const rawCommandExecutionTimeout =
		flagOptions.commandExecutionTimeout ?? settings.commandExecutionTimeout ?? DEFAULT_FLAGS.commandExecutionTimeout
	const effectiveCommandExecutionTimeout = parseCommandExecutionTimeout(rawCommandExecutionTimeout)

	if (effectiveCommandExecutionTimeout === undefined) {
		const source =
			flagOptions.commandExecutionTimeout !== undefined
				? "--command-execution-timeout"
				: `commandExecutionTimeout in ${getSettingsPath()}`
		console.error(
			`[CLI] Error: Invalid command execution timeout: ${JSON.stringify(rawCommandExecutionTimeout)}; ${source} must be a whole number of seconds from 0 (no limit) to ${MAX_COMMAND_EXECUTION_TIMEOUT_SECONDS}`,
		)
		process.exit(1)
	}

	const { maxParallelSubagents } = settings
	if (
		maxParallelSubagents !== undefined &&
		!(
			Number.isInteger(maxParallelSubagents) &&
			maxParallelSubagents >= 0 &&
			maxParallelSubagents <= MAX_PARALLEL_TASKS_MAX_CONCURRENCY
		)
	) {
		console.error(
			`[CLI] Error: Invalid maxParallelSubagents in ${getSettingsPath()}: ${JSON.stringify(maxParallelSubagents)}; must be a whole number from 0 to ${MAX_PARALLEL_TASKS_MAX_CONCURRENCY} (0 or 1 turns subagents off)`,
		)
		process.exit(1)
	}

	let terminalShell: string | undefined
	if (flagOptions.terminalShell !== undefined) {
		const validatedTerminalShell = await validateTerminalShellPath(flagOptions.terminalShell)

		if (!validatedTerminalShell.valid) {
			console.error(
				`[CLI] Warning: ignoring --terminal-shell "${flagOptions.terminalShell}" (${validatedTerminalShell.reason})`,
			)
		} else {
			terminalShell = validatedTerminalShell.shellPath
		}
	}

	return {
		consecutiveMistakeLimit: effectiveConsecutiveMistakeLimit,
		commandExecutionTimeout: effectiveCommandExecutionTimeout,
		maxParallelSubagents,
		terminalShell,
	}
}

/**
 * Check every configuration this run can switch to, and the settings that
 * shape them; exits with the first error, warns about what is ignored.
 */
async function checkProviders(settings: CliSettings, flagOptions: FlagOptions, providers: RunProviders) {
	const { providerConfig, baseProviderConfig, modeProviderConfigs, modeEntries, modelSettingsFor, resolveForModel } =
		providers
	const effectiveModel = providerConfig.model

	// Validations: every configuration this run can switch to is checked now,
	// so a broken mode entry fails at startup instead of on the mode switch.
	const providerConfigsToCheck: [label: string | undefined, config: ResolvedProviderConfig][] = [
		[undefined, providerConfig],
		...(providerConfig === baseProviderConfig
			? []
			: [
					[
						`global settings in ${getSettingsPath()} (used by modes without their own entry)`,
						baseProviderConfig,
					] as [string, ResolvedProviderConfig],
				]),
		...Object.entries(modeProviderConfigs)
			.filter(([, config]) => config !== providerConfig)
			.map(
				([modeSlug, config]) =>
					[`${modeEntries[modeSlug]!.label} in ${getSettingsPath()}`, config] as [
						string,
						ResolvedProviderConfig,
					],
			),
		// A model with its own connection may only be reached by /model or
		// --model, so it is checked against the top level as well.
		...Object.entries(settings.models ?? {})
			.filter(([model, entry]) => modelConnectionLayer(model, entry) !== undefined)
			.map(
				([model]) =>
					[`models.${model} in ${getSettingsPath()}`, resolveForModel(undefined, model)] as [
						string,
						ResolvedProviderConfig,
					],
			),
	]

	if (flagOptions.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(flagOptions.reasoningEffort)) {
		console.error(
			`[CLI] Error: Invalid reasoning effort: ${flagOptions.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`,
		)
		process.exit(1)
	}

	// A reasoning effort at the top level or in a mode entry applied to every
	// model that ran there, and a level one model takes is rejected by another
	// ("max" for GLM-5.3, not for Qwen). It now lives in the model's entry;
	// say where to move it instead of silently dropping it.
	const misplacedReasoningEfforts = [
		...(settings.reasoningEffort !== undefined ? [["reasoningEffort", effectiveModel] as const] : []),
		...Object.entries(settings.modes ?? {})
			.filter(([, modeSettings]) => modeSettings.reasoningEffort !== undefined)
			.map(
				([modeSlug]) =>
					[
						`modes.${modeSlug}.reasoningEffort`,
						modeProviderConfigs[modeSlug]?.model ?? effectiveModel,
					] as const,
			),
	]
	for (const [key, model] of misplacedReasoningEfforts) {
		console.warn(
			`[CLI] Warning: ${key} in ${getSettingsPath()} is ignored: the reasoning effort is set per model now. Move it into the model's entry, e.g. "models": { ${JSON.stringify(model || "<model id>")}: { "reasoningEffort": "high" } }.`,
		)
	}

	const modelSettingsProblems = [...findModelSettingsProblems(settings.models), ...findModeBindingProblems(settings)]
	if (modelSettingsProblems.length > 0) {
		for (const problem of modelSettingsProblems) {
			console.error(`[CLI] Error: ${problem} (in ${getSettingsPath()})`)
		}
		process.exit(1)
	}

	// A context window, a price, supportsImages, preserveReasoning or
	// trimOldReasoning set for a model that some configuration runs on another
	// provider reaches nothing there; say so instead of letting the gauge, the
	// condensing, the cost and the image handling silently keep the provider's
	// own numbers.
	const ignoredModelSettingsWarnings = new Set(
		providerConfigsToCheck
			.map(([, config]) => [config, listSetModelSettings(modelSettingsFor(config))] as const)
			.filter(([config, keys]) => config.provider !== MODEL_SETTINGS_PROVIDER && keys.length > 0)
			.map(
				([config, keys]) =>
					`[CLI] Warning: models.${config.model} (${keys.join(", ")}) in ${getSettingsPath()} is ignored with the ${config.provider} provider; only ${MODEL_SETTINGS_PROVIDER} takes per-model settings from the settings file.`,
			),
	)
	for (const warning of ignoredModelSettingsWarnings) {
		console.warn(warning)
	}

	for (const [label, config] of providerConfigsToCheck) {
		const problem = await findProviderConfigProblem(config, { ephemeral: flagOptions.ephemeral })

		if (problem) {
			const [first, ...rest] = problem
			console.error(`[CLI] Error: ${label ? `${label}: ` : ""}${first}`)
			for (const line of rest) {
				console.error(`[CLI] ${line}`)
			}
			process.exit(1)
		}
	}
}

/** Everything a run needs after the flags and the settings have been read and checked. */
interface RunOptions {
	flagOptions: FlagOptions
	prompt: string | undefined
	requestedCreateSessionId: string | undefined
	isResumeRequested: boolean
	resolvedResumeSessionId: string | undefined
	outputFormat: OutputFormat
	exitOnComplete: boolean
	extensionHostOptions: ExtensionHostOptions
	/** Named in every crash report: the debug log, or how to get one (§4). */
	crashHintOptions: { debug: boolean; logPath: string }
}

async function resolveRunOptions(
	promptArg: string | undefined,
	flagOptions: FlagOptions,
	isTuiEnabled: boolean,
	isTuiSupported: boolean,
): Promise<RunOptions> {
	const { prompt, requestedSessionId, requestedCreateSessionId, isResumeRequested } = readPromptAndSession(
		promptArg,
		flagOptions,
	)

	// The interactive session starts on a clean screen. This runs before any
	// warning below is printed, so the clear never hides one of them, and
	// before ink draws its first frame, so writing to stdout directly is safe.
	if (isTuiEnabled) {
		process.stdout.write(CLEAR_SCREEN)
	}

	const settings = await loadRunSettings()

	// Provider connection: flags > settings file > the CLI's own extension
	// state (~/.vscode-mock) > defaults, with provider-bound values (model,
	// base URL, key) used only for the provider they were written for.
	const vsCodeConfig = readVsCodeConfig()

	// With no provider anywhere (flag, settings file, the CLI's own extension
	// state) the run starts on the default provider; say how to choose one.
	if (isTuiEnabled && !flagOptions.provider && !settings.provider && !vsCodeConfig?.provider) {
		console.log(
			`[CLI] No provider configured, using ${DEFAULT_FLAGS.provider}. Set provider and apiKey (or apiKeyEnv) in ${getSettingsPath()}, or pass --provider and --api-key.`,
		)
	}
	const providers = resolveProviders(settings, flagOptions, vsCodeConfig)
	const { providerConfig, reasoningEffortFor, resolveForModel, settingsFor } = providers

	// Workspace precedence: explicit -w/--workspace wins; bare runs always use
	// the current working directory. The workspace is intentionally NEVER read
	// from persisted settings: `tumble` must follow the directory it is run
	// in, so a persisted workspace could never override pwd (decision A1 of
	// ai_plans/2026-08-04_cli-bare-run-settings-sync.md).
	const effectiveWorkspacePath = flagOptions.workspace ? path.resolve(flagOptions.workspace) : process.cwd()
	const legacyRequireApprovalFromSettings =
		settings.requireApproval ??
		(settings.dangerouslySkipPermissions === undefined ? undefined : !settings.dangerouslySkipPermissions)
	const effectiveRequireApproval = flagOptions.requireApproval || legacyRequireApprovalFromSettings || false
	const effectiveExitOnComplete = flagOptions.print || flagOptions.oneshot || settings.oneshot || false
	const limits = await resolveRunLimits(settings, flagOptions)
	const effectiveReasoningEffort = reasoningEffortFor(providerConfig)

	const extensionHostOptions: ExtensionHostOptions = {
		mode: providers.effectiveMode,
		reasoningEffort: effectiveReasoningEffort === "unspecified" ? undefined : effectiveReasoningEffort,
		...limits,
		provider: providerConfig.provider,
		model: providerConfig.model,
		modelSettings: providers.modelSettingsFor(providerConfig),
		models: settings.models,
		workspacePath: effectiveWorkspacePath,
		extensionPath: path.resolve(flagOptions.extension || getDefaultExtensionPath(__dirname)),
		mcpSettingsPath: resolveMcpSettingsPath(settings.mcpSettingsPath),
		cloudApiUrl: cloudApiUrlSetting(settings, (message) => console.error(`[CLI] Warning: ignoring ${message}`)),
		baseUrl: providerConfig.baseUrl,
		nonInteractive: !effectiveRequireApproval,
		exitOnError: flagOptions.exitOnError,
		ephemeral: flagOptions.ephemeral,
		debug: flagOptions.debug,
		resolveModelProviderSettings: (mode, model) => {
			const config = resolveForModel(mode, model)
			if (providerRequiresApiKey(config.provider) && !config.apiKey) {
				throw new Error(
					config.missingApiKeyEnv
						? missingApiKeyEnvMessage(config.missingApiKeyEnv)
						: `${model} runs on ${config.provider}, which needs an API key: set apiKey or apiKeyEnv in its models entry, or ${getEnvVarName(config.provider)}.`,
				)
			}
			return settingsFor(config)
		},
		// /model keeps its choice for later sessions, except where this run
		// ignores the file's mode models or promises to persist nothing.
		saveModelChoice: createModelChoiceSaver({
			providerFlags: providers.isProviderForcedByFlags,
			ephemeral: flagOptions.ephemeral,
		}),
	}

	await checkProviders(settings, flagOptions, providers)

	extensionHostOptions.apiKey = keyFor(providerConfig)
	extensionHostOptions.modeProviderSettings = {
		base: settingsFor(providers.baseProviderConfig),
		modes: Object.fromEntries(
			Object.entries(providers.modeProviderConfigs).map(([modeSlug, config]) => [modeSlug, settingsFor(config)]),
		),
	}

	if (!fs.existsSync(extensionHostOptions.workspacePath)) {
		console.error(`[CLI] Error: Workspace path does not exist: ${extensionHostOptions.workspacePath}`)
		process.exit(1)
	}

	// Validate output format
	const outputFormat: OutputFormat = (flagOptions.outputFormat as OutputFormat) || "text"

	if (!isValidOutputFormat(outputFormat)) {
		console.error(
			`[CLI] Error: Invalid output format: ${flagOptions.outputFormat}; must be one of: text, json, stream-json`,
		)
		process.exit(1)
	}

	// Output format only works with --print mode
	if (outputFormat !== "text" && !flagOptions.print && isTuiSupported) {
		console.error("[CLI] Error: --output-format requires --print mode")
		console.error("[CLI] Usage: tumble --print --output-format json")
		process.exit(1)
	}

	let resolvedResumeSessionId: string | undefined

	if (isResumeRequested) {
		const workspaceSessions = await readWorkspaceTaskSessions(effectiveWorkspacePath)
		try {
			resolvedResumeSessionId = resolveWorkspaceResumeSessionId(workspaceSessions, requestedSessionId)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			console.error(`[CLI] Error: ${message}`)
			process.exit(1)
		}
	}

	if (!isTuiEnabled) {
		if (!prompt && !isResumeRequested) {
			if (flagOptions.print) {
				console.error("[CLI] Error: no prompt provided")
				console.error("[CLI] Usage: tumble --print [options] <prompt>")
			} else {
				console.error("[CLI] Error: prompt is required in non-interactive mode")
				console.error("[CLI] Usage: tumble <prompt> [options]")
				console.error("[CLI] Run without -p for interactive mode")
			}

			process.exit(1)
		}

		if (!flagOptions.print) {
			console.warn("[CLI] TUI disabled (no TTY support), falling back to print mode")
		}
	}

	return {
		flagOptions,
		prompt,
		requestedCreateSessionId,
		isResumeRequested,
		resolvedResumeSessionId,
		outputFormat,
		exitOnComplete: effectiveExitOnComplete,
		extensionHostOptions,
		crashHintOptions: { debug: flagOptions.debug, logPath: getDebugLogPath() },
	}
}

async function runTui({
	flagOptions,
	prompt,
	requestedCreateSessionId,
	resolvedResumeSessionId,
	exitOnComplete,
	extensionHostOptions,
	crashHintOptions,
}: RunOptions): Promise<void> {
	try {
		const { render } = await import("ink")
		const { App } = await import("../../ui/App.js")
		const { createImageStdout } = await import("../../ui/utils/imageStdout.js")
		const { TuiErrorBoundary } = await import("../../ui/components/TuiErrorBoundary.js")
		const { GraphicsContext } = await import("../../ui/graphics/GraphicsContext.js")
		const { probeTerminalGraphics } = await import("../../ui/graphics/terminalProbe.js")

		// Asked before ink takes stdin over: the terminal answers on stdin.
		const graphics = await probeTerminalGraphics({ stdin: process.stdin, stdout: process.stdout })
		debugLog("[CLI] terminal graphics", graphics)
		// The model learns from the system prompt what reaches the user.
		extensionHostOptions.display = graphics.protocol ? "images" : "text"

		const instance = render(
			createElement(
				GraphicsContext.Provider,
				{ value: { ...graphics, baseDir: extensionHostOptions.workspacePath } },
				createElement(
					TuiErrorBoundary,
					{
						// A render crash is reported once here; the guards'
						// uncaughtException handler does not fire for it. The
						// fallback stays on screen, so the hint goes there and
						// the stack goes into the debug log (a no-op without
						// --debug, which is what the hint then suggests).
						onError: (error: Error) => debugLog("[CLI] TUI crashed", error.stack || error.message),
						hint: formatCrashHint(crashHintOptions),
					},
					createElement(App, {
						...extensionHostOptions,
						initialPrompt: prompt,
						initialTaskId: requestedCreateSessionId,
						initialSessionId: resolvedResumeSessionId,
						exitOnComplete,
						openResumePicker: flagOptions.resume,
						version: VERSION,
						createExtensionHost: (opts: ExtensionHostOptions) => new ExtensionHost(opts),
					}),
				),
			),
			{
				// Handle Ctrl+C in App component for double-press exit.
				exitOnCtrlC: false,
				// Diff frames per line instead of erase-all + rewrite:
				// ink's standard log-update repaints the whole dynamic
				// region every frame, which blinks on each spinner tick
				// and stream chunk.
				incrementalRendering: true,
				stdout: createImageStdout(process.stdout),
			},
		)

		// The TUI installs no handlers of its own anywhere else: without
		// these, a crash or `kill` left the terminal in raw mode (no
		// unmount) and --ephemeral storage leaked in /tmp. Cleanup unmounts
		// the renderer, whose teardown restores the terminal, then lets the
		// App's own host disposal (useExtensionHost's unmount effect) run.
		// The exit timeout bounds a hung dispose so the guard cannot strand
		// the terminal either. Normal exits go through App's Ctrl+C
		// handler (exitOnCtrlC is false); SIGINT reaches this handler only
		// when no useInput consumer is alive to see it.
		//
		// A crash is only recorded in onError and printed after the
		// unmount: before it, ink owns the screen, and console.error is
		// routed into the debug log by the host's quiet mode.
		let crash: { error: unknown; source: string } | undefined

		const disposeGuards = installProcessGuards({
			onCleanup: async () => {
				instance.unmount()
				// Give the unmount effects (host dispose, transcript
				// detach) a tick to run before the process goes away.
				await new Promise((resolve) => setImmediate(resolve))

				if (crash) {
					process.stderr.write(formatCrashReport(crash.error, { source: crash.source, ...crashHintOptions }))
				}
			},
			onError: (error, source) => {
				crash ??= { error, source }
				debugLog(`[CLI] ${source}`, error instanceof Error ? error.stack || error.message : String(error))
			},
		})
		void disposeGuards
	} catch (error) {
		process.stderr.write(formatCrashReport(error, { source: "starting the TUI", ...crashHintOptions }))
		process.exit(1)
	}
}

async function runPrint({
	prompt,
	requestedCreateSessionId,
	isResumeRequested,
	resolvedResumeSessionId,
	outputFormat,
	extensionHostOptions,
	crashHintOptions,
}: RunOptions): Promise<void> {
	const useJsonOutput = outputFormat === "json" || outputFormat === "stream-json"

	extensionHostOptions.disableOutput = useJsonOutput
	// Nobody answers an api_req_failed ask or cancels a retry in a print or JSON run that auto-approves.
	extensionHostOptions.unattended = extensionHostOptions.nonInteractive

	const host = new ExtensionHost(extensionHostOptions)
	const jsonEmitter = useJsonOutput ? new JsonEventEmitter({ mode: outputFormat as "json" | "stream-json" }) : null

	const emitRuntimeError = (error: Error, source?: string) => {
		const errorMessage = source ? `${source}: ${error.message}` : error.message

		if (useJsonOutput) {
			const errorEvent = { type: "error", id: Date.now(), content: errorMessage }
			process.stdout.write(JSON.stringify(errorEvent) + "\n")
			return
		}

		// process.stderr, not console.error: while the host is alive,
		// its quiet mode routes console.error into the debug log, so a
		// run without --debug never showed why it failed.
		const stack = error.stack ? `${error.stack}\n` : ""
		process.stderr.write(`[CLI] Error: ${errorMessage}\n${stack}${formatCrashHint(crashHintOptions)}\n`)
	}

	const flushStdout = async () => {
		try {
			if (!process.stdout.writable || process.stdout.destroyed) {
				return
			}

			await new Promise<void>((resolve, reject) => {
				process.stdout.write("", (error?: Error | null) => {
					if (error) {
						reject(error)
						return
					}

					resolve()
				})
			})
		} catch {
			// Best effort: shutdown should proceed even if stdout flush fails.
		}
	}

	// The same guard module the TUI uses (R6). Cleanup is one pass shared
	// by signals, crashes and the task loop's own exit paths: host dispose
	// + JSON emitter flush. The guards run it at most once.
	const disposeGuards = installProcessGuards({
		onCleanup: async (cause) => {
			if (!useJsonOutput && cause !== "dispose") {
				console.log(`\n[CLI] Received ${cause}, shutting down...`)
			}

			jsonEmitter?.detach()
			await host.dispose()

			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
		},
		onError: (error, source) => emitRuntimeError(normalizeError(error), source),
	})

	try {
		await host.activate()

		if (jsonEmitter) {
			jsonEmitter.attachToClient(host.client)
		}

		if (isResumeRequested) {
			await host.resumeTask(resolvedResumeSessionId!)
		} else {
			await host.runTask(prompt!, requestedCreateSessionId)
		}

		// The shared cleanup pass (host dispose + JSON flush) also removes
		// the guards, so nothing double-handles a late signal.
		await disposeGuards()
		await flushStdout()
		process.exit(0)
	} catch (error) {
		emitRuntimeError(normalizeError(error))
		await disposeGuards()
		await flushStdout()
		process.exit(1)
	}
}

export async function run(promptArg: string | undefined, flagOptions: FlagOptions) {
	setLogger({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	})

	const isTuiSupported = process.stdin.isTTY && process.stdout.isTTY
	const isTuiEnabled = !flagOptions.print && isTuiSupported
	const runOptions = await resolveRunOptions(promptArg, flagOptions, isTuiEnabled, isTuiSupported)

	if (isTuiEnabled) {
		await runTui(runOptions)
	} else {
		await runPrint(runOptions)
	}
}
