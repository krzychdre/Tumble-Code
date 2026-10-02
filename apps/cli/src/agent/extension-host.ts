/**
 * ExtensionHost - Loads and runs the Tumble Code extension in CLI mode
 *
 * This class is a thin coordination layer responsible for:
 * 1. Creating the vscode-shim mock
 * 2. Loading the extension bundle via require()
 * 3. Activating the extension
 * 4. Wiring up managers for output, prompting, and ask handling
 */

import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"
import { EventEmitter } from "events"

import pWaitFor from "p-wait-for"

import type {
	ClineMessage,
	CliModeProviderSettings,
	ExtensionMessage,
	ReasoningEffortExtended,
	TumbleCodeSettings,
	WebviewMessage,
} from "@tumble-code/types"
import { CLI_RUNTIME_ENV, clearCliRuntimeGlobals, setCliRuntimeGlobals } from "@tumble-code/types"
import {
	createVSCodeAPI,
	IExtensionHost,
	ExtensionHostEventMap,
	setRuntimeConfigValues,
} from "@tumble-code/vscode-shim"
import { DebugLogger, setDebugLogEnabled } from "@tumble-code/core/cli"

import { DEFAULT_FLAGS, type SupportedProvider } from "@/types/index.js"
import { toProviderSettings } from "@/lib/utils/provider-config.js"
import { loadFakeAiProviderSettings } from "@/lib/utils/fake-ai-module.js"
import { getPermissionMode, getPermissionSettings } from "@/lib/utils/permissions.js"
import { getCliPackageRoot } from "@/lib/utils/cli-root.js"
import { lastMcpErrorLine, mcpServersFromMessage, takeNewMcpFailures } from "@/lib/utils/mcp-status.js"
import { createEphemeralStorageDir, getDefaultMcpSettingsPath } from "@/lib/storage/index.js"

import type { WaitingForInputEvent } from "./events.js"
import type { MessageDelivery } from "./transcript-deliveries.js"
import { ExtensionClient } from "./extension-client.js"
import { OutputManager } from "./output-manager.js"
import { TranscriptPrinter } from "./transcript-printer.js"
import { PromptManager } from "./prompt-manager.js"
import { AskDispatcher } from "./ask-dispatcher.js"

// Pre-configured logger for CLI message activity debugging.
const cliLogger = new DebugLogger("CLI")

// The CLI package root (for finding node_modules/@vscode/ripgrep); see
// getCliPackageRoot. `tumble doctor` resolves it the same way.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CLI_PACKAGE_ROOT = getCliPackageRoot(__dirname)

export interface ExtensionHostOptions {
	mode: string
	reasoningEffort?: ReasoningEffortExtended | "unspecified" | "disabled"
	consecutiveMistakeLimit?: number
	/** Seconds a shell command may run before the extension stops it; 0 means no limit. */
	commandExecutionTimeout?: number
	provider: SupportedProvider
	apiKey?: string
	model: string
	/** Base URL override for the selected provider (applied to its base-url settings field). */
	baseUrl?: string
	/** Context window of the model from `models` in cli-settings.json (used by the openai provider). */
	contextWindow?: number
	/**
	 * Provider settings per mode from cli-settings.json. Sent to the extension
	 * at startup so a mode switch applies them instead of the provider profile
	 * the extension's own store binds to that mode.
	 */
	modeProviderSettings?: CliModeProviderSettings
	workspacePath: string
	extensionPath: string
	/**
	 * File with the global MCP servers. Defaults to ~/.roo/mcp.json, so it
	 * never lives in the shim's storage (hidden, and temporary under
	 * --ephemeral).
	 */
	mcpSettingsPath?: string
	nonInteractive?: boolean
	/**
	 * When true, uses a temporary storage directory that is cleaned up on exit.
	 */
	ephemeral: boolean
	debug: boolean
	exitOnComplete: boolean
	terminalShell?: string
	/**
	 * When true, exit the process on API request errors instead of retrying.
	 */
	exitOnError?: boolean
	/**
	 * When true, an api_req_failed ask fails the run (runTask rejects, so the
	 * CLI exits with code 1) instead of waiting for an answer nobody gives.
	 * Set for unattended print and JSON runs; the TUI answers the ask itself.
	 */
	exitOnApiRequestFailed?: boolean
	/**
	 * When true, completely disables all direct stdout/stderr output.
	 * Use this when running in TUI mode where Ink controls the terminal.
	 */
	disableOutput?: boolean
	/**
	 * When true, don't suppress node warnings and console output since we're
	 * running in an integration test and we want to see the output.
	 */
	integrationTest?: boolean
}

