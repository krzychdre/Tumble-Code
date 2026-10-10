// §2.10 (ai_plans/2026-09-27_ui-modernization.md): the Save buffer remembers
// which scope (the Settings tab that was open) each unsaved edit came from, so
// the view can put a dot on every tab with unsaved edits.

import type { CachedSettings } from "../schema"
import { createSettingsDraftStore } from "../settingsDraftStore"

const initial = {
	soundEnabled: false,
	webToolsEnabled: false,
	apiConfiguration: { apiProvider: "anthropic" },
	experiments: {},
} as unknown as CachedSettings

describe("SettingsDraftStore dirty scopes", () => {
	it("starts with no dirty scope", () => {
		const store = createSettingsDraftStore(initial)
		expect([...store.getDirtyScopes()]).toEqual([])
	})

	it("records the current scope for each edit that marks the buffer dirty", () => {
		const store = createSettingsDraftStore(initial)

		store.setScope("notifications")
		store.setField("soundEnabled", true)
		store.setScope("web")
		store.setField("webToolsEnabled", true)

		expect([...store.getDirtyScopes()].sort()).toEqual(["notifications", "web"])
	})

	it("does not mark a scope for a write that is no change", () => {
		const store = createSettingsDraftStore(initial)

		store.setScope("notifications")
		store.setField("soundEnabled", false)

		expect([...store.getDirtyScopes()]).toEqual([])
	})

	it("does not mark a scope for a provider form syncing its own defaults", () => {
		const store = createSettingsDraftStore(initial)

		store.setScope("providers")
		store.setApiConfigurationField("apiModelId", "claude-x", false)
		expect([...store.getDirtyScopes()]).toEqual([])

		store.setApiConfigurationField("apiModelId", "claude-y")
		expect([...store.getDirtyScopes()]).toEqual(["providers"])
	})

	it("marks the scope for experiments and for an explicit setDirty(true)", () => {
		const store = createSettingsDraftStore(initial)

		store.setScope("experimental")
		store.setExperimentEnabled("customTools", true)
		store.setScope("terminal")
		store.setDirty(true)

		expect([...store.getDirtyScopes()].sort()).toEqual(["experimental", "terminal"])
	})

	it("clears every scope on Save, merge and discard", () => {
		const store = createSettingsDraftStore(initial)
		const dirty = () => {
			store.setScope("notifications")
			store.setField("soundEnabled", !store.getState().soundEnabled)
		}

		dirty()
		store.setDirty(false)
		expect([...store.getDirtyScopes()]).toEqual([])

		dirty()
		store.mergeFromState({})
		expect([...store.getDirtyScopes()]).toEqual([])

		dirty()
		store.resetToState({ soundEnabled: false } as never)
		expect([...store.getDirtyScopes()]).toEqual([])
	})

	it("keeps the scope snapshot's identity while it does not change (useSyncExternalStore)", () => {
		const store = createSettingsDraftStore(initial)
		store.setScope("notifications")
		store.setField("soundEnabled", true)
		const first = store.getDirtyScopes()

		store.setField("soundEnabled", false) // same scope, still dirty
		expect(store.getDirtyScopes()).toBe(first)
	})
})
