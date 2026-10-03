import { PassThrough } from "stream"

import type { CliCloudAuthApi, CliCloudAuthStatus } from "@tumble-code/types"

import type { LoopbackListener, ReceivedCallback } from "@/lib/auth/loopback-callback.js"

import { getCloudAuthStatus, loginToCloud, logoutFromCloud, type CloudAuthDependencies } from "../cloud.js"

const SIGN_IN_URL = "http://cloud.test/extension/sign-in?state=state-1&auth_redirect=http%3A%2F%2F127.0.0.1%3A53682"

function createApi(overrides: Partial<CliCloudAuthApi> = {}) {
	const signedIn: CliCloudAuthStatus = {
		authenticated: true,
		state: "active-session",
		userEmail: "me@example.com",
		cloudApiUrl: "http://cloud.test",
	}
	const api: CliCloudAuthApi = {
		login: vi.fn(async () => {}),
		handleAuthCallback: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		getStatus: vi.fn(() => signedIn),
		waitForSettledSession: vi.fn(async () => signedIn),
		dispose: vi.fn(),
		...overrides,
	}
	return api
}

function createListener(callback: Promise<ReceivedCallback>) {
	const listener: LoopbackListener = {
		redirectUrl: "http://127.0.0.1:53682",
		expectState: vi.fn(),
		callback,
		close: vi.fn(),
	}
	return listener
}

function received(overrides: Partial<ReceivedCallback> = {}): ReceivedCallback {
	return {
		code: "ticket",
		state: "state-1",
		organizationId: null,
		url: "http://127.0.0.1:53682/auth/clerk/callback?code=ticket&state=state-1",
		reply: vi.fn(),
		...overrides,
	}
}

/** Dependencies with a fake extension whose login "opens" SIGN_IN_URL through the given openExternal. */
function setup({
	api = createApi(),
	listener = createListener(Promise.resolve(received())),
	settings = { cloudApiUrl: "http://cloud.test/" },
	env = {},
	input = Object.assign(new PassThrough(), { isTTY: false }),
}: {
	api?: CliCloudAuthApi
	listener?: LoopbackListener
	settings?: Record<string, unknown>
	env?: NodeJS.ProcessEnv
	input?: PassThrough & { isTTY?: boolean }
} = {}) {
	let out = ""
	let err = ""
	const createCloudAuth = vi.fn<NonNullable<CloudAuthDependencies["createCloudAuth"]>>(async ({ openExternal }) => {
		const login = api.login
		api.login = vi.fn(async (authRedirect: string) => {
			await login(authRedirect)
			await openExternal(SIGN_IN_URL)
		})
		return api
	})
	const openExternal = vi.fn(async () => true)
	const dependencies: CloudAuthDependencies = {
		loadSettings: async () => settings,
		env,
		createCloudAuth,
		openExternal,
		startListener: vi.fn(async () => listener),
		input,
		signal: new AbortController().signal,
		write: (text) => {
			out += text
		},
		writeError: (text) => {
			err += text
		},
	}
	return { api, listener, dependencies, createCloudAuth, openExternal, output: () => ({ out, err }) }
}

