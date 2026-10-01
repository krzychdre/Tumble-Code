import type { ExtensionContext } from "vscode"

import {
	OPENAI_CODEX_OAUTH_CONFIG,
	OpenAiCodexOAuthManager,
	exchangeCodeForTokens,
	refreshAccessToken,
	type OpenAiCodexCredentials,
} from "../oauth"

const KEY = "openai-codex-oauth-credentials"

function makeContext(initial?: OpenAiCodexCredentials) {
	const store = new Map<string, string>()
	if (initial) {
		store.set(KEY, JSON.stringify(initial))
	}
	const secrets = {
		get: vi.fn(async (key: string) => store.get(key)),
		store: vi.fn(async (key: string, value: string) => void store.set(key, value)),
		delete: vi.fn(async (key: string) => void store.delete(key)),
		onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
	}
	const context = { secrets, subscriptions: [] as unknown[] } as unknown as ExtensionContext
	return { context, store }
}

const credentials = (overrides: Partial<OpenAiCodexCredentials> = {}): OpenAiCodexCredentials => ({
	type: "openai-codex",
	access_token: "old-access",
	refresh_token: "old-refresh",
	expires: Date.now() + 60 * 60 * 1000,
	email: "me@example.com",
	accountId: "acct-old",
	...overrides,
})

const tokenResponse = (body: Record<string, unknown>) => Response.json(body)
const errorResponse = (status: number, statusText: string, body: string) => new Response(body, { status, statusText })

/** The form fields of the n-th fetch call, and its URL and headers. */
function sentForm(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
	const [url, init] = fetchMock.mock.calls[call]!
	return {
		url,
		method: init.method,
		headers: init.headers,
		form: Object.fromEntries(new URLSearchParams(init.body as string)),
		hasSignal: init.signal instanceof AbortSignal,
	}
}

describe("OpenAI Codex OAuth token requests", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe("exchangeCodeForTokens", () => {
		it("posts the authorization_code form and maps the response", async () => {
			fetchMock.mockResolvedValue(
				tokenResponse({ access_token: "a", refresh_token: "r", expires_in: 60, email: "e@x" }),
			)
			const before = Date.now()

			const result = await exchangeCodeForTokens("the-code", "the-verifier")

			expect(sentForm(fetchMock)).toEqual({
				url: OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint,
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				form: {
					grant_type: "authorization_code",
					client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
					code: "the-code",
					redirect_uri: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
					code_verifier: "the-verifier",
				},
				hasSignal: true,
			})
			expect(result).toMatchObject({ type: "openai-codex", access_token: "a", refresh_token: "r", email: "e@x" })
			expect(result.expires).toBeGreaterThanOrEqual(before + 60_000)
		})

		it("fails with status and body text on an HTTP error", async () => {
			fetchMock.mockResolvedValue(errorResponse(400, "Bad Request", "bad code"))
			await expect(exchangeCodeForTokens("c", "v")).rejects.toThrow(
				"Token exchange failed: 400 Bad Request - bad code",
			)
		})

		it("fails when no refresh_token comes back", async () => {
			fetchMock.mockResolvedValue(tokenResponse({ access_token: "a", expires_in: 60 }))
			await expect(exchangeCodeForTokens("c", "v")).rejects.toThrow(
				"Token exchange did not return a refresh_token",
			)
		})
	})

	describe("refreshAccessToken", () => {
		it("posts the refresh_token form and keeps the old refresh token, email and account when not returned", async () => {
			fetchMock.mockResolvedValue(tokenResponse({ access_token: "new-access", expires_in: 3600 }))

			const result = await refreshAccessToken(credentials())

			expect(sentForm(fetchMock)).toEqual({
				url: OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint,
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				form: {
					grant_type: "refresh_token",
					client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
					refresh_token: "old-refresh",
				},
				hasSignal: true,
			})
			expect(result).toMatchObject({
				access_token: "new-access",
				refresh_token: "old-refresh",
				email: "me@example.com",
				accountId: "acct-old",
			})
		})

		it("fails with status, error code and description on an HTTP error", async () => {
			fetchMock.mockResolvedValue(
				errorResponse(
					400,
					"Bad Request",
					JSON.stringify({ error: "invalid_grant", error_description: "Refresh token revoked" }),
				),
			)

			const error = await refreshAccessToken(credentials()).catch((e: unknown) => e)

			expect(error).toMatchObject({
				message: "Token refresh failed: 400 Bad Request - Refresh token revoked",
				status: 400,
				errorCode: "invalid_grant",
			})
		})
	})

	describe("OpenAiCodexOAuthManager", () => {
		function manager(initial?: OpenAiCodexCredentials) {
			const { context, store } = makeContext(initial)
			const m = new OpenAiCodexOAuthManager()
			m.initialize(context)
			return { m, store }
		}

		it("getAccessToken returns a valid token without a request", async () => {
			const { m } = manager(credentials())
			expect(await m.getAccessToken()).toBe("old-access")
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it("getAccessToken refreshes an expired token once for concurrent callers and persists it", async () => {
			fetchMock.mockResolvedValue(
				tokenResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
			)
			const { m, store } = manager(credentials({ expires: Date.now() - 1000 }))

			const tokens = await Promise.all([m.getAccessToken(), m.getAccessToken()])

			expect(tokens).toEqual(["new-access", "new-access"])
			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(JSON.parse(store.get(KEY)!)).toMatchObject({
				access_token: "new-access",
				refresh_token: "new-refresh",
			})
		})

		it("forceRefreshAccessToken refreshes a token that has not expired", async () => {
			fetchMock.mockResolvedValue(tokenResponse({ access_token: "forced", expires_in: 3600 }))
			const { m, store } = manager(credentials())

			expect(await m.forceRefreshAccessToken()).toBe("forced")
			expect(JSON.parse(store.get(KEY)!)).toMatchObject({ access_token: "forced", refresh_token: "old-refresh" })
		})

		it.each(["getAccessToken", "forceRefreshAccessToken"] as const)(
			"%s: an invalid grant clears the stored credentials and returns null",
			async (method) => {
				fetchMock.mockResolvedValue(
					errorResponse(400, "Bad Request", JSON.stringify({ error: "invalid_grant" })),
				)
				const { m, store } = manager(credentials({ expires: Date.now() - 1000 }))

				expect(await m[method]()).toBeNull()
				expect(store.has(KEY)).toBe(false)
				expect(await m.getAuthenticationStatus()).toBe(false)
			},
		)

		it.each(["getAccessToken", "forceRefreshAccessToken"] as const)(
			"%s: a server error keeps the stored credentials, returns null, and the next call retries",
			async (method) => {
				fetchMock
					.mockResolvedValueOnce(errorResponse(500, "Internal Server Error", "oops"))
					.mockResolvedValueOnce(tokenResponse({ access_token: "second", expires_in: 3600 }))
				const { m, store } = manager(credentials({ expires: Date.now() - 1000 }))

				expect(await m[method]()).toBeNull()
				expect(store.has(KEY)).toBe(true)
				expect(await m[method]()).toBe("second")
				expect(fetchMock).toHaveBeenCalledTimes(2)
			},
		)

		it.each(["getAccessToken", "forceRefreshAccessToken"] as const)(
			"%s: no stored credentials returns null without a request",
			async (method) => {
				const { m } = manager()
				expect(await m[method]()).toBeNull()
				expect(fetchMock).not.toHaveBeenCalled()
			},
		)
	})
})
