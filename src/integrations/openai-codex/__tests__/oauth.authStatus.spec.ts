import type { ExtensionContext } from "vscode"

import { OpenAiCodexOAuthManager, type OpenAiCodexCredentials } from "../oauth"

const KEY = "openai-codex-oauth-credentials"

function makeContext(initial?: OpenAiCodexCredentials) {
	const store = new Map<string, string>()
	if (initial) {
		store.set(KEY, JSON.stringify(initial))
	}
	const changeListeners: Array<(e: { key: string }) => void> = []
	const secrets = {
		get: vi.fn(async (key: string) => store.get(key)),
		store: vi.fn(async (key: string, value: string) => void store.set(key, value)),
		delete: vi.fn(async (key: string) => void store.delete(key)),
		onDidChange: vi.fn((listener: (e: { key: string }) => void) => {
			changeListeners.push(listener)
			return { dispose: vi.fn() }
		}),
	}
	const context = { secrets, subscriptions: [] as unknown[] } as unknown as ExtensionContext
	const fireSecretChange = (key: string) => changeListeners.forEach((listener) => listener({ key }))
	return { context, secrets, fireSecretChange }
}

const validCredentials = (overrides: Partial<OpenAiCodexCredentials> = {}): OpenAiCodexCredentials => ({
	type: "openai-codex",
	access_token: "access",
	refresh_token: "refresh",
	expires: Date.now() + 60 * 60 * 1000,
	...overrides,
})

describe("OpenAiCodexOAuthManager.getAuthenticationStatus", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("signed out: reads secret storage once, then answers from the cache", async () => {
		const { context, secrets } = makeContext()
		const manager = new OpenAiCodexOAuthManager()
		manager.initialize(context)

		expect(await manager.getAuthenticationStatus()).toBe(false)
		expect(await manager.getAuthenticationStatus()).toBe(false)
		expect(await manager.getAuthenticationStatus()).toBe(false)

		expect(secrets.get).toHaveBeenCalledTimes(1)
	})

	it("signed in: an access token that expires later does not trigger a refresh from a status read", async () => {
		const { context } = makeContext(validCredentials())
		const manager = new OpenAiCodexOAuthManager()
		manager.initialize(context)

		expect(await manager.getAuthenticationStatus()).toBe(true)

		vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000 })
		try {
			expect(await manager.getAuthenticationStatus()).toBe(true)
		} finally {
			vi.useRealTimers()
		}
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("sign-in (saveCredentials) and sign-out (clearCredentials) update the cached status", async () => {
		const { context, secrets } = makeContext()
		const manager = new OpenAiCodexOAuthManager()
		manager.initialize(context)

		expect(await manager.getAuthenticationStatus()).toBe(false)

		await manager.saveCredentials(validCredentials())
		expect(await manager.getAuthenticationStatus()).toBe(true)

		await manager.clearCredentials()
		expect(await manager.getAuthenticationStatus()).toBe(false)

		expect(secrets.get).toHaveBeenCalledTimes(1)
	})

	it("a failed refresh that keeps the credentials is not cached, so the next read retries", async () => {
		const { context } = makeContext(validCredentials({ expires: Date.now() - 1000 }))
		const manager = new OpenAiCodexOAuthManager()
		manager.initialize(context, () => {})
		vi.spyOn(console, "error").mockImplementation(() => {})

		fetchMock.mockRejectedValueOnce(new Error("network down"))
		expect(await manager.getAuthenticationStatus()).toBe(false)

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }),
		)
		expect(await manager.getAuthenticationStatus()).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("a change of the stored credentials (for example from another window) invalidates the cache", async () => {
		const { context, secrets, fireSecretChange } = makeContext()
		const manager = new OpenAiCodexOAuthManager()
		manager.initialize(context)

		expect(await manager.getAuthenticationStatus()).toBe(false)
		await secrets.store(KEY, JSON.stringify(validCredentials()))
		fireSecretChange("some-other-key")
		expect(await manager.getAuthenticationStatus()).toBe(false)

		fireSecretChange(KEY)
		expect(await manager.getAuthenticationStatus()).toBe(true)
	})
})