describe("tumble auth cloud login", () => {
	it("signs in through the loopback listener and reports the account", async () => {
		const { api, listener, dependencies, createCloudAuth, openExternal, output } = setup()

		await expect(loginToCloud(dependencies)).resolves.toEqual({ success: true, email: "me@example.com" })

		// The settings URL, normalized, reaches the extension before it activates.
		expect(createCloudAuth).toHaveBeenCalledWith(expect.objectContaining({ cloudApiUrl: "http://cloud.test" }))
		expect(api.login).toHaveBeenCalledWith("http://127.0.0.1:53682")
		expect(openExternal).toHaveBeenCalledWith(SIGN_IN_URL)
		expect(listener.expectState).toHaveBeenCalledWith("state-1")
		expect(api.handleAuthCallback).toHaveBeenCalledWith("ticket", "state-1", null)
		expect((await listener.callback).reply).toHaveBeenCalledWith({ ok: true })
		expect(listener.close).toHaveBeenCalled()
		expect(api.dispose).toHaveBeenCalled()
		expect(output().out).toContain(SIGN_IN_URL)
		expect(output().out).toContain("✓ Signed in to Tumble Code Cloud as me@example.com.")
	})

	it("restores the cloud's port the shim's Uri.parse drops from the sign-in URL", async () => {
		const { dependencies, openExternal } = setup({ settings: { cloudApiUrl: "http://cloud.test:8000" } })

		await expect(loginToCloud(dependencies)).resolves.toMatchObject({ success: true })
		expect(openExternal).toHaveBeenCalledWith(SIGN_IN_URL.replace("http://cloud.test/", "http://cloud.test:8000/"))
	})

	it("prints the URL for a remote shell even when no browser opens", async () => {
		const { dependencies, output } = setup()
		dependencies.openExternal = async () => false

		await expect(loginToCloud(dependencies)).resolves.toMatchObject({ success: true })
		expect(output().out).toContain(`visit:\n  ${SIGN_IN_URL}`)
		expect(output().out).toContain("Could not open a browser")
	})

	it("accepts a pasted callback URL when the browser cannot reach the listener", async () => {
		const input = Object.assign(new PassThrough(), { isTTY: true })
		const { api, dependencies, output } = setup({ listener: createListener(new Promise(() => {})), input })

		const login = loginToCloud(dependencies)
		await vi.waitFor(() => expect(output().out).toContain("paste it here"))
		input.write("http://127.0.0.1:53682/auth/clerk/callback?code=pasted&state=state-1&organizationId=org_1\n")

		await expect(login).resolves.toMatchObject({ success: true })
		expect(api.handleAuthCallback).toHaveBeenCalledWith("pasted", "state-1", "org_1")
	})

	it("explains how to configure the cloud and starts nothing without a cloud URL", async () => {
		const { dependencies, createCloudAuth, output } = setup({ settings: {} })

		const result = await loginToCloud(dependencies)

		expect(result.success).toBe(false)
		expect(createCloudAuth).not.toHaveBeenCalled()
		expect(output().err).toContain('Add "cloudApiUrl" to')
	})

	it("uses TUMBLE_CODE_API_URL without handing a setting to the extension", async () => {
		const { dependencies, createCloudAuth } = setup({
			settings: {},
			env: { TUMBLE_CODE_API_URL: "http://env.test" },
		})

		await expect(loginToCloud(dependencies)).resolves.toMatchObject({ success: true })
		expect(createCloudAuth).toHaveBeenCalledWith(expect.objectContaining({ cloudApiUrl: undefined }))
	})

	it("fails, tells the browser and cleans up when the ticket exchange fails", async () => {
		const api = createApi({ handleAuthCallback: vi.fn(async () => Promise.reject(new Error("HTTP 400"))) })
		const { listener, dependencies, output } = setup({ api })

		await expect(loginToCloud(dependencies)).resolves.toEqual({ success: false, error: "HTTP 400" })
		expect((await listener.callback).reply).toHaveBeenCalledWith({ ok: false, error: "HTTP 400" })
		expect(listener.close).toHaveBeenCalled()
		expect(api.dispose).toHaveBeenCalled()
		expect(output().err).toContain("✗ Tumble Code Cloud sign-in failed: HTTP 400")
	})

	it("fails when the listener times out or is cancelled", async () => {
		const { dependencies } = setup({
			listener: createListener(Promise.reject(new Error("no sign-in arrived within 5 minutes"))),
		})

		await expect(loginToCloud(dependencies)).resolves.toEqual({
			success: false,
			error: "no sign-in arrived within 5 minutes",
		})
	})

	it("signs in but says so when the cloud does not confirm the session", async () => {
		const api = createApi({
			waitForSettledSession: vi.fn(async () => ({
				authenticated: true,
				state: "inactive-session",
				cloudApiUrl: "http://cloud.test",
			})),
		})
		const { dependencies, output } = setup({ api })

		await expect(loginToCloud(dependencies)).resolves.toEqual({ success: true, email: undefined })
		expect(output().out).toContain("The cloud did not confirm the session yet (state: inactive-session)")
	})
})

describe("tumble auth cloud logout", () => {
	it("signs out", async () => {
		const { api, dependencies, output } = setup()

		await expect(logoutFromCloud(dependencies)).resolves.toEqual({ success: true })
		expect(api.logout).toHaveBeenCalled()
		expect(api.dispose).toHaveBeenCalled()
		expect(output().out).toContain("✓ Signed out from Tumble Code Cloud (http://cloud.test).")
	})

	it("reports a failure", async () => {
		const api = createApi({ logout: vi.fn(async () => Promise.reject(new Error("disk full"))) })
		const { dependencies } = setup({ api })

		await expect(logoutFromCloud(dependencies)).resolves.toEqual({ success: false, error: "disk full" })
	})
})

describe("tumble auth cloud status", () => {
	it("reports the signed-in account and the cloud URL", async () => {
		const { dependencies, output } = setup()

		await expect(getCloudAuthStatus(dependencies)).resolves.toEqual({
			authenticated: true,
			email: "me@example.com",
			cloudApiUrl: "http://cloud.test",
		})
		expect(output().out).toContain("Signed in to Tumble Code Cloud as me@example.com (http://cloud.test).")
	})

	it("reports signed out", async () => {
		const status = { authenticated: false, state: "logged-out", cloudApiUrl: "http://cloud.test" }
		const api = createApi({ waitForSettledSession: vi.fn(async () => status) })
		const { dependencies, output } = setup({ api })

		await expect(getCloudAuthStatus(dependencies)).resolves.toEqual({
			authenticated: false,
			cloudApiUrl: "http://cloud.test",
		})
		expect(output().out).toContain(
			"Not signed in to Tumble Code Cloud (http://cloud.test). Run: tumble auth cloud login",
		)
	})

	it("reports an extension without cloud sign-in support", async () => {
		const { dependencies, output } = setup()
		dependencies.createCloudAuth = async () => Promise.reject(new Error("rebuild or upgrade it"))

		await expect(getCloudAuthStatus(dependencies)).resolves.toEqual({
			authenticated: false,
			error: "rebuild or upgrade it",
		})
		expect(output().err).toContain("Unable to read the Tumble Code Cloud sign-in status: rebuild or upgrade it")
	})
})