interface ExtensionModule {
	activate: (context: unknown) => Promise<unknown>
	deactivate?: () => Promise<void>
}

interface WebviewViewProvider {
	resolveWebviewView?(webviewView: unknown, context: unknown, token: unknown): void | Promise<void>
}

export interface ExtensionHostInterface extends IExtensionHost<ExtensionHostEventMap> {
	client: ExtensionClient
	activate(): Promise<void>
	runTask(prompt: string, taskId?: string): Promise<void>
	resumeTask(taskId: string): Promise<void>
	sendToExtension(message: WebviewMessage): void
	dispose(): Promise<void>
}

export class ExtensionHost extends EventEmitter implements ExtensionHostInterface {
	// Extension lifecycle.
	private vscode: ReturnType<typeof createVSCodeAPI> | null = null
	private extensionModule: ExtensionModule | null = null
	private extensionAPI: unknown = null
	private options: ExtensionHostOptions
	private isReady = false
	private messageListener: ((message: ExtensionMessage) => void) | null = null
	private initialSettings: TumbleCodeSettings

	// Console suppression.
	private originalConsole: {
		log: typeof console.log
		warn: typeof console.warn
		error: typeof console.error
		debug: typeof console.debug
		info: typeof console.info
	} | null = null

	private originalProcessEmitWarning: typeof process.emitWarning | null = null

	// Ephemeral storage.
	private ephemeralStorageDir: string | null = null

	// Environment variables this host sets for the extension, with the values
	// they had before, restored on dispose.
	private previousEnv = new Map<string, string | undefined>()

	// MCP server failures already printed (see takeNewMcpFailures).
	private reportedMcpFailures = new Set<string>()

	// ==========================================================================
	// Managers - These do all the heavy lifting
	// ==========================================================================

	/**
	 * ExtensionClient: Single source of truth for agent loop state.
	 * Handles message processing and state detection.
	 */
	public readonly client: ExtensionClient

	/**
	 * OutputManager: writes print mode's lines (disabled for the TUI and JSON).
	 */
	private outputManager: OutputManager

	/**
	 * Print mode's transcript: the reducer's rows written to the terminal.
	 * Undefined when output is disabled (the TUI attaches its own sink).
	 */
	private printer: TranscriptPrinter | undefined

	// Streaming messages whose first partial was logged (debug log only).
	private loggedFirstPartial = new Set<number>()

	/**
	 * PromptManager: Handles all user input collection.
	 * Provides readline, yes/no, and timed prompts.
	 */
	private promptManager: PromptManager

	/**
	 * AskDispatcher: Routes asks to appropriate handlers.
	 * Uses type guards (isIdleAsk, isInteractiveAsk, etc.) from client module.
	 */
	private askDispatcher: AskDispatcher

	// ==========================================================================
	// Constructor
	// ==========================================================================

