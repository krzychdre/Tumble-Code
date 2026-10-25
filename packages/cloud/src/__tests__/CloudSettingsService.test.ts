import type { Mock } from "vitest"
import type { ExtensionContext } from "vscode"

import type { AuthService, OrganizationSettings, UserSettingsData } from "@tumble-code/types"

import { CloudSettingsService } from "../CloudSettingsService.js"
import { RefreshTimer } from "../RefreshTimer.js"

vi.mock("../RefreshTimer")

vi.mock("../config", () => ({
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}))

const fetchMock = vi.fn()
global.fetch = fetchMock

const ORG: OrganizationSettings = {
	version: 1,
	defaultSettings: {},
	allowList: { allowAll: false, providers: { anthropic: { allowAll: true } } },
}

const USER: UserSettingsData = { features: {}, settings: { taskSyncEnabled: false }, version: 1 }

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const refused = (status: number) => ({ ok: false, status, statusText: `status ${status}` })

describe("CloudSettingsService", () => {
	let cache: Map<string, unknown>
	let context: ExtensionContext
	let authService: {
		getState: Mock
		getSessionToken: Mock
		hasActiveSession: Mock
		on: Mock
		getStoredOrganizationId: Mock
	}
	let timer: { start: Mock; stop: Mock }
	let log: Mock
	let service: CloudSettingsService

	const makeService = async (cached: { org?: OrganizationSettings; user?: UserSettingsData } = {}) => {
		cache.set("organization-settings", cached.org)
		cache.set("user-settings", cached.user)
		service = new CloudSettingsService(context, authService as unknown as AuthService, log)
		await service.initialize()
		return service
	}

	/** Runs one scheduled settings fetch, as the refresh timer does. */
	const refresh = (): Promise<boolean> => vi.mocked(RefreshTimer).mock.calls.at(-1)![0].callback()

	const changeAuthState = (state: string, previousState: string) => {
		const [, handler] = authService.on.mock.calls.find(([event]) => event === "auth-state-changed")!
		return handler({ state, previousState })
	}

	beforeEach(() => {
		vi.clearAllMocks()
		cache = new Map()
		context = {
			globalState: {
				get: vi.fn((key: string) => cache.get(key)),
				update: vi.fn(async (key: string, value: unknown) => {
					cache.set(key, value)
				}),
			},
		} as unknown as ExtensionContext
		authService = {
			getState: vi.fn().mockReturnValue("active-session"),
			getSessionToken: vi.fn().mockReturnValue("valid-token"),
			hasActiveSession: vi.fn().mockReturnValue(false),
			on: vi.fn(),
			getStoredOrganizationId: vi.fn().mockReturnValue(null),
		}
		timer = { start: vi.fn(), stop: vi.fn() }
		vi.mocked(RefreshTimer).mockImplementation(function () {
			return timer as unknown as RefreshTimer
		})
		log = vi.fn()
	})

	afterEach(() => {
		service.dispose()
	})

	describe("initialize", () => {
		it("serves the cached settings while signed in", async () => {
			await makeService({ org: ORG, user: USER })

			expect(service.getSettings()).toEqual(ORG)
			expect(service.getAllowList()).toEqual(ORG.allowList)
			expect(service.getUserSettings()).toEqual(USER)
			expect(service.getUserSettingsConfig()).toEqual(USER.settings)
			expect(service.getUserFeatures()).toEqual(USER.features)
		})

		it("drops the cache when a sign-out was missed", async () => {
			authService.getState.mockReturnValue("logged-out")

			await makeService({ org: ORG, user: USER })

			expect(service.getSettings()).toBeUndefined()
			expect(cache.get("organization-settings")).toBeUndefined()
			expect(cache.get("user-settings")).toBeUndefined()
		})

		it("falls back to allow-all and empty user settings without any settings", async () => {
			await makeService()

			expect(service.getAllowList()).toEqual({ allowAll: true, providers: {} })
			expect(service.getUserFeatures()).toEqual({})
			expect(service.getUserSettingsConfig()).toEqual({})
		})

		it.each([
			[true, 1],
			[false, 0],
		])("starts the refresh timer only with an active session (%s)", async (active, starts) => {
			authService.hasActiveSession.mockReturnValue(active)

			await makeService()

			expect(timer.start).toHaveBeenCalledTimes(starts)
		})
	})

	describe("auth state changes", () => {
		it.each([
			["active-session", "attempting-session", { start: 1, stop: 0, cleared: false }],
			["logged-out", "active-session", { start: 0, stop: 1, cleared: true }],
			["inactive-session", "active-session", { start: 0, stop: 1, cleared: false }],
			["logged-out", "attempting-session", { start: 0, stop: 0, cleared: false }],
		])("%s after %s", async (state, previousState, expected) => {
			await makeService({ org: ORG, user: USER })

			await changeAuthState(state, previousState)

			expect(timer.start).toHaveBeenCalledTimes(expected.start)
			expect(timer.stop).toHaveBeenCalledTimes(expected.stop)
			expect(service.getSettings() === undefined).toBe(expected.cleared)
			expect(cache.get("user-settings") === undefined).toBe(expected.cleared)
		})

		it("logs a failure while handling a sign-out", async () => {
			await makeService({ org: ORG, user: USER })
			vi.mocked(context.globalState.update).mockRejectedValue(new Error("disk full"))

			await changeAuthState("logged-out", "active-session")

			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("error processing auth-state-changed"),
				expect.any(Error),
			)
		})
	})

	describe("refresh", () => {
		it("fetches with the session token and a timeout, stores both settings and announces the change", async () => {
			await makeService()
			const updated = vi.fn()
			service.on("settings-updated", updated)
			fetchMock.mockResolvedValue(ok({ organization: ORG, user: USER }))

			expect(await refresh()).toBe(true)

			const [url, options] = fetchMock.mock.calls[0]!
			expect(url).toBe("http://localhost:8080/api/extension-settings")
			expect(options.headers).toEqual({ Authorization: "Bearer valid-token" })
			expect(options.signal).toBeInstanceOf(AbortSignal)
			expect(service.getSettings()).toEqual(ORG)
			expect(service.getUserSettings()).toEqual(USER)
			expect(cache.get("organization-settings")).toEqual(ORG)
			expect(cache.get("user-settings")).toEqual(USER)
			expect(updated).toHaveBeenCalledTimes(1)
		})

		it.each([
			["nothing", ORG, USER, false],
			["the organization version", { ...ORG, version: 2 }, USER, true],
			["the user version", ORG, { ...USER, version: 2 }, true],
		])("announces and stores a change only when %s changed", async (_name, org, user, changes) => {
			await makeService({ org: ORG, user: USER })
			const updated = vi.fn()
			service.on("settings-updated", updated)
			fetchMock.mockResolvedValue(ok({ organization: org, user }))

			expect(await refresh()).toBe(true)

			expect(updated).toHaveBeenCalledTimes(changes ? 1 : 0)
			expect(context.globalState.update).toHaveBeenCalledTimes(changes ? 2 : 0)
			expect(service.getSettings()).toEqual(org)
			expect(service.getUserSettings()).toEqual(user)
		})

		it("does not fetch without a session token", async () => {
			authService.getSessionToken.mockReturnValue(null)
			await makeService()

			expect(await refresh()).toBe(false)
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it.each([
			["a refused request", () => fetchMock.mockResolvedValue(refused(500))],
			["a network error", () => fetchMock.mockRejectedValue(new Error("Network error"))],
			["an unknown body", () => fetchMock.mockResolvedValue(ok({ invalid: "data" }))],
			[
				"an invalid organization",
				() => fetchMock.mockResolvedValue(ok({ organization: { version: 2 }, user: USER })),
			],
			["an invalid user", () => fetchMock.mockResolvedValue(ok({ organization: ORG, user: { version: 2 } }))],
		])("keeps the current settings after %s", async (_name, arrange) => {
			await makeService({ org: ORG, user: USER })
			arrange()

			expect(await refresh()).toBe(false)

			expect(service.getSettings()).toEqual(ORG)
			expect(service.getUserSettings()).toEqual(USER)
			expect(context.globalState.update).not.toHaveBeenCalled()
		})

		// Since #126 a provider profile keeps its settings under a nested
		// `provider`; a payload on the old flat shape failed the whole blob.
		it("accepts organization provider profiles in the nested shape", async () => {
			await makeService()
			const org = {
				...ORG,
				version: 2,
				providerProfiles: {
					default: {
						id: "default",
						provider: { providerId: "anthropic", opaqueLegacyPayload: { apiModelId: "claude-3-opus" } },
					},
				},
			}
			fetchMock.mockResolvedValue(ok({ organization: org, user: USER }))

			expect(await refresh()).toBe(true)
			expect(service.getSettings()).toEqual(org)
		})
	})

	describe("updateUserSettings", () => {
		const update = () => service.updateUserSettings({ taskSyncEnabled: true })

		it("patches with the cached version and adopts a newer answer", async () => {
			await makeService({ user: USER })
			const updated = vi.fn()
			service.on("settings-updated", updated)
			const newer = { ...USER, settings: { taskSyncEnabled: true }, version: 2 }
			fetchMock.mockResolvedValue(ok(newer))

			expect(await update()).toBe(true)

			const [url, options] = fetchMock.mock.calls[0]!
			expect(url).toBe("http://localhost:8080/api/user-settings")
			expect(options.method).toBe("PATCH")
			expect(options.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer valid-token" })
			expect(options.signal).toBeInstanceOf(AbortSignal)
			expect(JSON.parse(options.body)).toEqual({ settings: { taskSyncEnabled: true }, version: 1 })
			expect(service.getUserSettings()).toEqual(newer)
			expect(cache.get("user-settings")).toEqual(newer)
			expect(updated).toHaveBeenCalledTimes(1)
		})

		it("sends no version without cached settings, and adopts any answer", async () => {
			await makeService()
			fetchMock.mockResolvedValue(ok(USER))

			expect(await update()).toBe(true)

			expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ settings: { taskSyncEnabled: true } })
			expect(service.getUserSettings()).toEqual(USER)
		})

		it("keeps the cached settings when the answer is not newer", async () => {
			await makeService({ user: { ...USER, version: 3 } })
			const updated = vi.fn()
			service.on("settings-updated", updated)
			fetchMock.mockResolvedValue(ok({ ...USER, version: 3 }))

			expect(await update()).toBe(true)

			expect(updated).not.toHaveBeenCalled()
			expect(service.getUserSettings()?.version).toBe(3)
		})

		it("does not send without a session token", async () => {
			authService.getSessionToken.mockReturnValue(null)
			await makeService()

			expect(await update()).toBe(false)
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it.each([
			["a version conflict", () => fetchMock.mockResolvedValue(refused(409)), "Version conflict"],
			["a refusal", () => fetchMock.mockResolvedValue(refused(500)), "Failed to update user settings"],
			["an invalid answer", () => fetchMock.mockResolvedValue(ok({ version: 2 })), "Invalid user settings"],
			["a network error", () => fetchMock.mockRejectedValue(new Error("down")), "Error updating user settings"],
		])("reports failure after %s", async (_name, arrange, logged) => {
			await makeService({ user: USER })
			arrange()

			expect(await update()).toBe(false)

			expect(service.getUserSettings()).toEqual(USER)
			expect(log.mock.calls.map(([line]) => String(line)).join("\n")).toContain(logged)
		})
	})

	it.each([
		[
			"the organization's recordTaskMessages",
			"org-1",
			{ recordTaskMessages: true },
			{ taskSyncEnabled: false },
			true,
		],
		["the organization over the user", "org-1", { recordTaskMessages: false }, { taskSyncEnabled: true }, false],
		["false for an organization that says nothing", "org-1", undefined, { taskSyncEnabled: true }, false],
		["the user's taskSyncEnabled", null, undefined, { taskSyncEnabled: false }, false],
		["true for a user who says nothing", null, undefined, {}, true],
		["false without any settings", null, undefined, undefined, false],
	])("isTaskSyncEnabled follows %s", async (_name, orgId, cloudSettings, userSettings, expected) => {
		authService.getStoredOrganizationId.mockReturnValue(orgId)
		await makeService({
			org: { ...ORG, ...(cloudSettings ? { cloudSettings } : {}) },
			user: userSettings ? { ...USER, settings: userSettings } : undefined,
		})

		expect(service.isTaskSyncEnabled()).toBe(expected)
	})

	it("stops the refresh timer on dispose", async () => {
		await makeService()

		service.dispose()

		expect(timer.stop).toHaveBeenCalled()
	})
})
