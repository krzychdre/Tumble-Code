import { CLI_RUNTIME_ENV } from "@tumble-code/types"

import { openExternal } from "@/lib/utils/open-external.js"

import { activateHeadlessExtension } from "./headless-extension.js"

export interface OpenAiCodexCredentials {
	type: "openai-codex"
	access_token: string
	refresh_token: string
	expires: number
	email?: string
	accountId?: string
}

export interface OpenAiCodexOAuthManager {
	startAuthorizationFlow(): string
	waitForCallback(): Promise<OpenAiCodexCredentials>
	cancelAuthorizationFlow(): void
	clearCredentials(): Promise<void>
	isAuthenticated(): Promise<boolean>
	getEmail(): Promise<string | null>
}

interface OpenAiCodexExtensionApi {
	getOpenAiCodexOAuthManager(): OpenAiCodexOAuthManager
}

export interface OpenAiCodexAuthDependencies {
	createManager?: () => Promise<OpenAiCodexOAuthManager>
	openExternal?: (url: string) => Promise<boolean>
	quiet?: boolean
}

export type OpenAiCodexLoginResult = { success: true; email?: string } | { success: false; error: string }
export type OpenAiCodexLogoutResult = { success: true } | { success: false; error: string }
export type OpenAiCodexStatusResult = { authenticated: true; email?: string } | { authenticated: false; error?: string }

let extensionRuntime: {
	manager: OpenAiCodexOAuthManager
} | null = null

async function withManager<T>(
	dependencies: OpenAiCodexAuthDependencies,
	callback: (manager: OpenAiCodexOAuthManager) => Promise<T>,
): Promise<T> {
	if (dependencies.createManager) {
		const manager = await dependencies.createManager()
		try {
			return await callback(manager)
		} finally {
			manager.cancelAuthorizationFlow()
		}
	}
	if (extensionRuntime) {
		try {
			return await callback(extensionRuntime.manager)
		} finally {
			extensionRuntime.manager.cancelAuthorizationFlow()
		}
	}

	// Kept for the life of the process (see extensionRuntime), so never disposed.
	const { api: activated } = await activateHeadlessExtension({
		authOnlyEnv: CLI_RUNTIME_ENV.codexAuthOnly,
		openExternal,
	})
	const api = activated as OpenAiCodexExtensionApi | undefined
	if (!api || typeof api.getOpenAiCodexOAuthManager !== "function") {
		throw new Error(
			"The installed extension does not expose CLI OpenAI Codex authentication; rebuild or upgrade it.",
		)
	}
	const manager = api.getOpenAiCodexOAuthManager()
	if (!manager) {
		throw new Error("Failed to initialize OpenAI Codex authentication")
	}
	extensionRuntime = { manager }

	try {
		return await callback(manager)
	} finally {
		manager.cancelAuthorizationFlow()
	}
}

export async function loginToOpenAiCodex(
	dependencies: OpenAiCodexAuthDependencies = {},
): Promise<OpenAiCodexLoginResult> {
	try {
		return await withManager(dependencies, async (manager) => {
			const authUrl = manager.startAuthorizationFlow()
			console.log("Opening browser for ChatGPT authentication...")
			console.log(`If the browser doesn't open, visit: ${authUrl}`)

			const opened = await (dependencies.openExternal ?? openExternal)(authUrl)
			if (!opened) {
				console.log("Please open the URL above in your browser manually.")
			}

			const credentials = await manager.waitForCallback()
			console.log(`✓ Signed in to OpenAI Codex${credentials.email ? ` as ${credentials.email}` : ""}.`)
			console.log("Run: tumble --provider openai-codex --model gpt-5.6-sol")
			return { success: true, email: credentials.email }
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`✗ OpenAI Codex authentication failed: ${message}`)
		return { success: false, error: message }
	}
}

export async function logoutFromOpenAiCodex(
	dependencies: OpenAiCodexAuthDependencies = {},
): Promise<OpenAiCodexLogoutResult> {
	try {
		await withManager(dependencies, async (manager) => manager.clearCredentials())
		console.log("✓ Signed out from OpenAI Codex.")
		return { success: true }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`✗ OpenAI Codex sign-out failed: ${message}`)
		return { success: false, error: message }
	}
}

export async function getOpenAiCodexAuthStatus(
	dependencies: OpenAiCodexAuthDependencies = {},
): Promise<OpenAiCodexStatusResult> {
	try {
		return await withManager(dependencies, async (manager) => {
			const authenticated = await manager.isAuthenticated()
			if (!authenticated) {
				if (!dependencies.quiet) {
					console.log("Not signed in to OpenAI Codex. Run: tumble auth codex login")
				}
				return { authenticated: false }
			}

			const email = await manager.getEmail()
			if (!dependencies.quiet) {
				console.log(`Signed in to OpenAI Codex${email ? ` as ${email}` : ""}.`)
			}
			return { authenticated: true, email: email ?? undefined }
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (!dependencies.quiet) {
			console.error(`Unable to read OpenAI Codex authentication status: ${message}`)
		}
		return { authenticated: false, error: message }
	}
}
