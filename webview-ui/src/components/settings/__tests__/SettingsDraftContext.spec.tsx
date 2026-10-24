// D13: the sections read the Save buffer through `useSetting(key)`; a control
// re-renders only when its own key changes. The buffer itself: settingsDraftStore.spec.ts.

import type { ReactNode } from "react"
import { act, render, renderHook } from "@testing-library/react"

import type { CachedSettings } from "../schema"
import { SettingsDraftProvider, useSetting, useSettingsDraft } from "../SettingsDraftContext"
import { createSettingsDraftStore } from "../settingsDraftStore"

const seed = (initial: Partial<CachedSettings> = {}) => createSettingsDraftStore(initial as CachedSettings)

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

	it("re-renders a control only when its own key changes", () => {
		const store = seed({ soundEnabled: false, language: "en" })
		const renders = { sound: 0, language: 0 }
		const Sound = () => {
			renders.sound++
			const [value] = useSetting("soundEnabled")
			return <span>{String(value)}</span>
		}
		const Language = () => {
			renders.language++
			const [value] = useSetting("language")
			return <span>{value}</span>
		}

		render(
			<SettingsDraftProvider value={store}>
				<Sound />
				<Language />
			</SettingsDraftProvider>,
		)
		act(() => store.setField("soundEnabled", true))
		act(() => store.setField("soundEnabled", false))
		expect(renders).toEqual({ sound: 3, language: 1 })

		act(() => store.setField("language", "de"))
		expect(renders).toEqual({ sound: 3, language: 2 })
	})
})
