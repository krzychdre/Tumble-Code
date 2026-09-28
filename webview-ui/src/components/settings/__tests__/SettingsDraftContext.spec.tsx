// D13: the Save buffer as an external store, read by the sections through
// `useSetting(key)`. Pins the buffer semantics useCachedSettings had (dirty
// flag, provider-field sync rules, merge and reset) and measures that a
// control re-renders only when its own key changes.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { act, render, renderHook } from "@testing-library/react"

import type { CachedSettings } from "../schema"
import { SettingsDraftProvider, useSetting, useSettingsDraft } from "../SettingsDraftContext"
import { createSettingsDraftStore } from "../settingsDraftStore"

const seed = (initial: Partial<CachedSettings> = {}) => createSettingsDraftStore(initial as CachedSettings)

describe("createSettingsDraftStore", () => {
	it("setField writes the buffer, marks it dirty and notifies once", () => {
		const store = seed({ soundEnabled: false })
		const listener = vi.fn()
		store.subscribe(listener)

		store.setField("soundEnabled", true)

		expect(store.getState().soundEnabled).toBe(true)
		expect(store.isDirty()).toBe(true)
		expect(listener).toHaveBeenCalledTimes(1)
	})

	it("setField with an equal value (per the schema row) is a no-op", () => {
		const store = seed({ soundEnabled: false, allowedCommands: ["ls"] })
		const before = store.getState()
		const listener = vi.fn()
		store.subscribe(listener)

		store.setField("soundEnabled", false)

		expect(store.getState()).toBe(before)
		expect(store.isDirty()).toBe(false)
		expect(listener).not.toHaveBeenCalled()
	})

	it("keeps the identity of the keys that were not written", () => {
		const commands = ["ls"]
		const store = seed({ allowedCommands: commands, soundEnabled: false })

		store.setField("soundEnabled", true)

		expect(store.getState().allowedCommands).toBe(commands)
	})

	it("setApiConfigurationField: an automatic first fill does not mark the buffer dirty, a user edit does", () => {
		const store = seed({ apiConfiguration: { apiProvider: "anthropic" } })

		store.setApiConfigurationField("apiModelId", "model-a", false)
		expect(store.getState().apiConfiguration?.apiModelId).toBe("model-a")
		expect(store.isDirty()).toBe(false)

		store.setApiConfigurationField("apiModelId", "model-b", false)
		expect(store.isDirty()).toBe(true)
	})

	it("setApiConfigurationField: a user action marks the buffer dirty; an equal value is a no-op", () => {
		const store = seed({ apiConfiguration: { apiProvider: "anthropic", apiModelId: "m" } })
		const before = store.getState()

		store.setApiConfigurationField("apiModelId", "m")
		expect(store.getState()).toBe(before)
		expect(store.isDirty()).toBe(false)

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
		const store = seed({ experiments: { runSlashCommand: false } as CachedSettings["experiments"] })

		store.setExperimentEnabled("runSlashCommand", false)
		expect(store.isDirty()).toBe(false)

		store.setExperimentEnabled("runSlashCommand", true)
		expect(store.getState().experiments?.runSlashCommand).toBe(true)
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

describe("useSetting", () => {
	const wrapperFor =
		(store: ReturnType<typeof seed>) =>
		({ children }: { children: ReactNode }) => (
			<SettingsDraftProvider value={store}>{children}</SettingsDraftProvider>
		)

	it("returns the buffered value and a setter that writes the buffer", () => {
		const store = seed({ language: "de" })
		const { result } = renderHook(() => useSetting("language"), { wrapper: wrapperFor(store) })

		expect(result.current[0]).toBe("de")
		act(() => result.current[1]("fr"))

		expect(result.current[0]).toBe("fr")
		expect(store.getState().language).toBe("fr")
		expect(store.isDirty()).toBe(true)
	})

	it("keeps the setter identity across renders", () => {
		const store = seed({ soundEnabled: false })
		const { result } = renderHook(() => useSetting("soundEnabled"), { wrapper: wrapperFor(store) })
		const first = result.current[1]

		act(() => first(true))

		expect(result.current[1]).toBe(first)
	})

	it("throws outside a SettingsDraftProvider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		expect(() => renderHook(() => useSetting("language"))).toThrow(/SettingsDraftProvider/)
		expect(() => renderHook(() => useSettingsDraft())).toThrow(/SettingsDraftProvider/)
	})

	// Render measurement: controls under one provider, each reading one key.
	// `wholeBuffer` is the rejected alternative, a context whose value is the
	// whole buffer: it re-renders on every edit of any key. The per-key
	// subscription re-renders a control only when its own key changes.
	it("re-renders a control only when its own key changes", () => {
		const store = seed({ soundEnabled: false, language: "en" })
		// Counted in the component bodies: each count is one render of that probe.
		const commits: Record<string, number> = { sound: 0, language: 0, wholeBuffer: 0 }

		const WholeBufferContext = createContext<CachedSettings | undefined>(undefined)
		const WholeBufferProvider = ({ children }: { children: ReactNode }) => {
			const buffer = useSyncExternalStore(store.subscribe, store.getState)
			return <WholeBufferContext.Provider value={buffer}>{children}</WholeBufferContext.Provider>
		}
		const WholeBufferLanguage = () => {
			commits.wholeBuffer++
			return <span>{useContext(WholeBufferContext)?.language}</span>
		}

		const Sound = () => {
			commits.sound++
			const [value] = useSetting("soundEnabled")
			return <span>{String(value)}</span>
		}
		const Language = () => {
			commits.language++
			const [value] = useSetting("language")
			return <span>{value}</span>
		}

		render(
			<SettingsDraftProvider value={store}>
				<Sound />
				<Language />
				<WholeBufferProvider>
					<WholeBufferLanguage />
				</WholeBufferProvider>
			</SettingsDraftProvider>,
		)
		expect(commits).toEqual({ sound: 1, language: 1, wholeBuffer: 1 })

		// 20 edits of an unrelated key.
		for (let i = 0; i < 20; i++) {
			act(() => store.setField("soundEnabled", i % 2 === 0))
		}
		expect(commits).toEqual({ sound: 21, language: 1, wholeBuffer: 21 })

		// One edit of its own key.
		act(() => store.setField("language", "de"))
		expect(commits).toEqual({ sound: 21, language: 2, wholeBuffer: 22 })
	})
})
