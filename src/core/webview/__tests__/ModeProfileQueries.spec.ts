import type { ProviderSettingsEntry } from "@tumble-code/types"
import { ModeProfileQueries, type ModeProfileQueriesHost } from "../ModeProfileQueries"
import type { ProviderState } from "../ProviderStateBuilder"

const entries: ProviderSettingsEntry[] = [
	{ name: "default", id: "id-1", apiProvider: "anthropic" },
	{ name: "second", id: "id-2", apiProvider: "openrouter" },
]

function makeHost(overrides: Partial<ModeProfileQueriesHost> = {}): {
	host: ModeProfileQueriesHost
	values: { currentApiConfigName?: string; listApiConfigMeta?: typeof entries }
	setValues: ReturnType<typeof vi.fn>
	postStateToWebview: ReturnType<typeof vi.fn>
} {
	const values: { currentApiConfigName?: string; listApiConfigMeta?: typeof entries } = {
		currentApiConfigName: "default",
		listApiConfigMeta: entries as any,
	}
	const setValues = vi.fn()
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const state = {
		mode: "code",
		currentApiConfigName: "default",
		listApiConfigMeta: entries,
	} as ProviderState
	const host: ModeProfileQueriesHost = {
		getCustomModes: vi.fn().mockResolvedValue([{ slug: "custom", name: "Custom" }]),
		getState: vi.fn().mockResolvedValue(state),
		setValues,
		contextProxy: {
			getValues: () => values as any,
			setValues: setValues as any,
		},
		postStateToWebview,
		...overrides,
	}
	return { host, values, setValues, postStateToWebview }
}

describe("ModeProfileQueries", () => {
	test("getModes merges default and custom modes, reduced to slug/name", async () => {
		const { host } = makeHost()
		const modes = await new ModeProfileQueries(host).getModes()
		const custom = modes.find((m) => m.slug === "custom")
		expect(custom).toEqual({ slug: "custom", name: "Custom" })
		expect(modes.length).toBeGreaterThan(1)
		expect(Object.keys(modes[0]).sort()).toEqual(["name", "slug"])
	})

	test("getModes falls back to the built-ins when custom modes throw", async () => {
		const { host } = makeHost({ getCustomModes: vi.fn().mockRejectedValue(new Error("boom")) })
		const modes = await new ModeProfileQueries(host).getModes()
		expect(modes.length).toBeGreaterThan(0)
		expect(modes.some((m) => m.slug === "custom")).toBe(false)
	})

	test("getMode reads the current mode from the state", async () => {
		const { host } = makeHost()
		expect(await new ModeProfileQueries(host).getMode()).toBe("code")
	})

	test("setMode persists through setValues", async () => {
		const { host, setValues } = makeHost()
		await new ModeProfileQueries(host).setMode("architect")
		expect(setValues).toHaveBeenCalledWith({ mode: "architect" })
	})

	test("getProviderProfiles maps entries to name/provider", async () => {
		const { host } = makeHost()
		const profiles = await new ModeProfileQueries(host).getProviderProfiles()
		expect(profiles).toEqual([
			{ name: "default", provider: "anthropic" },
			{ name: "second", provider: "openrouter" },
		])
	})

	test("getProviderProfile reads the active profile name", async () => {
		const { host } = makeHost()
		expect(await new ModeProfileQueries(host).getProviderProfile()).toBe("default")
	})

	test("getProviderProfileEntries reads the stored metadata", () => {
		const { host } = makeHost()
		expect(new ModeProfileQueries(host).getProviderProfileEntries()).toEqual(entries)
	})

	test("getProviderProfileEntry finds by name", () => {
		const { host } = makeHost()
		expect(new ModeProfileQueries(host).getProviderProfileEntry("second")?.id).toBe("id-2")
		expect(new ModeProfileQueries(host).getProviderProfileEntry("missing")).toBeUndefined()
	})

	test("deleteProviderProfile of a non-active profile keeps the active one", async () => {
		const { host, setValues, postStateToWebview } = makeHost()
		await new ModeProfileQueries(host).deleteProviderProfile(entries[1])
		expect(setValues).toHaveBeenCalledWith(
			expect.objectContaining({ currentApiConfigName: "default", listApiConfigMeta: [entries[0]] }),
		)
		expect(postStateToWebview).toHaveBeenCalledTimes(1)
	})

	test("deleteProviderProfile of the active profile activates the next remaining one", async () => {
		const { host, setValues } = makeHost()
		await new ModeProfileQueries(host).deleteProviderProfile(entries[0])
		expect(setValues).toHaveBeenCalledWith(
			expect.objectContaining({ currentApiConfigName: "second", listApiConfigMeta: [entries[1]] }),
		)
	})

	test("deleteProviderProfile refuses to delete the last profile", async () => {
		const { host, setValues } = makeHost()
		host.contextProxy.getValues = () =>
			({ currentApiConfigName: "default", listApiConfigMeta: [entries[0]] }) as any
		await expect(new ModeProfileQueries(host).deleteProviderProfile(entries[0])).rejects.toThrow(
			"You cannot delete the last profile",
		)
		expect(setValues).not.toHaveBeenCalled()
	})
})
