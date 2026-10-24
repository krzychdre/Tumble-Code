// The Save buffer of the Settings view (the cachedState rule of AGENTS.md):
// dirty flag, provider-field sync rules, merge and reset, and the scopes
// (Settings tabs) that hold unsaved edits (§2.10).

import type { CachedSettings } from "../schema"
import { createSettingsDraftStore } from "../settingsDraftStore"

const seed = (initial: Partial<CachedSettings> = {}) => createSettingsDraftStore(initial as CachedSettings)
const scopes = (store: ReturnType<typeof seed>) => [...store.getDirtyScopes()].sort()

describe("createSettingsDraftStore", () => {
	it("setField writes the buffer, marks it dirty, notifies once and keeps the other keys' identity", () => {
		const commands = ["ls"]
		const store = seed({ soundEnabled: false, allowedCommands: commands })
		const listener = vi.fn()
		store.subscribe(listener)

		store.setField("soundEnabled", true)

		expect(store.getState().soundEnabled).toBe(true)
		expect(store.getState().allowedCommands).toBe(commands)
		expect(store.isDirty()).toBe(true)
		expect(listener).toHaveBeenCalledTimes(1)
	})

	it("ignores writes that change nothing: an equal field, a clean setDirty(false), an unchanged experiment", () => {
		const store = seed({ soundEnabled: false, experiments: { preventFocusDisruption: false } as never })
		const before = store.getState()
		const listener = vi.fn()
		const unsubscribe = store.subscribe(listener)

		store.setField("soundEnabled", false)
		store.setDirty(false)
		store.setExperimentEnabled("preventFocusDisruption", false)

		expect(store.getState()).toBe(before)
		expect(store.isDirty()).toBe(false)
		expect(listener).not.toHaveBeenCalled()

		unsubscribe()
		store.setField("soundEnabled", true)
		expect(listener).not.toHaveBeenCalled()
	})

	// A provider form fills its own defaults on mount with isUserAction=false;
	// that must not enable Save or raise the discard dialog.
	it.each([
		["an empty string", ""],
		["undefined", undefined],
		["null", null],
	])("setApiConfigurationField: an automatic fill from %s is not an edit", (_, previous) => {
		const store = seed({ apiConfiguration: { apiProvider: "openai", apiModelId: previous as never } })

		store.setApiConfigurationField("apiModelId", "default-model", false)

		expect(store.getState().apiConfiguration?.apiModelId).toBe("default-model")
		expect(store.isDirty()).toBe(false)
	})

	it("setApiConfigurationField: an automatic sync of an equal value is not an edit, a changed value is", () => {
		const store = seed({
			apiConfiguration: { apiProvider: "openai", openAiHeaders: { a: "1" }, apiModelId: null as never },
		})

		store.setApiConfigurationField("openAiHeaders", { a: "1" }, false)
		store.setApiConfigurationField("apiModelId", undefined, false)
		expect(store.isDirty()).toBe(false)

		store.setApiConfigurationField("openAiHeaders", { a: "2" }, false)
		expect(store.isDirty()).toBe(true)
	})

	it("setApiConfigurationField: a user action is an edit, an identical value is a no-op", () => {
		const store = seed({ apiConfiguration: { apiProvider: "anthropic", apiModelId: "m" } })
		const before = store.getState()

		store.setApiConfigurationField("apiModelId", "m")
		expect(store.getState()).toBe(before)

		store.setApiConfigurationField("apiModelId", "n")
		expect(store.isDirty()).toBe(true)
	})

	it("setApiConfigurationField: an automatic sync never clears a dirty buffer", () => {
		const store = seed({ apiConfiguration: { apiProvider: "anthropic" } })
		store.setField("soundEnabled", true)

		store.setApiConfigurationField("apiModelId", "auto", false)

		expect(store.isDirty()).toBe(true)
	})

	it("setExperimentEnabled writes one flag and marks the buffer dirty", () => {
		const store = seed({ experiments: { preventFocusDisruption: false } as never })

		store.setExperimentEnabled("preventFocusDisruption", true)

		expect(store.getState().experiments?.preventFocusDisruption).toBe(true)
		expect(store.isDirty()).toBe(true)
	})

	it("mergeFromState keeps absent keys, takes present ones and clears the dirty flag", () => {
		const store = seed({ soundEnabled: true, language: "de" })
		store.setField("soundVolume", 0.3)

		store.mergeFromState({ language: "fr", clineMessages: [] })

		expect(store.getState()).toEqual({ soundEnabled: true, soundVolume: 0.3, language: "fr" })
		expect(store.isDirty()).toBe(false)
	})

	it("resetToState throws the edits away", () => {
		const store = seed({ soundEnabled: false })
		store.setField("soundEnabled", true)

		store.resetToState({ soundEnabled: false, language: "en" })

		expect(store.getState()).toEqual({ soundEnabled: false, language: "en" })
		expect(store.isDirty()).toBe(false)
	})
})

describe("SettingsDraftStore dirty scopes", () => {
	it("records the scope of every kind of edit, and none for writes that are no edit", () => {
		const store = seed({ soundEnabled: false, webToolsEnabled: false, apiConfiguration: {}, experiments: {} })
		expect(scopes(store)).toEqual([])

		store.setScope("notifications")
		store.setField("soundEnabled", false)
		store.setScope("providers")
		store.setApiConfigurationField("apiModelId", "claude-x", false)
		expect(scopes(store)).toEqual([])

		store.setApiConfigurationField("apiModelId", "claude-y")
		store.setScope("web")
		store.setField("webToolsEnabled", true)
		store.setScope("experimental")
		store.setExperimentEnabled("customTools", true)
		store.setScope("terminal")
		store.setDirty(true)

		expect(scopes(store)).toEqual(["experimental", "providers", "terminal", "web"])
	})

	it("does not mark the scope of a provider form syncing its defaults while another tab is dirty", () => {
		const store = seed({ soundEnabled: false, apiConfiguration: {} })
		store.setScope("notifications")
		store.setField("soundEnabled", true)

		store.setScope("providers")
		store.setApiConfigurationField("apiModelId", "claude-x", false)

		expect(scopes(store)).toEqual(["notifications"])
	})

	it("clears every scope on Save, merge and discard", () => {
		const store = seed({ soundEnabled: false })
		const edit = () => {
			store.setScope("notifications")
			store.setField("soundEnabled", !store.getState().soundEnabled)
		}

		edit()
		store.setDirty(false)
		expect(scopes(store)).toEqual([])

		edit()
		store.mergeFromState({})
		expect(scopes(store)).toEqual([])

		edit()
		store.resetToState({ soundEnabled: false })
		expect(scopes(store)).toEqual([])
	})

	it("keeps the scope snapshot's identity while it does not change (useSyncExternalStore)", () => {
		const store = seed({ soundEnabled: false })
		store.setScope("notifications")
		store.setField("soundEnabled", true)
		const first = store.getDirtyScopes()

		store.setField("soundEnabled", false)

		expect(store.getDirtyScopes()).toBe(first)
	})
})
