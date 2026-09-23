import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createElement } from "react"
import pWaitFor from "p-wait-for"

import { setLogger } from "@roo-code/vscode-shim"

import {
	FlagOptions,
	isAcceptedProvider,
	supportedProviders,
	DEFAULT_FLAGS,
	REASONING_EFFORTS,
	OutputFormat,
} from "@/types/index.js"
import { getOpenAiCodexAuthStatus } from "@/commands/auth/openai-codex.js"
import { isValidOutputFormat } from "@/types/json-events.js"
import { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { getSettingsPath, isSettingsFileReadableByOthers, loadSettings } from "@/lib/storage/index.js"
import { readWorkspaceTaskSessions, resolveWorkspaceResumeSessionId } from "@/lib/task-history/index.js"
import { getEnvVarName, providerRequiresApiKey, getProviderSettings } from "@/lib/utils/provider.js"
import {
	pickProviderConfig,
	resolveProviderConfig,
	toProviderSettings,
	type ResolvedProviderConfig,
} from "@/lib/utils/provider-config.js"
import { readVsCodeConfig } from "@/lib/utils/vscode-config.js"
import { runOnboarding } from "@/lib/utils/onboarding.js"
import { validateTerminalShellPath } from "@/lib/utils/shell.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { isValidSessionId } from "@/lib/utils/session-id.js"
import { VERSION } from "@/lib/utils/version.js"

import { ExtensionHost, ExtensionHostOptions } from "@/agent/index.js"
import { isExpectedControlFlowError } from "./cancellation.js"
import { runStdinStreamMode } from "./stdin-stream.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_ONLY_EXIT_KEEPALIVE_MS = 60_000
const STREAM_RESUME_WAIT_TIMEOUT_MS = 2_000

async function bootstrapResumeForStdinStream(host: ExtensionHost, sessionId: string): Promise<void> {
	host.sendToExtension({ type: "showTaskWithId", text: sessionId })

	// Best-effort wait so early stdin "message" commands can target the resumed task.
	await pWaitFor(() => host.client.hasActiveTask() || host.isWaitingForInput(), {
		interval: 25,
		timeout: STREAM_RESUME_WAIT_TIMEOUT_MS,
	}).catch(() => undefined)
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

/** The key to hand the extension: only providers that take one get it. */
function keyFor(config: ResolvedProviderConfig): string | undefined {
	return providerRequiresApiKey(config.provider) ? config.apiKey : undefined
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

	// Provider-aware API-key gate: providers whose settings schema has no
	// API-key field (ollama, lmstudio, bedrock, qwen-code, vertex, as derived
	// in provider-types.ts) run keyless.
	if (providerRequiresApiKey(config.provider) && !config.apiKey) {
		if (config.missingApiKeyEnv) {
			return [`apiKeyEnv names ${config.missingApiKeyEnv}, but that environment variable is empty or unset.`]
		}

		return [
			`No API key provided. Use --api-key, set apiKey or apiKeyEnv in ${getSettingsPath()}, or set the provider's environment variable.`,
			`For ${config.provider}, set ${getEnvVarName(config.provider)}`,
		]
	}

	if (!REASONING_EFFORTS.includes(config.reasoningEffort)) {
		return [`Invalid reasoning effort: ${config.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`]
	}

	return undefined
}

export async function run(promptArg: string | undefined, flagOptions: FlagOptions) {
	setLogger({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	})

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

	if (isResumeRequested && prompt) {
		console.error("[CLI] Error: cannot use prompt or --prompt-file with --session-id/--continue")
		console.error("[CLI] Usage: tumble [--session-id <session-id> | --continue] [options]")
		process.exit(1)
	}

	// Options

	const settings = await loadSettings()

	const settingsHoldAKey = [settings, ...Object.values(settings.modes ?? {})].some((entry) => entry.apiKey)
	if (settingsHoldAKey && (await isSettingsFileReadableByOthers())) {
		console.warn(
			`[CLI] Warning: ${getSettingsPath()} holds an apiKey and other users can read it. Run: chmod 600 ${getSettingsPath()}`,
		)
	}

	const isTuiSupported = process.stdin.isTTY && process.stdout.isTTY
	const isTuiEnabled = !flagOptions.print && isTuiSupported
	const isOnboardingEnabled = isTuiEnabled && !flagOptions.provider && !settings.provider

	// Provider connection: flags > settings file > the CLI's own extension
	// state (~/.vscode-mock) > defaults, with provider-bound values (model,
	// base URL, key) used only for the provider they were written for.
	const vsCodeConfig = readVsCodeConfig()
	const settingsProviderConfig = pickProviderConfig(settings)
	const flagProviderConfig = {
		provider: flagOptions.provider,
		model: flagOptions.model,
		baseUrl: flagOptions.baseUrl,
		apiKey: flagOptions.apiKey,
		reasoningEffort: flagOptions.reasoningEffort,
	}
	const baseProviderConfig = resolveProviderConfig({
		fallback: vsCodeConfig,
		layers: [settingsProviderConfig, flagProviderConfig],
	})

	// Per-mode overrides from the settings file, each resolved on top of the
	// file's global values. Any provider flag makes this run use one
	// configuration for every mode, so the overrides are dropped.
	const isProviderForcedByFlags = Object.values(flagProviderConfig).some((value) => value !== undefined)
	const modeProviderConfigs: Record<string, ResolvedProviderConfig> = isProviderForcedByFlags
		? {}
		: Object.fromEntries(
				Object.entries(settings.modes ?? {}).map(([modeSlug, modeSettings]) => [
					modeSlug,
					resolveProviderConfig({
						fallback: vsCodeConfig,
						layers: [settingsProviderConfig, pickProviderConfig(modeSettings)],
					}),
				]),
			)

	const effectiveMode = flagOptions.mode || settings.mode || DEFAULT_FLAGS.mode
	// The session starts with the configuration of the mode it starts in.
	const providerConfig = modeProviderConfigs[effectiveMode] ?? baseProviderConfig
	const effectiveReasoningEffort = providerConfig.reasoningEffort
	const effectiveProvider = providerConfig.provider
	const effectiveModel = providerConfig.model
	const effectiveBaseUrl = providerConfig.baseUrl
	// Workspace precedence: explicit -w/--workspace wins; bare runs always use
	// the current working directory. The workspace is intentionally NEVER read
	// from persisted settings — `tumble` must follow the directory it is run
	// in, so a persisted workspace could never override pwd (decision A1 of
	// ai_plans/2026-08-04_cli-bare-run-settings-sync.md).
	const effectiveWorkspacePath = flagOptions.workspace ? path.resolve(flagOptions.workspace) : process.cwd()
	const legacyRequireApprovalFromSettings =
		settings.requireApproval ??
		(settings.dangerouslySkipPermissions === undefined ? undefined : !settings.dangerouslySkipPermissions)
	const effectiveRequireApproval = flagOptions.requireApproval || legacyRequireApprovalFromSettings || false
	const effectiveExitOnComplete = flagOptions.print || flagOptions.oneshot || settings.oneshot || false
	const rawConsecutiveMistakeLimit =
		flagOptions.consecutiveMistakeLimit ?? settings.consecutiveMistakeLimit ?? DEFAULT_FLAGS.consecutiveMistakeLimit
	const effectiveConsecutiveMistakeLimit = Number(rawConsecutiveMistakeLimit)

	if (!Number.isInteger(effectiveConsecutiveMistakeLimit) || effectiveConsecutiveMistakeLimit < 0) {
		console.error(
			`[CLI] Error: Invalid consecutive mistake limit: ${rawConsecutiveMistakeLimit}; must be a non-negative integer`,
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

	const extensionHostOptions: ExtensionHostOptions = {
		mode: effectiveMode,
		reasoningEffort: effectiveReasoningEffort === "unspecified" ? undefined : effectiveReasoningEffort,
		consecutiveMistakeLimit: effectiveConsecutiveMistakeLimit,
		user: null,
		provider: effectiveProvider,
		model: effectiveModel,
		workspacePath: effectiveWorkspacePath,
		extensionPath: path.resolve(flagOptions.extension || getDefaultExtensionPath(__dirname)),
		baseUrl: effectiveBaseUrl,
		nonInteractive: !effectiveRequireApproval,
		exitOnError: flagOptions.exitOnError,
		ephemeral: flagOptions.ephemeral,
		debug: flagOptions.debug,
		exitOnComplete: effectiveExitOnComplete,
		terminalShell,
	}

	// Tumble Code Cloud Authentication

	if (isOnboardingEnabled) {
		let { onboardingProviderChoice } = settings

		if (!onboardingProviderChoice) {
			const { choice } = await runOnboarding()
			onboardingProviderChoice = choice
		}
	}

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
					[`modes.${modeSlug} in ${getSettingsPath()}`, config] as [string, ResolvedProviderConfig],
			),
	]

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

	extensionHostOptions.apiKey = keyFor(providerConfig)
	extensionHostOptions.modeProviderSettings = {
		base: toProviderSettings({ ...baseProviderConfig, apiKey: keyFor(baseProviderConfig) }),
		modes: Object.fromEntries(
			Object.entries(modeProviderConfigs).map(([modeSlug, config]) => [
				modeSlug,
				toProviderSettings({ ...config, apiKey: keyFor(config) }),
			]),
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

	if (flagOptions.stdinPromptStream && !flagOptions.print) {
		console.error("[CLI] Error: --stdin-prompt-stream requires --print mode")
		console.error("[CLI] Usage: tumble --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.signalOnlyExit && !flagOptions.stdinPromptStream) {
		console.error("[CLI] Error: --signal-only-exit requires --stdin-prompt-stream")
		console.error(
			"[CLI] Usage: tumble --print --output-format stream-json --stdin-prompt-stream --signal-only-exit",
		)
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && outputFormat !== "stream-json") {
		console.error("[CLI] Error: --stdin-prompt-stream requires --output-format=stream-json")
		console.error("[CLI] Usage: tumble --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && process.stdin.isTTY) {
		console.error("[CLI] Error: --stdin-prompt-stream requires piped stdin")
		console.error(
			'[CLI] Example: printf \'{"command":"start","requestId":"1","prompt":"1+1=?"}\\n\' | tumble --print --output-format stream-json --stdin-prompt-stream [options]',
		)
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && prompt) {
		console.error("[CLI] Error: cannot use positional prompt or --prompt-file with --stdin-prompt-stream")
		console.error("[CLI] Usage: tumble --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && requestedCreateSessionId) {
		console.error("[CLI] Error: --create-with-session-id is not supported with --stdin-prompt-stream")
		console.error('[CLI] Use per-request "taskId" in stdin start commands instead.')
		process.exit(1)
	}

	const useStdinPromptStream = flagOptions.stdinPromptStream
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
		if (!prompt && !useStdinPromptStream && !isResumeRequested) {
			if (flagOptions.print) {
				console.error("[CLI] Error: no prompt provided")
				console.error("[CLI] Usage: tumble --print [options] <prompt>")
				console.error(
					"[CLI] For stdin control mode: tumble --print --output-format stream-json --stdin-prompt-stream [options]",
				)
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

	// Run!

	if (isTuiEnabled) {
		try {
			const { render } = await import("ink")
			const { App } = await import("../../ui/App.js")
			const { createScrollSafeStdout } = await import("../../ui/utils/scrollSafeStdout.js")

			render(
				createElement(App, {
					...extensionHostOptions,
					initialPrompt: prompt,
					initialTaskId: requestedCreateSessionId,
					initialSessionId: resolvedResumeSessionId,
					continueSession: false,
					version: VERSION,
					createExtensionHost: (opts: ExtensionHostOptions) => new ExtensionHost(opts),
				}),
				{
					// Handle Ctrl+C in App component for double-press exit.
					exitOnCtrlC: false,
					// Diff frames per line instead of erase-all + rewrite —
					// ink's standard log-update repaints the whole dynamic
					// region every frame, which blinks on each spinner tick
					// and stream chunk.
					incrementalRendering: true,
					// ...which skips unchanged rows with a cursor move that
					// does not scroll on the bottom row; see scrollSafeStdout.
					stdout: createScrollSafeStdout(process.stdout),
				},
			)
		} catch (error) {
			console.error("[CLI] Failed to start TUI:", error instanceof Error ? error.message : String(error))

			if (error instanceof Error) {
				console.error(error.stack)
			}

			process.exit(1)
		}
	} else {
		const useJsonOutput = outputFormat === "json" || outputFormat === "stream-json"
		const signalOnlyExit = flagOptions.signalOnlyExit

		extensionHostOptions.disableOutput = useJsonOutput

		const host = new ExtensionHost(extensionHostOptions)
		let streamRequestId: string | undefined
		let keepAliveInterval: NodeJS.Timeout | undefined
		let isShuttingDown = false
		let hostDisposed = false

		const jsonEmitter = useJsonOutput
			? new JsonEventEmitter({
					mode: outputFormat as "json" | "stream-json",
					requestIdProvider: () => streamRequestId,
				})
			: null

		const emitRuntimeError = (error: Error, source?: string) => {
			const errorMessage = source ? `${source}: ${error.message}` : error.message

			if (useJsonOutput) {
				const errorEvent = { type: "error", id: Date.now(), content: errorMessage }
				process.stdout.write(JSON.stringify(errorEvent) + "\n")
				return
			}

			console.error("[CLI] Error:", errorMessage)
			console.error(error.stack)
		}

		const clearKeepAliveInterval = () => {
			if (!keepAliveInterval) {
				return
			}

			clearInterval(keepAliveInterval)
			keepAliveInterval = undefined
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

		const ensureKeepAliveInterval = () => {
			if (!signalOnlyExit || keepAliveInterval) {
				return
			}

			keepAliveInterval = setInterval(() => {}, SIGNAL_ONLY_EXIT_KEEPALIVE_MS)
		}

		const disposeHost = async () => {
			if (hostDisposed) {
				return
			}

			hostDisposed = true
			jsonEmitter?.detach()
			await host.dispose()
		}

		const onSigint = () => {
			void shutdown("SIGINT", 130)
		}

		const onSigterm = () => {
			void shutdown("SIGTERM", 143)
		}

		const onUncaughtException = (error: Error) => {
			if (
				isExpectedControlFlowError(error, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			emitRuntimeError(error, "uncaughtException")

			if (signalOnlyExit) {
				return
			}

			void shutdown("uncaughtException", 1)
		}

		const onUnhandledRejection = (reason: unknown) => {
			if (
				isExpectedControlFlowError(reason, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			const error = normalizeError(reason)
			emitRuntimeError(error, "unhandledRejection")

			if (signalOnlyExit) {
				return
			}

			void shutdown("unhandledRejection", 1)
		}

		const parkUntilSignal = async (reason: string): Promise<never> => {
			ensureKeepAliveInterval()

			if (!useJsonOutput) {
				console.error(`[CLI] ${reason} (--signal-only-exit active; waiting for SIGINT/SIGTERM).`)
			}

			await new Promise<void>(() => {})
			throw new Error("unreachable")
		}

		async function shutdown(signal: string, exitCode: number): Promise<void> {
			if (isShuttingDown) {
				return
			}

			isShuttingDown = true
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			clearKeepAliveInterval()

			if (!useJsonOutput) {
				console.log(`\n[CLI] Received ${signal}, shutting down...`)
			}

			await disposeHost()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()
			process.exit(exitCode)
		}

		process.on("SIGINT", onSigint)
		process.on("SIGTERM", onSigterm)
		process.on("uncaughtException", onUncaughtException)
		process.on("unhandledRejection", onUnhandledRejection)

		try {
			await host.activate()

			if (jsonEmitter) {
				jsonEmitter.attachToClient(host.client)
			}

			if (useStdinPromptStream) {
				if (!jsonEmitter || outputFormat !== "stream-json") {
					throw new Error("--stdin-prompt-stream requires --output-format=stream-json to emit control events")
				}

				if (isResumeRequested) {
					await bootstrapResumeForStdinStream(host, resolvedResumeSessionId!)
				}

				await runStdinStreamMode({
					host,
					jsonEmitter,
					setStreamRequestId: (id) => {
						streamRequestId = id
					},
				})
			} else {
				if (isResumeRequested) {
					await host.resumeTask(resolvedResumeSessionId!)
				} else {
					await host.runTask(prompt!, requestedCreateSessionId)
				}
			}

			await disposeHost()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop completed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(0)
		} catch (error) {
			emitRuntimeError(normalizeError(error))
			await disposeHost()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop failed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(1)
		}
	}
}
