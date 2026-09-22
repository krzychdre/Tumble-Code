import {
	getOpenAiCodexAuthStatus,
	loginToOpenAiCodex,
	logoutFromOpenAiCodex,
	type OpenAiCodexOAuthManager,
	type OpenAiCodexCredentials,
} from "../openai-codex.js"

function createManager(overrides: Partial<OpenAiCodexOAuthManager> = {}) {
	const credentials: OpenAiCodexCredentials = {
		type: "openai-codex",
		access_token: "access",
		refresh_token: "refresh",
		expires: Date.now() + 60_000,
		email: "plus@example.com",
		accountId: "account-id",
	}
	const manager: OpenAiCodexOAuthManager = {
		startAuthorizationFlow: vi.fn(() => "https://auth.openai.test/authorize"),
		waitForCallback: vi.fn(async () => credentials),
		cancelAuthorizationFlow: vi.fn(),
		clearCredentials: vi.fn(async () => {}),
		isAuthenticated: vi.fn(async () => true),
		getEmail: vi.fn(async () => credentials.email ?? null),
		...overrides,
	}
	return { manager, credentials }
}

describe("OpenAI Codex CLI authentication", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => vi.restoreAllMocks())

	it("opens the PKCE URL, waits for callback, and cleans up", async () => {
		const { manager, credentials } = createManager()
		const opener = vi.fn(async () => true)
		const result = await loginToOpenAiCodex({ createManager: async () => manager, openExternal: opener })

		expect(result).toEqual({ success: true, email: credentials.email })
		expect(opener).toHaveBeenCalledWith("https://auth.openai.test/authorize")
		expect(manager.waitForCallback).toHaveBeenCalledOnce()
		expect(manager.cancelAuthorizationFlow).toHaveBeenCalledOnce()
	})

	it("prints a manual fallback while still accepting the callback", async () => {
		const { manager } = createManager()
		const result = await loginToOpenAiCodex({ createManager: async () => manager, openExternal: async () => false })

		expect(result.success).toBe(true)
		expect(console.log).toHaveBeenCalledWith("Please open the URL above in your browser manually.")
	})

	it("returns a failure and cancels the listener when callback processing fails", async () => {
		const { manager } = createManager({
			waitForCallback: vi.fn(async () => Promise.reject(new Error("state mismatch"))),
		})
		const result = await loginToOpenAiCodex({ createManager: async () => manager, openExternal: async () => true })

		expect(result).toEqual({ success: false, error: "state mismatch" })
		expect(manager.cancelAuthorizationFlow).toHaveBeenCalledOnce()
	})

	it("reports authenticated status with the account email", async () => {
		const { manager } = createManager()
		await expect(getOpenAiCodexAuthStatus({ createManager: async () => manager })).resolves.toEqual({
			authenticated: true,
			email: "plus@example.com",
		})
	})

	it("reports unauthenticated status", async () => {
		const { manager } = createManager({ isAuthenticated: vi.fn(async () => false) })
		await expect(getOpenAiCodexAuthStatus({ createManager: async () => manager })).resolves.toEqual({
			authenticated: false,
		})
	})

	it("clears stored credentials on logout", async () => {
		const { manager } = createManager()
		await expect(logoutFromOpenAiCodex({ createManager: async () => manager })).resolves.toEqual({ success: true })
		expect(manager.clearCredentials).toHaveBeenCalledOnce()
	})
})