	constructor(options: ExtensionHostOptions) {
		super()

		this.options = options
		// Mark this process as CLI runtime so extension code can apply
		// CLI-specific behavior without affecting VS Code desktop usage.
		this.setProcessEnv(CLI_RUNTIME_ENV.runtime, "1")
		// Global MCP servers come from the CLI's own file; the core reads the
		// variable in src/services/mcp/mcpSettingsPath.ts, before activation
		// is over, which is why it cannot wait for a webview message.
		this.setProcessEnv(CLI_RUNTIME_ENV.mcpSettingsPath, options.mcpSettingsPath ?? getDefaultMcpSettingsPath())

		// Enable file-based debug logging only when --debug is passed.
		if (options.debug) {
			setDebugLogEnabled(true)
		}

		// Set up quiet mode early, before any extension code runs.
		// This suppresses console output from the extension during load.
		this.setupQuietMode()

		// Initialize client - single source of truth for agent state (including mode).
		this.client = new ExtensionClient({
			sendMessage: (msg) => this.sendToExtension(msg),
			debug: options.debug, // Enable debug logging in the client.
		})

		// Initialize output manager.
		this.outputManager = new OutputManager({ disabled: options.disableOutput })

		// Print mode reads the transcript the way the TUI does: the reducer
		// decides the rows, the printer writes them (D11).
		if (!options.disableOutput) {
			this.printer = new TranscriptPrinter(this.outputManager, () => this.options.nonInteractive ?? false)
			this.client.transcript.attach(this.printer)
		}

		// Initialize prompt manager with console mode callbacks.
		this.promptManager = new PromptManager({
			onBeforePrompt: () => this.restoreConsole(),
			onAfterPrompt: () => this.setupQuietMode(),
		})

		// Initialize ask dispatcher.
		this.askDispatcher = new AskDispatcher({
			outputManager: this.outputManager,
			promptManager: this.promptManager,
			sendMessage: (msg) => this.sendToExtension(msg),
			nonInteractive: options.nonInteractive,
			exitOnError: options.exitOnError,
			disabled: options.disableOutput, // TUI mode handles asks directly.
		})

		// Wire up client events.
		this.setupClientEventHandlers()

		// Feed the transcript reader every message the extension posts, from
		// now on. The client's own listener is added only after the extension
		// has activated (see activate), and the extension can post while it
		// activates; the transcript has to see those messages, as the TUI did
		// when it listened here before activate. The reader does nothing until
		// a consumer attaches to it.
		this.on("extensionWebviewMessage", (message: ExtensionMessage) => this.client.transcript.handleMessage(message))

		// Populate initial settings.
		const baseSettings: TumbleCodeSettings = {
			mode: this.options.mode,
			consecutiveMistakeLimit: this.options.consecutiveMistakeLimit ?? DEFAULT_FLAGS.consecutiveMistakeLimit,
			commandExecutionTimeout: this.options.commandExecutionTimeout ?? DEFAULT_FLAGS.commandExecutionTimeout,
			enableCheckpoints: false,
			experiments: {
				customTools: true,
			},
			...toProviderSettings(this.options),
		}

		this.initialSettings = {
			...getPermissionSettings(getPermissionMode(this.options.nonInteractive ?? false)),
			...baseSettings,
		}

		if (this.options.terminalShell) {
			this.initialSettings.terminalShellIntegrationDisabled = true
			this.initialSettings.execaShellPath = this.options.terminalShell
		}
	}

	// ==========================================================================
	// Client Event Handlers
	// ==========================================================================

	/**
	 * Wire up client events to managers.
	 * The client emits events, managers handle them.
	 */
	private setupClientEventHandlers(): void {
		// Print mode's output comes from the transcript reader (see the
		// constructor); the client's deliveries only feed the debug log here.
		this.client.on("delivery", ({ message, update }) => this.logMessageDebug(message, update ? "updated" : "new"))

		// Handle waiting for input - delegate to AskDispatcher.
		this.client.on("waitingForInput", (event: WaitingForInputEvent) => {
			this.askDispatcher.handleAsk(event.message)
		})
	}

	// ==========================================================================
	// Logging + Console Suppression
	// ==========================================================================

	private setupQuietMode(): void {
		// Skip if already set up or if integrationTest mode
		if (this.originalConsole || this.options.integrationTest) {
			return
		}

		// Suppress node warnings.
		this.originalProcessEmitWarning = process.emitWarning
		process.emitWarning = () => {}
		process.on("warning", () => {})

		// Suppress console output.
		this.originalConsole = {
			log: console.log,
			warn: console.warn,
			error: console.error,
			debug: console.debug,
			info: console.info,
		}

		console.log = () => {}
		console.warn = () => {}
		console.debug = () => {}
		console.info = () => {}
		// Route console.error to the file-based debug log instead of the
		// terminal. Extension code logs raw stacks via console.error (e.g.
		// provider API errors in handleProviderError); in the TUI ink's
		// patchConsole prints those straight into the transcript. The
		// user-facing surfacing already happens through the task loop's
		// ask/error UI — the dump is diagnostics, so it belongs in
		// ~/.roo/cli-debug.log (written when --debug is passed).
		console.error = (...args: unknown[]) => {
			cliLogger.error(
				"console.error",
				args.map((arg) => (arg instanceof Error ? (arg.stack ?? String(arg)) : arg)),
			)
		}
	}

