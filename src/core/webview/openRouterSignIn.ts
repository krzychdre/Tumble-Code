import { createHash, randomBytes } from "crypto"

/**
 * Signing in with OpenRouter (OAuth with PKCE).
 *
 * The callback, `vscode://<publisher>.<name>/openrouter?code=...`, can be
 * opened by anyone who gets the user to click a link. Without a check, a code
 * from the attacker's own OpenRouter login replaced the user's API key, so the
 * user's prompts went to, and were readable in, the attacker's account. Now a
 * code is taken only while a sign-in started from this window is pending, and
 * it is exchanged with that sign-in's PKCE verifier, which a code issued to
 * anyone else does not match.
 */

const PENDING_MS = 10 * 60 * 1000

let pending: { verifier: string; expiresAt: number } | undefined

const base64Url = (bytes: Buffer) => bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/** Starts a sign-in and returns the OpenRouter page to open. */
export function startOpenRouterSignIn(callbackUrl: string, now = Date.now()): string {
	const verifier = base64Url(randomBytes(32))
	pending = { verifier, expiresAt: now + PENDING_MS }
	const challenge = base64Url(createHash("sha256").update(verifier).digest())
	const query = new URLSearchParams({
		callback_url: callbackUrl,
		code_challenge: challenge,
		code_challenge_method: "S256",
	})
	return `https://openrouter.ai/auth?${query}`
}

/** The verifier of the pending sign-in, once; undefined when none was started here or it expired. */
export function takePendingOpenRouterSignIn(now = Date.now()): string | undefined {
	const current = pending
	pending = undefined
	return current && current.expiresAt > now ? current.verifier : undefined
}

export type HttpPost = (url: string, body: Record<string, string>) => Promise<{ data?: { key?: unknown } }>

/**
 * Exchanges a callback's code for an API key, or returns undefined (and calls
 * nothing) when no sign-in is pending in this window.
 */
export async function completeOpenRouterSignIn(
	code: string,
	baseUrl: string,
	post: HttpPost,
	now = Date.now(),
): Promise<string | undefined> {
	const verifier = takePendingOpenRouterSignIn(now)
	if (!verifier) {
		return undefined
	}
	// The auth endpoint lives on the base URL's host.
	const origin = baseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || "https://openrouter.ai"
	const response = await post(`${origin}/api/v1/auth/keys`, {
		code,
		code_verifier: verifier,
		code_challenge_method: "S256",
	})
	const key = response.data?.key
	if (typeof key !== "string" || !key) {
		throw new Error("Invalid response from OpenRouter API")
	}
	return key
}
