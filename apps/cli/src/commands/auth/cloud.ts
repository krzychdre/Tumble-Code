/**
 * `tumble auth cloud login|logout|status`: the Tumble Code Cloud sign-in.
 *
 * The extension runs headless in its cloud-auth-only mode (it starts only the
 * cloud service) on the shim's default storage, which a normal `tumble` run
 * shares, so a sign-in here applies to the next session. The browser comes back
 * to a one-shot listener on 127.0.0.1 (lib/auth/loopback-callback.ts); from a
 * remote shell the user pastes the address the browser ends on instead.
 */

import { CLI_RUNTIME_ENV, type CliCloudAuthApi, type CliCloudAuthStatus } from "@tumble-code/types"

import type { CliSettings } from "@/types/index.js"
import { loadSettings as loadCliSettings } from "@/lib/storage/settings.js"
import { resolveCloudApiUrl, restoreCloudPort } from "@/lib/auth/cloud-api-url.js"
import {
	CLOUD_CALLBACK_PATH,
	LOOPBACK_TIMEOUT_MS,
	startLoopbackListener,
	waitForPastedCallback,
	type CloudCallback,
	type ReceivedCallback,
} from "@/lib/auth/loopback-callback.js"
import { openExternal as openInBrowser } from "@/lib/utils/open-external.js"

import { activateHeadlessExtension } from "./headless-extension.js"

/** How long login and status wait for the cloud to confirm the session. */
const SESSION_SETTLE_TIMEOUT_MS = 15_000

export interface CloudAuthDependencies {
	loadSettings?: () => Promise<CliSettings>
	env?: NodeJS.ProcessEnv
	/** Activates the extension's cloud-auth-only mode; its `openExternal` receives the sign-in URL. */
	createCloudAuth?: (options: {
		cloudApiUrl?: string
		openExternal: (url: string) => Promise<boolean>
	}) => Promise<CliCloudAuthApi>
	/** Opens the sign-in URL in a browser (default: the platform opener). */
	openExternal?: (url: string) => Promise<boolean>
	startListener?: typeof startLoopbackListener
	/** Where a pasted callback URL is read from (default: stdin, only when it is a terminal). */
	input?: NodeJS.ReadableStream & { isTTY?: boolean }
	/** Cancels the sign-in (default: Ctrl+C). */
	signal?: AbortSignal
	loginTimeoutMs?: number
	sessionTimeoutMs?: number
	write?: (text: string) => void
	writeError?: (text: string) => void
}

export type CloudLoginResult = { success: true; email?: string } | { success: false; error: string }
export type CloudLogoutResult = { success: true } | { success: false; error: string }
export type CloudStatusResult =
	| { authenticated: true; email?: string; cloudApiUrl: string }
	| { authenticated: false; cloudApiUrl?: string; error?: string }

async function defaultCreateCloudAuth({
	cloudApiUrl,
	openExternal,
}: {
	cloudApiUrl?: string
	openExternal: (url: string) => Promise<boolean>
}): Promise<CliCloudAuthApi> {
	const extension = await activateHeadlessExtension({
		authOnlyEnv: CLI_RUNTIME_ENV.cloudAuthOnly,
		openExternal,
		cloudApiUrl,
	})
	const api = extension.api as { getCloudAuth?: () => CliCloudAuthApi } | undefined

	if (!api || typeof api.getCloudAuth !== "function") {
		extension.dispose()
		throw new Error("The installed extension does not support CLI cloud sign-in; rebuild or upgrade it.")
	}

	const cloudAuth = api.getCloudAuth()

	return {
		...cloudAuth,
		dispose: () => {
			try {
				cloudAuth.dispose()
			} finally {
				extension.dispose()
			}
		},
	}
}

/**
 * The extension and the cloud package log chatter through the console (module
 * loading, auth state changes); the command's own lines go to stdout/stderr
 * directly. Set DEBUG to see the chatter.
 */
function muteConsole(): () => void {
	if (process.env.DEBUG) {
		return () => {}
	}

	const saved = {
		log: console.log,
		info: console.info,
		warn: console.warn,
		debug: console.debug,
		error: console.error,
	}
	console.log = console.info = console.warn = console.debug = console.error = () => {}

	return () => Object.assign(console, saved)
}

interface Session {
	api: CliCloudAuthApi
	cloudApiUrl: string
	/** Set by the extension's openExternal during `api.login`. */
	signInUrl?: string
}

/** Resolves the cloud URL, starts the headless extension, runs `body`, and always cleans up. */
async function withCloudAuth<T>(
	dependencies: CloudAuthDependencies,
	onUnconfigured: (message: string) => T,
	body: (session: Session, out: { write: (text: string) => void; writeError: (text: string) => void }) => Promise<T>,
): Promise<T> {
	const write = dependencies.write ?? ((text: string) => void process.stdout.write(text))
	const writeError = dependencies.writeError ?? ((text: string) => void process.stderr.write(text))
	const resolution = resolveCloudApiUrl(
		await (dependencies.loadSettings ?? loadCliSettings)(),
		dependencies.env ?? process.env,
	)

	if (!resolution.ok) {
		writeError(`${resolution.message}\n`)
		return onUnconfigured(resolution.message)
	}

	const restoreConsole = muteConsole()
	let api: CliCloudAuthApi | undefined

	try {
		const session: Partial<Session> = { cloudApiUrl: resolution.url }
		const opener = dependencies.openExternal ?? openInBrowser

		api = await (dependencies.createCloudAuth ?? defaultCreateCloudAuth)({
			// Only the settings value is handed over; the environment variable is
			// read by the extension itself.
			cloudApiUrl: resolution.source === "settings" ? resolution.url : undefined,
			openExternal: async (openedUrl) => {
				const url = restoreCloudPort(openedUrl, resolution.url)
				session.signInUrl = url
				write(`Opening your browser to sign in. If it does not open, visit:\n  ${url}\n`)
				const opened = await opener(url)

				if (!opened) {
					write("Could not open a browser; open the address above yourself.\n")
				}

				return true
			},
		})
		session.api = api

		return await body(session as Session, { write, writeError })
	} finally {
		try {
			api?.dispose()
		} finally {
			restoreConsole()
		}
	}
}

