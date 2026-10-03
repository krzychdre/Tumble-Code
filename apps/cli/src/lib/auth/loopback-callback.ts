/**
 * The CLI end of the cloud sign-in (loopback redirect, RFC 8252).
 *
 * The CLI cannot receive the editor's `vscode://` deep link, so it listens on
 * `http://127.0.0.1:<random port>` and asks the cloud to send the browser to
 * `<that address>/auth/clerk/callback?code=<ticket>&state=<state>` instead.
 * `startLoopbackListener` serves exactly that one request and holds the
 * browser's answer until the CLI has exchanged the ticket, so the page can say
 * whether the sign-in worked.
 *
 * When the browser runs on another machine (a remote shell), it cannot reach
 * this port; the user then pastes the address bar URL into the terminal, and
 * `waitForPastedCallback` reads it. `parseCloudCallbackUrl` accepts both.
 */

import http from "http"
import type { AddressInfo } from "net"
import readline from "readline"

/** The path the cloud appends to the auth redirect (unchanged from the editor flow). */
export const CLOUD_CALLBACK_PATH = "/auth/clerk/callback"

/** How long the listener waits for the browser by default. */
export const LOOPBACK_TIMEOUT_MS = 5 * 60_000

/** How long the browser's request is held for the sign-in result before a neutral page is sent. */
const REPLY_TIMEOUT_MS = 30_000

export interface CloudCallback {
	code: string
	state: string
	/** `null` for a personal account (also when the cloud sent the string "null"). */
	organizationId: string | null
	/** The callback URL as received. */
	url: string
}

export type CallbackOutcome = { ok: true } | { ok: false; error: string }

export interface ReceivedCallback extends CloudCallback {
	/** Answers the waiting browser with the sign-in result; later calls do nothing. */
	reply(outcome: CallbackOutcome): void
}

export interface LoopbackListener {
	/** The auth redirect to hand to the cloud: `http://127.0.0.1:<port>`. */
	redirectUrl: string
	/**
	 * Accept only a callback carrying this state (known once the sign-in URL
	 * exists); any other callback gets an error page and the listener keeps
	 * waiting, so a stray request cannot end the sign-in.
	 */
	expectState(state: string): void
	/** The first valid callback. Rejects on timeout or abort. */
	callback: Promise<ReceivedCallback>
	/** Stops listening; a browser still waiting gets a neutral page. Safe to call twice. */
	close(): void
}

/**
 * Reads a sign-in callback URL: any absolute URL whose path ends with
 * `/auth/clerk/callback` and that carries `code` and `state`.
 */
export function parseCloudCallbackUrl(text: string): CloudCallback | undefined {
	let url: URL

	try {
		url = new URL(text.trim())
	} catch {
		return undefined
	}

	if (!url.pathname.endsWith(CLOUD_CALLBACK_PATH)) {
		return undefined
	}

	const code = url.searchParams.get("code")
	const state = url.searchParams.get("state")

	if (!code || !state) {
		return undefined
	}

	const organizationId = url.searchParams.get("organizationId")

	return {
		code,
		state,
		organizationId: organizationId && organizationId !== "null" ? organizationId : null,
		url: url.toString(),
	}
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

function page(title: string, body: string): string {
	return [
		"<!doctype html>",
		'<html lang="en"><head><meta charset="utf-8"><title>Tumble Code</title>',
		"<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>",
		`</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`,
	].join("")
}

function send(response: http.ServerResponse, status: number, title: string, body: string): void {
	if (response.headersSent || response.writableEnded) {
		return
	}

	response.writeHead(status, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		Connection: "close",
	})
	response.end(page(title, body))
}

const SIGNED_IN_PAGE = ["Signed in", "You can close this tab and return to the terminal."] as const
const RECEIVED_PAGE = ["Sign-in received", "Return to the terminal to see the result."] as const

