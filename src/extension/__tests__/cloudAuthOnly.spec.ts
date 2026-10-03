// npx vitest run extension/__tests__/cloudAuthOnly.spec.ts

import { EventEmitter } from "events"
import type * as vscode from "vscode"

import type { CloudUserInfo } from "@tumble-code/types"

import { activateCloudAuthOnly, type CloudAuthService } from "../cloudAuthOnly"

vi.mock("@tumble-code/cloud", () => ({
	CloudService: { createInstance: vi.fn(), resetInstance: vi.fn() },
	getTumbleCodeApiUrl: vi.fn(() => "http://cloud.test"),
}))

/** A cloud service whose auth state the test drives through `emitState`. */
class FakeCloud extends EventEmitter {
	state = "logged-out"
	userInfo: CloudUserInfo | null = null
	login = vi.fn(async () => {})
	logout = vi.fn(async () => {})
	handleAuthCallback = vi.fn(async () => {})
	isAuthenticated = () => ["active-session", "attempting-session", "inactive-session"].includes(this.state)
	getAuthState = () => this.state
	getUserInfo = () => this.userInfo

	emitState(state: string) {
		const previousState = this.state
		this.state = state
		this.emit("auth-state-changed", { state, previousState })
	}

	emitUser(userInfo: CloudUserInfo) {
		this.userInfo = userInfo
		this.emit("user-info", { userInfo })
	}
}

async function setup() {
	const cloud = new FakeCloud()
	const disposeCloudService = vi.fn()
	const api = await activateCloudAuthOnly({} as vscode.ExtensionContext, vi.fn(), {
		createCloudService: async () => cloud as unknown as CloudAuthService,
		disposeCloudService,
		getCloudApiUrl: () => "http://cloud.test",
	})
	return { cloud, api, disposeCloudService }
}

describe("activateCloudAuthOnly", () => {
	afterEach(() => vi.useRealTimers())

	it("starts the sign-in with the loopback redirect as the auth redirect", async () => {
		const { cloud, api } = await setup()

		await api.login("http://127.0.0.1:53682")

		expect(cloud.login).toHaveBeenCalledWith({ authRedirect: "http://127.0.0.1:53682" })
	})

	it("reports the signed-out status with the cloud URL", async () => {
		const { api } = await setup()

		expect(api.getStatus()).toEqual({ authenticated: false, state: "logged-out", cloudApiUrl: "http://cloud.test" })
	})

	it("waits for the auth service to pick up the new credentials after the callback", async () => {
		const { cloud, api } = await setup()
		cloud.handleAuthCallback.mockImplementation(async () => {
			// The secrets change event is handled after the store resolves.
			setTimeout(() => cloud.emitState("attempting-session"), 10)
		})

		await api.handleAuthCallback("ticket", "state-1")

		expect(cloud.handleAuthCallback).toHaveBeenCalledWith("ticket", "state-1", null)
		expect(api.getStatus().state).toBe("attempting-session")
	})

	it("rethrows a failed callback (state mismatch, rejected ticket)", async () => {
		const { cloud, api } = await setup()
		cloud.handleAuthCallback.mockRejectedValue(new Error("Invalid state parameter"))

		await expect(api.handleAuthCallback("ticket", "wrong")).rejects.toThrow("Invalid state parameter")
		expect(cloud.listenerCount("auth-state-changed")).toBe(0)
	})

	it("settles once the session is active and the user is known", async () => {
		const { cloud, api } = await setup()
		cloud.emitState("attempting-session")

		const settled = api.waitForSettledSession(5_000)
		cloud.emitState("active-session")
		cloud.emitUser({ email: "me@example.com" })

		await expect(settled).resolves.toEqual({
			authenticated: true,
			state: "active-session",
			userEmail: "me@example.com",
			cloudApiUrl: "http://cloud.test",
		})
		expect(cloud.listenerCount("user-info")).toBe(0)
	})

	it("settles at once when signed out, and on an inactive session", async () => {
		const { cloud, api } = await setup()

		await expect(api.waitForSettledSession(5_000)).resolves.toMatchObject({ authenticated: false })

		cloud.emitState("attempting-session")
		const settled = api.waitForSettledSession(5_000)
		cloud.emitState("inactive-session")
		await expect(settled).resolves.toMatchObject({ authenticated: true, state: "inactive-session" })
	})

	it("gives up waiting after the timeout with the status at that point", async () => {
		vi.useFakeTimers()
		const { cloud, api } = await setup()
		cloud.emitState("attempting-session")

		const settled = api.waitForSettledSession(1_000)
		await vi.advanceTimersByTimeAsync(1_000)

		await expect(settled).resolves.toMatchObject({ state: "attempting-session" })
	})

	it("logs out and disposes the cloud service", async () => {
		const { cloud, api, disposeCloudService } = await setup()

		await api.logout()
		api.dispose()

		expect(cloud.logout).toHaveBeenCalledTimes(1)
		expect(disposeCloudService).toHaveBeenCalledTimes(1)
	})
})
