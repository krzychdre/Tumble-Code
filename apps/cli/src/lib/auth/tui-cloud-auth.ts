/**
 * `/login` and `/logout` in the interactive CLI.
 *
 * The running extension does the sign-in (`rooCloudSignIn`, then
 * `rooCloudManualUrl` with the callback URL); the CLI adds what a terminal
 * needs: the loopback listener the browser comes back to
 * (loopback-callback.ts), and results in the transcript, because the CLI mutes
 * the extension's notifications. The extension reports each step with a
 * `cloudAuthResult` message. From a remote shell the user types
 * `/login <address the browser ended on>` instead.
 */

import type { ExtensionMessage, WebviewMessage } from "@tumble-code/types"

import type { CliSettings } from "@/types/index.js"
import { loadSettings as loadCliSettings } from "@/lib/storage/settings.js"

import { resolveCloudApiUrl } from "./cloud-api-url.js"
import {
	CLOUD_CALLBACK_PATH,
	LOOPBACK_TIMEOUT_MS,
	parseCloudCallbackUrl,
	startLoopbackListener,
	type CallbackOutcome,
} from "./loopback-callback.js"

/** How long the CLI waits for the extension to answer a step. */
const RESULT_TIMEOUT_MS = 30_000

/** The running extension, as the sign-in sees it. */
export interface CloudAuthChannel {
	send(message: WebviewMessage): void
	/** Subscribes to the extension's messages; returns the unsubscribe function. */
	onMessage(listener: (message: ExtensionMessage) => void): () => void
	/** Subscribes to the URLs the extension opens in the browser; returns the unsubscribe function. */
	onOpenExternal(listener: (url: string) => void): () => void
}

export interface TuiCloudAuthOptions {
	channel: CloudAuthChannel
	/** Adds a line to the transcript. */
	note: (text: string) => void
	loadSettings?: () => Promise<CliSettings>
	env?: NodeJS.ProcessEnv
	startListener?: typeof startLoopbackListener
	loginTimeoutMs?: number
	resultTimeoutMs?: number
}

type StepResult = { success: true } | { success: false; error: string }

const LOGIN_USAGE =
	"Usage: /login (opens the browser) or /login <address> (the address the browser ended on, " +
	`containing ${CLOUD_CALLBACK_PATH}?code=...).`

export class TuiCloudAuth {
	/** The sign-in waiting for the browser; a newer /login or a pasted address ends it. */
	private pending: AbortController | undefined

	constructor(private readonly options: TuiCloudAuthOptions) {}

	/** `/login [address]`. Resolves when the sign-in has finished or failed. */
	async login(argument: string): Promise<void> {
		if (argument) {
			const callback = parseCloudCallbackUrl(argument)

			if (!callback) {
				this.options.note(LOGIN_USAGE)
				return
			}

			this.cancel()
			await this.complete(callback.url)
			return
		}

		this.cancel()
		await this.startBrowserSignIn()
	}

	/** `/logout`. */
	async logout(): Promise<void> {
		this.cancel()
		const result = this.waitForResult("rooCloudSignOut")
		this.options.channel.send({ type: "rooCloudSignOut" })
		const outcome = await result

		this.options.note(
			outcome.success
				? "Signed out from Tumble Code Cloud."
				: `Tumble Code Cloud sign-out failed: ${outcome.error}`,
		)
	}

	/** Ends a sign-in that is waiting for the browser, without a note. */
	cancel(): void {
		this.pending?.abort()
		this.pending = undefined
	}

