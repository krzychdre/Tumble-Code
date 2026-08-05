import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createElement } from "react"
import pWaitFor from "p-wait-for"

import { setLogger } from "@roo-code/vscode-shim"

import {
	FlagOptions,
	isAcceptedProvider,
	resolveProviderIdAlias,
	supportedProviders,
	DEFAULT_FLAGS,
	REASONING_EFFORTS,
	OutputFormat,
	type CliSettings,
	type SupportedProvider,
} from "@/types/index.js"
import { isValidOutputFormat } from "@/types/json-events.js"
import { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { loadSettings, saveSettings } from "@/lib/storage/index.js"
import { readWorkspaceTaskSessions, resolveWorkspaceResumeSessionId } from "@/lib/task-history/index.js"
import { getEnvVarName, getApiKeyFromEnv, providerRequiresApiKey, getProviderSettings } from "@/lib/utils/provider.js"
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

/**
 * Resolve the effective model for a run when no explicit `-m/--model` flag is
 * given (the caller applies the flag first).
 *
 * ▶ Precedence: flag `-m/--model` > persisted cli-settings.json model > mock
 *   VS Code config model > built-in default (caller chain).
 * ▶ A persisted model belongs to the provider that was active when it was
 *   saved — the settings file stores provider + model together. It is applied
 *   only when the persisted provider resolves to the provider actually
 *   running; otherwise the built-in default model is used so a model saved for
 *   another provider never gets sent to the wrong provider (decision A3 of
 *   ai_plans/2026-08-04_cli-bare-run-settings-sync.md).
 */
export function resolveEffectiveModel(
	settings: Pick<CliSettings, "provider" | "model"> | undefined,
	activeProvider: SupportedProvider,
): string | undefined {
	if (!settings?.model) {
		return undefined
	}

	const persistedProvider = settings.provider !== undefined ? resolveProviderIdAlias(settings.provider) : undefined
	if (persistedProvider !== activeProvider) {
		return undefined
	}

	return settings.model
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

	const isTuiSupported = process.stdin.isTTY && process.stdout.isTTY
	const isTuiEnabled = !flagOptions.print && isTuiSupported
	const isOnboardingEnabled = isTuiEnabled && !flagOptions.provider && !settings.provider

	// Reuse provider/model/key/baseUrl chosen in the VS Code extension
	// (via the vscode-shim global storage). Precedence for everything below:
	// CLI flags > settings file > persisted VS Code config > env > defaults.
	const vsCodeConfig = readVsCodeConfig() ?? {}

	// Determine effective values: CLI flags > settings file > DEFAULT_FLAGS.
	const effectiveMode = flagOptions.mode || settings.mode || DEFAULT_FLAGS.mode
	const effectiveReasoningEffort =
		flagOptions.reasoningEffort || settings.reasoningEffort || DEFAULT_FLAGS.reasoningEffort
	const rawEffectiveProvider =
		flagOptions.provider ?? settings.provider ?? vsCodeConfig?.provider ?? DEFAULT_FLAGS.provider
	// Persisted aliases (e.g. the cloud "tumble" id) are accepted and mapped to
	// the real provider (tumble -> openrouter) before anything else consumes it.
	const effectiveProvider = resolveProviderIdAlias(rawEffectiveProvider) as SupportedProvider
	// An explicit -m wins outright; otherwise the persisted model applies only
	// when its provider matches the active provider (its settings were saved
	// for) — a model persisted for a different provider must not be sent to it.
	// Explicit flags > persisted cli-settings.json > mock VS Code config > default.
	const effectiveModel =
		flagOptions.model ||
		resolveEffectiveModel(settings, effectiveProvider) ||
		vsCodeConfig?.model ||
		DEFAULT_FLAGS.model
	const effectiveBaseUrl = flagOptions.baseUrl || settings.baseUrl || vsCodeConfig?.baseUrl || undefined
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

	// Validations
	// TODO: Validate the API key for the chosen provider.
	// TODO: Validate the model for the chosen provider.

	// The raw (possibly aliased) id must be accepted; the effective provider is
	// already the resolved alias (tumble -> openrouter).
	if (!isAcceptedProvider(rawEffectiveProvider)) {
		console.error(
			`[CLI] Error: Invalid provider: ${rawEffectiveProvider}; must be one of: ${supportedProviders.join(", ")}`,
		)
		process.exit(1)
	}

	// A base-url is only valid where the provider's settings schema has a
	// base-url field. Reject early with the provider's name (decision 5).
	if (effectiveBaseUrl) {
		try {
			getProviderSettings(extensionHostOptions.provider, undefined, undefined, effectiveBaseUrl)
		} catch (error) {
			console.error(`[CLI] Error: ${(error as Error).message}`)
			process.exit(1)
		}
	}

	// Provider-aware API-key gate. Providers whose settings schema has no
	// required API-key field (ollama, lmstudio, bedrock, qwen-code, vertex — as
	// derived in provider-types.ts) run keyless; providers that need a key
	// hard-exit with the missing-key message when none was supplied.
	const needsKey = providerRequiresApiKey(extensionHostOptions.provider)

	if (needsKey) {
		extensionHostOptions.apiKey =
			flagOptions.apiKey || getApiKeyFromEnv(extensionHostOptions.provider) || vsCodeConfig?.apiKey

		if (!extensionHostOptions.apiKey) {
			console.error(
				`[CLI] Error: No API key provided. Use --api-key or set the appropriate environment variable.`,
			)
			console.error(
				`[CLI] For ${extensionHostOptions.provider}, set ${getEnvVarName(extensionHostOptions.provider)}`,
			)
			process.exit(1)
		}
	}

	if (!fs.existsSync(extensionHostOptions.workspacePath)) {
		console.error(`[CLI] Error: Workspace path does not exist: ${extensionHostOptions.workspacePath}`)
		process.exit(1)
	}

	if (extensionHostOptions.reasoningEffort && !REASONING_EFFORTS.includes(extensionHostOptions.reasoningEffort)) {
		console.error(
			`[CLI] Error: Invalid reasoning effort: ${extensionHostOptions.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`,
		)
		process.exit(1)
	}

	// Persist provider/model/base-url for the next run (flags > settings > defaults).
	// Keys are never persisted — they stay env/flags only.
	// The provider id is persisted RESOLVED (tumble -> openrouter): the settings
	// file must only ever contain a registry provider id, never a raw alias. A
	// missing raw value stays undefined (a later `null` still clears the key).
	const rawPersistedProvider = flagOptions.provider ?? settings.provider ?? vsCodeConfig?.provider
	const persistedProvider =
		rawPersistedProvider !== undefined ? resolveProviderIdAlias(rawPersistedProvider) : undefined
	const persistedModel = flagOptions.model ?? settings.model ?? vsCodeConfig?.model
	const persistedBaseUrl = flagOptions.baseUrl ?? settings.baseUrl ?? vsCodeConfig?.baseUrl

	// Skip the write entirely when nothing actually changed — an unconditional
	// saveSettings would rewrite the file (and bump mtime) on every plain run
	// even when the values are already persisted.
	const pendingSettings: Partial<Parameters<typeof saveSettings>[0]> = {}
	if (persistedProvider && persistedProvider !== settings.provider) {
		pendingSettings.provider = persistedProvider as typeof settings.provider
	}
	if (persistedModel && persistedModel !== settings.model) {
		pendingSettings.model = persistedModel
	}
	if (persistedBaseUrl && persistedBaseUrl !== settings.baseUrl) {
		pendingSettings.baseUrl = persistedBaseUrl
	}
	if (Object.keys(pendingSettings).length > 0) {
		await saveSettings(pendingSettings)
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
				// Handle Ctrl+C in App component for double-press exit.
				{ exitOnCtrlC: false },
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
