/**
 * Loads the extension bundle on the vscode shim and activates it in one of its
 * auth-only modes (`ROO_CLI_CODEX_AUTH_ONLY`, `ROO_CLI_CLOUD_AUTH_ONLY`), for
 * the `tumble auth ...` commands. The shim uses its default storage
 * (`~/.vscode-mock`), the same one a normal `tumble` run uses without
 * `--ephemeral`, so credentials stored here are found by the next session.
 */

import { createRequire } from "module"
import path from "path"

import type { CliRuntimeEnvName } from "@tumble-code/types"

import { getDefaultExtensionPath } from "@/lib/utils/extension.js"

interface HeadlessExtensionModule {
	activate(context: unknown): Promise<unknown>
}

export interface HeadlessActivationOptions {
	/** The auth-only variable set to "1" around `activate()`. */
	authOnlyEnv: CliRuntimeEnvName
	/** Called by the extension's `vscode.env.openExternal`. */
	openExternal: (url: string) => Promise<boolean>
	/** `tumble-code.cloudApiUrl` for the extension, applied before `activate()`. */
	cloudApiUrl?: string
}

export interface HeadlessExtension {
	/** What `activate()` returned. */
	api: unknown
	/** Removes the `vscode` module hook and disposes the extension context. */
	dispose(): void
}

/**
 * Activates the bundle. The `vscode` module hook stays installed until
 * `dispose()`: the extension requires "vscode" lazily after activation too (the
 * cloud package's importVscode, on sign-in), and Node's resolve cache does not
 * remember a module that was only ever served from require.cache.
 */
export async function activateHeadlessExtension({
	authOnlyEnv,
	openExternal,
	cloudApiUrl,
}: HeadlessActivationOptions): Promise<HeadlessExtension> {
	const { createVSCodeAPI, setLogger, setRuntimeConfig } = await import("@tumble-code/vscode-shim")
	setLogger({
		info: () => {},
		warn: (message) => process.env.DEBUG && console.warn(message),
		error: (message) => process.env.DEBUG && console.error(message),
		debug: (message) => process.env.DEBUG && console.debug(message),
	})

	if (cloudApiUrl) {
		setRuntimeConfig("tumble-code", "cloudApiUrl", cloudApiUrl)
	}

	const extensionPath = getDefaultExtensionPath(import.meta.dirname)
	const bundlePath = path.join(extensionPath, "extension.js")
	const vscode = createVSCodeAPI(extensionPath, process.cwd(), undefined, { openExternal })
	const require = createRequire(import.meta.url)
	const Module = require("module")
	const originalResolve = Module._resolveFilename
	const moduleId = "vscode-mock-headless-auth"

	Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
		if (request === "vscode") return moduleId
		return originalResolve.call(this, request, parent, isMain, options)
	}
	require.cache[moduleId] = {
		id: moduleId,
		filename: moduleId,
		loaded: true,
		exports: vscode,
		children: [],
		paths: [],
		path: "",
		isPreloading: false,
		parent: null,
		require,
	} as unknown as NodeJS.Module

	let disposed = false
	const dispose = () => {
		if (disposed) {
			return
		}

		disposed = true
		Module._resolveFilename = originalResolve
		delete require.cache[moduleId]
		vscode.context.dispose()
	}

	const previousAuthOnly = process.env[authOnlyEnv]
	process.env[authOnlyEnv] = "1"
	const originalConsoleLog = console.log
	console.log = (...args: unknown[]) => {
		if (!String(args[0] ?? "").startsWith("Loaded translations for languages:")) {
			originalConsoleLog(...args)
		}
	}

	try {
		const extension = require(bundlePath) as HeadlessExtensionModule
		return { api: await extension.activate(vscode.context), dispose }
	} catch (error) {
		dispose()
		throw error
	} finally {
		console.log = originalConsoleLog
		if (previousAuthOnly === undefined) delete process.env[authOnlyEnv]
		else process.env[authOnlyEnv] = previousAuthOnly
	}
}