/** Starts the one-shot callback listener on 127.0.0.1 with an OS-chosen port. */
export async function startLoopbackListener({
	timeoutMs = LOOPBACK_TIMEOUT_MS,
	replyTimeoutMs = REPLY_TIMEOUT_MS,
	signal,
}: { timeoutMs?: number; replyTimeoutMs?: number; signal?: AbortSignal } = {}): Promise<LoopbackListener> {
	let expectedState: string | undefined
	let received = false
	let closed = false
	let pendingResponse: http.ServerResponse | undefined
	let replyTimer: ReturnType<typeof setTimeout> | undefined
	let resolveCallback: (callback: ReceivedCallback) => void = () => {}
	let rejectCallback: (error: Error) => void = () => {}
	let port = 0

	const callback = new Promise<ReceivedCallback>((resolve, reject) => {
		resolveCallback = resolve
		rejectCallback = reject
	})
	// The caller may race this promise and never read a late rejection.
	callback.catch(() => {})

	const server = http.createServer((request, response) => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)

		if (request.method !== "GET") {
			send(response, 405, "Method not allowed", "This address only receives the Tumble Code sign-in.")
			return
		}

		if (url.pathname !== CLOUD_CALLBACK_PATH) {
			send(response, 404, "Not found", "This address only receives the Tumble Code sign-in.")
			return
		}

		if (received) {
			send(response, 409, "Already received", "The terminal already received a sign-in from this address.")
			return
		}

		const parsed = parseCloudCallbackUrl(url.toString())

		if (!parsed) {
			send(response, 400, "Sign-in failed", "The sign-in response has no code or state.")
			return
		}

		if (expectedState !== undefined && parsed.state !== expectedState) {
			send(
				response,
				400,
				"Sign-in failed",
				"This sign-in response does not belong to the sign-in started in the terminal.",
			)
			return
		}

		received = true
		pendingResponse = response
		replyTimer = setTimeout(() => finishReply(200, ...RECEIVED_PAGE), replyTimeoutMs)

		resolveCallback({
			...parsed,
			reply: (outcome) =>
				outcome.ok
					? finishReply(200, ...SIGNED_IN_PAGE)
					: finishReply(500, "Sign-in failed", `${outcome.error} Return to the terminal for details.`),
		})
	})

	const finishReply = (status: number, title: string, body: string) => {
		clearTimeout(replyTimer)

		if (pendingResponse) {
			send(pendingResponse, status, title, body)
			pendingResponse = undefined
		}
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject)
			resolve()
		})
	})

	port = (server.address() as AddressInfo).port

	const close = () => {
		if (closed) {
			return
		}

		closed = true
		clearTimeout(timeout)
		signal?.removeEventListener("abort", onAbort)
		finishReply(200, ...RECEIVED_PAGE)
		server.close()
		server.closeIdleConnections()
	}

	const fail = (error: Error) => {
		rejectCallback(error)
		close()
	}

	const timeout = setTimeout(
		() => fail(new Error(`no sign-in arrived within ${Math.round(timeoutMs / 60_000)} minutes`)),
		timeoutMs,
	)
	timeout.unref()

	const onAbort = () => fail(new Error("sign-in cancelled"))

	if (signal?.aborted) {
		onAbort()
	} else {
		signal?.addEventListener("abort", onAbort, { once: true })
	}

	return {
		redirectUrl: `http://127.0.0.1:${port}`,
		expectState: (state) => {
			expectedState = state
		},
		callback,
		close,
	}
}

/**
 * Reads lines from `input` (the terminal) until one is a sign-in callback URL.
 * `onInvalidLine` hears every other non-empty line. Rejects when `signal`
 * aborts; the line reader is closed either way.
 */
export function waitForPastedCallback({
	input,
	signal,
	onInvalidLine,
}: {
	input: NodeJS.ReadableStream
	signal?: AbortSignal
	onInvalidLine?: (line: string) => void
}): Promise<CloudCallback> {
	return new Promise((resolve, reject) => {
		// terminal: false leaves the terminal in its normal line mode, so Ctrl+C
		// still raises SIGINT for the process instead of being read as a key.
		const lines = readline.createInterface({ input, terminal: false })

		const finish = () => {
			signal?.removeEventListener("abort", onAbort)
			lines.close()
		}

		const onAbort = () => {
			finish()
			reject(new Error("sign-in cancelled"))
		}

		lines.on("line", (line) => {
			const parsed = parseCloudCallbackUrl(line)

			if (parsed) {
				finish()
				resolve(parsed)
			} else if (line.trim()) {
				onInvalidLine?.(line)
			}
		})

		if (signal?.aborted) {
			onAbort()
		} else {
			signal?.addEventListener("abort", onAbort, { once: true })
		}
	})
}