	private async startBrowserSignIn(): Promise<void> {
		const { channel, note } = this.options
		const resolution = resolveCloudApiUrl(
			await (this.options.loadSettings ?? loadCliSettings)(),
			this.options.env ?? process.env,
		)

		if (!resolution.ok) {
			note(`${resolution.message}\nThen restart the CLI and run /login again.`)
			return
		}

		const pending = new AbortController()
		this.pending = pending
		const timeoutMs = this.options.loginTimeoutMs ?? LOOPBACK_TIMEOUT_MS
		const listener = await (this.options.startListener ?? startLoopbackListener)({
			timeoutMs,
			signal: pending.signal,
		})

		// The extension opens the sign-in page (the TUI shows its URL); its
		// state lets the listener ignore any other callback.
		const stopWatchingUrls = channel.onOpenExternal((url) => {
			const state = stateOfSignInUrl(url)

			if (state) {
				listener.expectState(state)
				stopWatchingUrls()
				note(
					`Waiting for the browser (up to ${Math.round(timeoutMs / 60_000)} minutes). ` +
						"If it runs on another machine, copy the address it ends on " +
						`(it contains ${CLOUD_CALLBACK_PATH}) and type: /login <address>`,
				)
			}
		})
		// rooCloudSignIn answers only when it fails.
		const startFailed = this.waitForResult("rooCloudSignIn", { timeoutMs: null, signal: pending.signal })

		try {
			note(`Signing in to Tumble Code Cloud at ${resolution.url}`)
			channel.send({ type: "rooCloudSignIn", authRedirect: listener.redirectUrl })

			const first = await Promise.race([
				listener.callback.then((callback) => ({ callback })),
				startFailed.then((outcome) => ({ outcome })),
			])

			if ("outcome" in first) {
				if (!pending.signal.aborted && !first.outcome.success) {
					note(`Tumble Code Cloud sign-in failed: ${first.outcome.error}`)
				}

				return
			}

			this.pending = undefined
			await this.complete(first.callback.url, (outcome) => first.callback.reply(outcome))
		} catch (error) {
			// Aborted by a newer /login or a pasted address: that one reports.
			if (!pending.signal.aborted) {
				note(`Tumble Code Cloud sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
			}
		} finally {
			stopWatchingUrls()
			listener.close()

			if (this.pending === pending) {
				this.pending = undefined
			}

			pending.abort()
		}
	}

	/** Hands the callback URL to the extension and reports the result. */
	private async complete(callbackUrl: string, reply?: (outcome: CallbackOutcome) => void): Promise<void> {
		const result = this.waitForResult("rooCloudManualUrl")
		this.options.channel.send({ type: "rooCloudManualUrl", text: callbackUrl })
		const outcome = await result

		reply?.(outcome.success ? { ok: true } : { ok: false, error: outcome.error })
		this.options.note(
			outcome.success
				? "Signed in to Tumble Code Cloud. This session now sends its usage telemetry there; /logout signs out."
				: `Tumble Code Cloud sign-in failed: ${outcome.error}`,
		)
	}

	/**
	 * The extension's `cloudAuthResult` for `request`; a failure after
	 * `timeoutMs` (`null`: no time limit). Never settles once `signal` aborts
	 * (the listener is removed).
	 */
	private waitForResult(
		request: "rooCloudSignIn" | "rooCloudManualUrl" | "rooCloudSignOut",
		{
			timeoutMs = this.options.resultTimeoutMs ?? RESULT_TIMEOUT_MS,
			signal,
		}: { timeoutMs?: number | null; signal?: AbortSignal } = {},
	): Promise<StepResult> {
		return new Promise((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined
			const finish = (result?: StepResult) => {
				clearTimeout(timer)
				unsubscribe()
				signal?.removeEventListener("abort", onAbort)

				if (result) {
					resolve(result)
				}
			}
			const onAbort = () => finish()
			const unsubscribe = this.options.channel.onMessage((message) => {
				if (message.type === "cloudAuthResult" && message.text === request) {
					finish(
						message.success
							? { success: true }
							: { success: false, error: message.error || "the extension gave no reason" },
					)
				}
			})

			if (timeoutMs !== null) {
				timer = setTimeout(
					() =>
						finish({ success: false, error: `the extension did not answer within ${timeoutMs / 1000} s` }),
					timeoutMs,
				)
				timer.unref?.()
			}

			if (signal?.aborted) {
				finish()
			} else {
				signal?.addEventListener("abort", onAbort, { once: true })
			}
		})
	}
}

/** The `state` of a cloud sign-in URL (`.../extension/sign-in?state=...`), else undefined. */
function stateOfSignInUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url)
		return parsed.pathname.endsWith("/extension/sign-in")
			? (parsed.searchParams.get("state") ?? undefined)
			: undefined
	} catch {
		return undefined
	}
}
