/**
 * CLI runtime contract.
 *
 * The CLI (apps/cli) does not talk to the extension over a network or an IPC
 * channel. It loads the built extension bundle (src/dist/extension.js) into its
 * own Node process, hands it a fake `vscode` module (packages/vscode-shim) and
 * then calls `activate()`. The two sides agree on a small set of process-wide
 * names, and this module is the one place that spells them:
 *
 * 1. Environment variables (`CLI_RUNTIME_ENV`), read with `readCliRuntimeEnv`:
 *    - `ROO_CLI_RUNTIME`: set to "1" by the CLI `ExtensionHost` constructor.
 *      The extension uses it to switch on CLI-only behavior (no sticky profile
 *      restore from history, no agent-chosen command timeout).
 *    - `ROO_CLI_CODEX_AUTH_ONLY`: set to "1" by `roo auth openai-codex` around a
 *      headless `activate()`; the extension then only initializes the OpenAI
 *      Codex OAuth manager and returns early.
 *    - `ROO_MCP_SETTINGS_PATH`: set by the CLI `ExtensionHost` to the global MCP
 *      servers file (default `~/.roo/mcp.json`), read by the extension instead
 *      of `<globalStorage>/settings/mcp_settings.json`.
 *    - `ROO_CLI_ROOT`, `ROO_EXTENSION_PATH`, `ROO_RIPGREP_PATH`: set by the
 *      release launcher that apps/cli/scripts/build.sh writes; they point at
 *      the unpacked CLI, its extension bundle and its ripgrep binary.
 *
 * 2. `globalThis` slots (`CLI_RUNTIME_GLOBAL_SLOTS`), written with
 *    `setCliRuntimeGlobals` and removed with `clearCliRuntimeGlobals`:
 *    - `vscode`: the shim's `vscode` API object for the running extension.
 *    - `__extensionHost`: the CLI `ExtensionHost`, which the shim's WindowAPI
 *      uses to forward webview messages (`CliExtensionHostSlot`).
 *
 * The shim (packages/vscode-shim) still reads the two slots by their literal
 * names because it does not depend on this package; the names here must stay
 * equal to what it reads. See docs/architecture.md for the wider map.
 */

/** Environment variables shared by the CLI and the extension it hosts. */
export const CLI_RUNTIME_ENV = {
	runtime: "ROO_CLI_RUNTIME",
	codexAuthOnly: "ROO_CLI_CODEX_AUTH_ONLY",
	mcpSettingsPath: "ROO_MCP_SETTINGS_PATH",
	cliRoot: "ROO_CLI_ROOT",
	extensionPath: "ROO_EXTENSION_PATH",
	ripgrepPath: "ROO_RIPGREP_PATH",
} as const

export type CliRuntimeEnvName = (typeof CLI_RUNTIME_ENV)[keyof typeof CLI_RUNTIME_ENV]

/** The parsed view of `CLI_RUNTIME_ENV`; an unset or empty variable is `undefined`. */
export interface CliRuntimeEnv {
	/** The process is the CLI (`ROO_CLI_RUNTIME === "1"`). */
	isCliRuntime: boolean
	/** Activate only the OpenAI Codex OAuth manager (`ROO_CLI_CODEX_AUTH_ONLY === "1"`). */
	codexAuthOnly: boolean
	/** Global MCP settings file override, trimmed. */
	mcpSettingsPath: string | undefined
	/** Root of the unpacked CLI release. */
	cliRoot: string | undefined
	/** Directory holding the extension bundle (`extension.js`). */
	extensionPath: string | undefined
	/** Absolute path of the ripgrep binary shipped with the CLI. */
	ripgrepPath: string | undefined
}

/**
 * Reads the contract variables from `env` (pass `process.env`; this package has
 * no Node typings, so it does not reach for `process` itself).
 */
export function readCliRuntimeEnv(env: Readonly<Record<string, string | undefined>>): CliRuntimeEnv {
	const text = (name: CliRuntimeEnvName) => env[name] || undefined

	return {
		isCliRuntime: env[CLI_RUNTIME_ENV.runtime] === "1",
		codexAuthOnly: env[CLI_RUNTIME_ENV.codexAuthOnly] === "1",
		mcpSettingsPath: env[CLI_RUNTIME_ENV.mcpSettingsPath]?.trim() || undefined,
		cliRoot: text(CLI_RUNTIME_ENV.cliRoot),
		extensionPath: text(CLI_RUNTIME_ENV.extensionPath),
		ripgrepPath: text(CLI_RUNTIME_ENV.ripgrepPath),
	}
}

/** Names of the `globalThis` slots the CLI fills before loading the extension. */
export const CLI_RUNTIME_GLOBAL_SLOTS = {
	vscode: "vscode",
	extensionHost: "__extensionHost",
} as const

/**
 * What the shim's WindowAPI calls on `globalThis.__extensionHost`. It mirrors
 * `IExtensionHost` in packages/vscode-shim with the payloads left open, so this
 * package does not depend on the shim.
 */
export interface CliExtensionHostSlot {
	registerWebviewProvider(viewId: string, provider: unknown): void
	unregisterWebviewProvider(viewId: string): void
	isInInitialSetup(): boolean
	markWebviewReady(): void
	emit(event: "extensionWebviewMessage", message: unknown): boolean
	on(event: "webviewMessage", listener: (message: unknown) => void): unknown
}

/** The `globalThis` slots, typed. */
export interface CliRuntimeGlobals {
	[CLI_RUNTIME_GLOBAL_SLOTS.vscode]?: unknown
	[CLI_RUNTIME_GLOBAL_SLOTS.extensionHost]?: CliExtensionHostSlot
}

/** Publishes the shim API and the host on `target` (default `globalThis`). */
export function setCliRuntimeGlobals(
	slots: { vscode: unknown; extensionHost: CliExtensionHostSlot },
	target: CliRuntimeGlobals = globalThis as CliRuntimeGlobals,
): void {
	target[CLI_RUNTIME_GLOBAL_SLOTS.vscode] = slots.vscode
	target[CLI_RUNTIME_GLOBAL_SLOTS.extensionHost] = slots.extensionHost
}

/** Removes both slots from `target` (default `globalThis`). */
export function clearCliRuntimeGlobals(target: CliRuntimeGlobals = globalThis as CliRuntimeGlobals): void {
	delete target[CLI_RUNTIME_GLOBAL_SLOTS.vscode]
	delete target[CLI_RUNTIME_GLOBAL_SLOTS.extensionHost]
}
