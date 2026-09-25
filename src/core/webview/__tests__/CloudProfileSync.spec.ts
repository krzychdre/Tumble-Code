// pnpm --filter tumble-code test core/webview/__tests__/CloudProfileSync.spec.ts

import { EventEmitter } from "events"

import { CloudProfileSync, type CloudProfileSyncHost } from "../CloudProfileSync"

const cloud = vi.hoisted(() => ({ hasInstance: true, instance: undefined as any }))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: () => cloud.hasInstance,
		get instance() {
			return cloud.instance
		},
	},
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const makeCloud = (authenticated: boolean, providerProfiles?: Record<string, unknown>) =>
	Object.assign(new EventEmitter(), {
		isAuthenticated: vi.fn().mockReturnValue(authenticated),
		getOrganizationSettings: vi.fn().mockReturnValue(providerProfiles ? { providerProfiles } : {}),
	})

const makeHost = (
	syncResult: { hasChanges: boolean; activeProfileChanged: boolean; activeProfileId?: string } = {
		hasChanges: false,
		activeProfileChanged: false,
	},
) => {
	const values: Record<string, unknown> = { currentApiConfigName: "local-profile" }
	const host = {
		contextProxy: {
			getValue: vi.fn((key: string) => values[key]),
			setValue: vi.fn(async (key: string, value: unknown) => {
				values[key] = value
			}),
		},
		providerSettingsManager: {
			syncCloudProfiles: vi.fn().mockResolvedValue(syncResult),
			listConfig: vi.fn().mockResolvedValue([{ name: "cloud-profile", id: "cloud-id" }]),
			getProfile: vi.fn().mockResolvedValue({ name: "cloud-profile", id: "cloud-id" }),
		},
		activateProviderProfile: vi.fn().mockResolvedValue(undefined),
		postStateToWebviewWithoutClineMessages: vi.fn().mockResolvedValue(undefined),
		log: vi.fn(),
	}
	return { host, values, typed: host as unknown as CloudProfileSyncHost }
}

describe("CloudProfileSync", () => {
	beforeEach(() => {
		cloud.hasInstance = true
		cloud.instance = makeCloud(false, { p: { apiProvider: "anthropic" } })
	})

	describe("initializeWhenReady", () => {
		it("subscribes once, however often it is called", async () => {
			const { typed } = makeHost()
			const sync = new CloudProfileSync(typed)
			await sync.initializeWhenReady()
			await sync.initializeWhenReady()
			expect(cloud.instance.listenerCount("settings-updated")).toBe(1)
		})

		it("syncs right away only when signed in", async () => {
			const { host, typed } = makeHost()
			await new CloudProfileSync(typed).initializeWhenReady()
			expect(host.providerSettingsManager.syncCloudProfiles).not.toHaveBeenCalled()

			cloud.instance = makeCloud(true, { p: { apiProvider: "anthropic" } })
			await new CloudProfileSync(typed).initializeWhenReady()
			expect(host.providerSettingsManager.syncCloudProfiles).toHaveBeenCalledWith(
				{ p: { apiProvider: "anthropic" } },
				"local-profile",
			)
		})

		it("does nothing without a CloudService", async () => {
			cloud.hasInstance = false
			const { host, typed } = makeHost()
			await new CloudProfileSync(typed).initializeWhenReady()
			expect(cloud.instance.listenerCount("settings-updated")).toBe(0)
			expect(host.log).not.toHaveBeenCalled()
		})

		it("logs instead of throwing when the CloudService misbehaves", async () => {
			cloud.instance = { isAuthenticated: () => false }
			const { host, typed } = makeHost()
			await expect(new CloudProfileSync(typed).initializeWhenReady()).resolves.toBeUndefined()
			expect(host.log).toHaveBeenCalledWith(
				expect.stringContaining("Failed to initialize cloud profile sync when ready: TypeError"),
			)
		})
	})

	describe("sync", () => {
		it("with changes: stores the new list, activates the new active profile, posts state", async () => {
			const { host, values, typed } = makeHost({
				hasChanges: true,
				activeProfileChanged: true,
				activeProfileId: "cloud-id",
			})
			await new CloudProfileSync(typed).sync()
			expect(values.listApiConfigMeta).toEqual([{ name: "cloud-profile", id: "cloud-id" }])
			expect(host.providerSettingsManager.getProfile).toHaveBeenCalledWith({ id: "cloud-id" })
			expect(host.activateProviderProfile).toHaveBeenCalledWith({ name: "cloud-profile" })
			expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(1)
		})

		it("without changes: touches nothing", async () => {
			const { host, typed } = makeHost()
			await new CloudProfileSync(typed).sync()
			expect(host.contextProxy.setValue).not.toHaveBeenCalled()
			expect(host.activateProviderProfile).not.toHaveBeenCalled()
			expect(host.postStateToWebviewWithoutClineMessages).not.toHaveBeenCalled()
		})

		it("without provider profiles in the organization settings: does not call the settings manager", async () => {
			cloud.instance = makeCloud(true)
			const { host, typed } = makeHost({ hasChanges: true, activeProfileChanged: false })
			await new CloudProfileSync(typed).sync()
			expect(host.providerSettingsManager.syncCloudProfiles).not.toHaveBeenCalled()
		})

		it("logs a failure instead of throwing", async () => {
			const { host, typed } = makeHost()
			host.providerSettingsManager.syncCloudProfiles.mockRejectedValue(new Error("boom"))
			await expect(new CloudProfileSync(typed).sync()).resolves.toBeUndefined()
			expect(host.log).toHaveBeenCalledWith("Error syncing cloud profiles: Error: boom")
		})
	})

	it("a settings-updated event runs a sync", async () => {
		const { host, typed } = makeHost({ hasChanges: true, activeProfileChanged: false })
		await new CloudProfileSync(typed).initializeWhenReady()
		cloud.instance.emit("settings-updated")
		await flush()
		expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(1)
	})

	it("dispose unsubscribes and is safe without a CloudService", async () => {
		const { typed } = makeHost()
		const sync = new CloudProfileSync(typed)
		await sync.initializeWhenReady()
		sync.dispose()
		expect(cloud.instance.listenerCount("settings-updated")).toBe(0)

		cloud.hasInstance = false
		expect(() => sync.dispose()).not.toThrow()
	})
})