	private restoreConsole(): void {
		if (!this.originalConsole) {
			return
		}

		console.log = this.originalConsole.log
		console.warn = this.originalConsole.warn
		console.error = this.originalConsole.error
		console.debug = this.originalConsole.debug
		console.info = this.originalConsole.info
		this.originalConsole = null

		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}
	}

	private logMessageDebug(msg: ClineMessage, type: "new" | "updated"): void {
		if (msg.partial) {
			if (!this.loggedFirstPartial.has(msg.ts)) {
				this.loggedFirstPartial.add(msg.ts)
				cliLogger.debug("message:start", { ts: msg.ts, type: msg.say || msg.ask })
			}
		} else {
			cliLogger.debug(`message:${type === "new" ? "new" : "complete"}`, { ts: msg.ts, type: msg.say || msg.ask })
			this.loggedFirstPartial.delete(msg.ts)
		}
	}

	// ==========================================================================
	// Extension Lifecycle
	// ==========================================================================

	public async activate(): Promise<void> {
		const bundlePath = path.join(this.options.extensionPath, "extension.js")

		if (!fs.existsSync(bundlePath)) {
			this.restoreConsole()
			throw new Error(`Extension bundle not found at: ${bundlePath}`)
		}

		// The integration suite's scripted model (see fake-ai-module.ts). It
		// must be in the settings before the extension loads, because
		// markWebviewReady sends them during activation. The per-mode settings
		// are replaced too: a resumed task (after a cancel or --session-id)
		// and a mode switch take their provider from those, not from the
		// startup settings.
		const fakeAiSettings = await loadFakeAiProviderSettings()

		if (fakeAiSettings) {
			this.initialSettings = { ...this.initialSettings, ...fakeAiSettings }
			this.options.modeProviderSettings = { base: fakeAiSettings, modes: {} }
		}

		let storageDir: string | undefined

		if (this.options.ephemeral) {
			this.ephemeralStorageDir = await createEphemeralStorageDir()
			storageDir = this.ephemeralStorageDir
		}

		// Create VSCode API mock.
		this.vscode = createVSCodeAPI(this.options.extensionPath, this.options.workspacePath, undefined, {
			appRoot: CLI_PACKAGE_ROOT,
			storageDir,
		})
		setCliRuntimeGlobals({ vscode: this.vscode, extensionHost: this })

		// Set up module resolution.
		const require = createRequire(import.meta.url)
		const Module = require("module")
		const originalResolve = Module._resolveFilename

		Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
			if (request === "vscode") return "vscode-mock"
			return originalResolve.call(this, request, parent, isMain, options)
		}

		require.cache["vscode-mock"] = {
			id: "vscode-mock",
			filename: "vscode-mock",
			loaded: true,
			exports: this.vscode,
			children: [],
			paths: [],
			path: "",
			isPreloading: false,
			parent: null,
			require: require,
		} as unknown as NodeJS.Module

		try {
			this.extensionModule = require(bundlePath) as ExtensionModule
		} catch (error) {
			Module._resolveFilename = originalResolve

			throw new Error(
				`Failed to load extension bundle: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		Module._resolveFilename = originalResolve

		try {
			this.extensionAPI = await this.extensionModule.activate(this.vscode.context)
		} catch (error) {
			throw new Error(`Failed to activate extension: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Set up message listener - forward all messages to client.
		this.messageListener = (message: ExtensionMessage) => {
			this.reportMcpFailures(message)
			this.client.handleMessage(message)
		}
		this.on("extensionWebviewMessage", this.messageListener)

		await pWaitFor(() => this.isReady, { interval: 100, timeout: 10_000 })
	}

	/**
	 * Print mode: tell the user on stderr when an MCP server fails to start,
	 * which they otherwise never learn. The output manager is disabled in the
	 * TUI (which shows its own notice) and for JSON output.
	 */
	private reportMcpFailures(message: ExtensionMessage): void {
		const servers = mcpServersFromMessage(message)

		if (!servers) {
			return
		}

		for (const server of takeNewMcpFailures(servers, this.reportedMcpFailures)) {
			this.outputManager.outputError(
				"[mcp]",
				`server "${server.name}" (${server.source ?? "global"}) failed to start: ${lastMcpErrorLine(server)}`,
			)
		}
	}

	public registerWebviewProvider(_viewId: string, _provider: WebviewViewProvider): void {}

	public unregisterWebviewProvider(_viewId: string): void {}

	public markWebviewReady(): void {
		this.isReady = true

		// Apply CLI settings to the runtime config and context proxy BEFORE
		// sending webviewDidLaunch. This prevents a race condition where the
		// webviewDidLaunch handler's first-time init sync reads default state
		// (apiProvider: "anthropic") instead of the CLI-provided settings.
		setRuntimeConfigValues("tumble-code", this.initialSettings as Record<string, unknown>)
		this.sendToExtension({ type: "updateSettings", updatedSettings: this.initialSettings })

		if (this.options.modeProviderSettings) {
			this.sendToExtension({
				type: "cliModeProviderSettings",
				cliModeProviderSettings: this.options.modeProviderSettings,
			})
		}

		// Now trigger extension initialization. The context proxy should already
		// have CLI-provided values when the webviewDidLaunch handler runs.
		this.sendToExtension({ type: "webviewDidLaunch" })
	}

	public isInInitialSetup(): boolean {
		return !this.isReady
	}

	// ==========================================================================
	// Message Handling
	// ==========================================================================

	public sendToExtension(message: WebviewMessage): void {
		if (!this.isReady) {
			throw new Error("You cannot send messages to the extension before it is ready")
		}

		this.emit("webviewMessage", message)
	}

	// ==========================================================================
	// Task Management
	// ==========================================================================

	private waitForTaskCompletion(): Promise<void> {
		return new Promise((resolve, reject) => {
			const completeHandler = () => {
				cleanup()
				resolve()
			}

			const errorHandler = (error: Error) => {
				cleanup()
				reject(error)
			}

			const cleanup = () => {
				this.client.off("taskCompleted", completeHandler)
				this.client.off("error", errorHandler)

				if (deliveryHandler) {
					this.client.off("delivery", deliveryHandler)
				}

				if (waitingHandler) {
					this.client.off("waitingForInput", waitingHandler)
				}
			}

			// When exitOnError is enabled, listen for api_req_retry_delayed messages
			// (sent by Task.ts during auto-approval retry backoff) and exit
			// immediately. Every new one counts, not only the last message of a
			// push, but not an old one in a resumed task's history.
			let deliveryHandler: ((delivery: MessageDelivery) => void) | null = null

			if (this.options.exitOnError) {
				deliveryHandler = ({ message: msg, history }: MessageDelivery) => {
					if (!history && msg.type === "say" && msg.say === "api_req_retry_delayed") {
						cleanup()
						reject(new Error(msg.text?.split("\n")[0] || "API request failed"))
					}
				}

				this.client.on("delivery", deliveryHandler)
			}

			// An api_req_failed ask in an unattended run (or with --exit-on-error)
			// has nobody to answer it. With auto-approval on the core asks it only
			// for errors a retry cannot fix (401, 403, 404), so fail the run.
			let waitingHandler: ((event: WaitingForInputEvent) => void) | null = null

			if (this.options.exitOnApiRequestFailed || this.options.exitOnError) {
				waitingHandler = (event: WaitingForInputEvent) => {
					if (event.ask === "api_req_failed") {
						cleanup()
						reject(new Error(`API request failed: ${event.message.text || "unknown error"}`))
					}
				}

				this.client.on("waitingForInput", waitingHandler)
			}

			this.client.once("taskCompleted", completeHandler)
			this.client.once("error", errorHandler)
		})
	}

	public async runTask(prompt: string, taskId?: string): Promise<void> {
		this.sendToExtension({ type: "newTask", text: prompt, taskId })
		return this.waitForTaskCompletion()
	}

	public async resumeTask(taskId: string): Promise<void> {
		// Print mode and the JSON output show what the task does from here on,
		// not its history.
		this.printer?.beginHistoryReplay()
		this.client.beginHistoryReplay()
		this.sendToExtension({ type: "showTaskWithId", text: taskId })
		return this.waitForTaskCompletion()
	}

	// ==========================================================================
	// Cleanup
	// ==========================================================================

	async dispose(): Promise<void> {
		// Clear managers.
		this.askDispatcher.clear()

		// Remove message listener.
		if (this.messageListener) {
			this.off("extensionWebviewMessage", this.messageListener)
			this.messageListener = null
		}

		// Reset client.
		this.client.reset()

		// Deactivate extension.
		if (this.extensionModule?.deactivate) {
			try {
				await this.extensionModule.deactivate()
			} catch {
				// NO-OP
			}
		}

		// Clear references.
		this.vscode = null
		this.extensionModule = null
		this.extensionAPI = null

		// Clear globals.
		clearCliRuntimeGlobals()

		// Restore console.
		this.restoreConsole()

		// Clean up ephemeral storage.
		if (this.ephemeralStorageDir) {
			try {
				await fs.promises.rm(this.ephemeralStorageDir, { recursive: true, force: true })
				this.ephemeralStorageDir = null
			} catch {
				// NO-OP
			}
		}

		// Restore the environment for process hygiene in tests.
		for (const [name, value] of this.previousEnv) {
			if (value === undefined) {
				delete process.env[name]
			} else {
				process.env[name] = value
			}
		}

		this.previousEnv.clear()
	}

	private setProcessEnv(name: string, value: string): void {
		if (!this.previousEnv.has(name)) {
			this.previousEnv.set(name, process.env[name])
		}

		process.env[name] = value
	}
}