const describeAccount = (status: CliCloudAuthStatus) => (status.userEmail ? ` as ${status.userEmail}` : "")

export async function loginToCloud(dependencies: CloudAuthDependencies = {}): Promise<CloudLoginResult> {
	const controller = new AbortController()
	const onSigint = () => controller.abort()
	const signal = dependencies.signal ?? controller.signal

	if (!dependencies.signal) {
		process.once("SIGINT", onSigint)
	}

	try {
		return await withCloudAuth<CloudLoginResult>(
			dependencies,
			(error) => ({ success: false, error }),
			async (session, { write, writeError }) => {
				const listener = await (dependencies.startListener ?? startLoopbackListener)({
					timeoutMs: dependencies.loginTimeoutMs ?? LOOPBACK_TIMEOUT_MS,
					signal,
				})
				const stopPasting = new AbortController()
				let received: (CloudCallback & Partial<Pick<ReceivedCallback, "reply">>) | undefined

				try {
					write(`Signing in to Tumble Code Cloud at ${session.cloudApiUrl}\n`)
					await session.api.login(listener.redirectUrl)

					const state = session.signInUrl ? new URL(session.signInUrl).searchParams.get("state") : null

					if (state) {
						listener.expectState(state)
					}

					const input = dependencies.input ?? process.stdin
					const waiting: Promise<CloudCallback & Partial<Pick<ReceivedCallback, "reply">>>[] = [
						listener.callback,
					]

					write(`Waiting for the browser (Ctrl+C cancels).\n`)

					if (input.isTTY) {
						write(
							"If the browser runs on another machine, copy the address it ends on (it contains\n" +
								`${CLOUD_CALLBACK_PATH}) from its address bar, paste it here and press Enter.\n`,
						)
						waiting.push(
							waitForPastedCallback({
								input,
								signal: AbortSignal.any([signal, stopPasting.signal]),
								onInvalidLine: () =>
									writeError(
										`That is not the sign-in address; it contains ${CLOUD_CALLBACK_PATH}?code=...&state=...\n`,
									),
							}),
						)
					}

					received = await Promise.race(waiting)
					stopPasting.abort()

					await session.api.handleAuthCallback(received.code, received.state, received.organizationId)
					const status = await session.api.waitForSettledSession(
						dependencies.sessionTimeoutMs ?? SESSION_SETTLE_TIMEOUT_MS,
					)
					received.reply?.({ ok: true })

					write(`✓ Signed in to Tumble Code Cloud${describeAccount(status)}.\n`)

					if (status.state !== "active-session") {
						write(
							`The cloud did not confirm the session yet (state: ${status.state}); ` +
								"the next run retries. Check it with: tumble auth cloud status\n",
						)
					}

					return { success: true, email: status.userEmail }
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					received?.reply?.({ ok: false, error: message })
					throw error
				} finally {
					stopPasting.abort()
					listener.close()
				}
			},
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		;(dependencies.writeError ?? ((text: string) => void process.stderr.write(text)))(
			`✗ Tumble Code Cloud sign-in failed: ${message}\n`,
		)
		return { success: false, error: message }
	} finally {
		process.off("SIGINT", onSigint)
	}
}

export async function logoutFromCloud(dependencies: CloudAuthDependencies = {}): Promise<CloudLogoutResult> {
	try {
		return await withCloudAuth<CloudLogoutResult>(
			dependencies,
			(error) => ({ success: false, error }),
			async (session, { write }) => {
				await session.api.logout()
				write(`✓ Signed out from Tumble Code Cloud (${session.cloudApiUrl}).\n`)
				return { success: true }
			},
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		;(dependencies.writeError ?? ((text: string) => void process.stderr.write(text)))(
			`✗ Tumble Code Cloud sign-out failed: ${message}\n`,
		)
		return { success: false, error: message }
	}
}

export async function getCloudAuthStatus(dependencies: CloudAuthDependencies = {}): Promise<CloudStatusResult> {
	try {
		return await withCloudAuth<CloudStatusResult>(
			dependencies,
			(error) => ({ authenticated: false, error }),
			async (session, { write }) => {
				const status = await session.api.waitForSettledSession(
					dependencies.sessionTimeoutMs ?? SESSION_SETTLE_TIMEOUT_MS,
				)

				if (!status.authenticated) {
					write(`Not signed in to Tumble Code Cloud (${status.cloudApiUrl}). Run: tumble auth cloud login\n`)
					return { authenticated: false, cloudApiUrl: status.cloudApiUrl }
				}

				write(`Signed in to Tumble Code Cloud${describeAccount(status)} (${status.cloudApiUrl}).\n`)

				if (status.state !== "active-session") {
					write(`The cloud did not confirm the session (state: ${status.state}); is it reachable?\n`)
				}

				return { authenticated: true, email: status.userEmail, cloudApiUrl: status.cloudApiUrl }
			},
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		;(dependencies.writeError ?? ((text: string) => void process.stderr.write(text)))(
			`Unable to read the Tumble Code Cloud sign-in status: ${message}\n`,
		)
		return { authenticated: false, error: message }
	}
}
