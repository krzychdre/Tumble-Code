import { act, renderHook } from "@testing-library/react"

import type { ModeConfig } from "@roo-code/types"

import { useModeSelection } from "../useModeSelection"

vi.mock("@roo/modes", () => ({
	getAllModes: (customModes?: ModeConfig[]) => [
		{ slug: "code", name: "Code", roleDefinition: "", groups: [] },
		{ slug: "architect", name: "Architect", roleDefinition: "", groups: [] },
		...(customModes ?? []),
	],
}))

const customMode = { slug: "custom-mode", name: "Custom Mode", roleDefinition: "", groups: [] } as ModeConfig

describe("useModeSelection", () => {
	it("lists built-in and custom modes as slug and name only", () => {
		const { result } = renderHook(() => useModeSelection([customMode]))

		expect(result.current.availableModes).toEqual([
			{ slug: "code", name: "Code" },
			{ slug: "architect", name: "Architect" },
			{ slug: "custom-mode", name: "Custom Mode" },
		])
	})

	it("starts on 'Any mode' with nothing selected, which means no mode restriction", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		expect(result.current.isAnyMode).toBe(true)
		expect(result.current.selectedModes).toEqual([])
		expect(result.current.modeSlugs).toBeUndefined()
	})

	it("selecting a specific mode clears 'Any mode'", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		act(() => result.current.toggleMode("code", true))
		act(() => result.current.toggleMode("architect", true))

		expect(result.current.isAnyMode).toBe(false)
		expect(result.current.selectedModes).toEqual(["code", "architect"])
		expect(result.current.modeSlugs).toEqual(["code", "architect"])
	})

	it("selecting a mode twice does not list it twice", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		act(() => result.current.toggleMode("code", true))
		act(() => result.current.toggleMode("code", true))

		expect(result.current.selectedModes).toEqual(["code"])
	})

	it("unchecking the last specific mode falls back to 'Any mode'", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		act(() => result.current.toggleMode("code", true))
		act(() => result.current.toggleMode("architect", true))
		act(() => result.current.toggleMode("code", false))

		expect(result.current.isAnyMode).toBe(false)
		expect(result.current.selectedModes).toEqual(["architect"])

		act(() => result.current.toggleMode("architect", false))

		expect(result.current.isAnyMode).toBe(true)
		expect(result.current.selectedModes).toEqual([])
		expect(result.current.modeSlugs).toBeUndefined()
	})

	it("checking 'Any mode' drops the specific modes", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		act(() => result.current.toggleMode("code", true))
		act(() => result.current.toggleAnyMode(true))

		expect(result.current.isAnyMode).toBe(true)
		expect(result.current.selectedModes).toEqual([])
		expect(result.current.modeSlugs).toBeUndefined()
	})

	it("unchecking 'Any mode' with nothing selected still means no restriction", () => {
		const { result } = renderHook(() => useModeSelection(undefined))

		act(() => result.current.toggleAnyMode(false))

		expect(result.current.isAnyMode).toBe(false)
		expect(result.current.selectedModes).toEqual([])
		expect(result.current.modeSlugs).toBeUndefined()
	})

	it("reset seeds the selection from a skill's modes, or back to 'Any mode' without them", () => {
		const { result } = renderHook(() => useModeSelection(undefined))
		const seed = ["architect"]

		act(() => result.current.reset(seed))

		expect(result.current.isAnyMode).toBe(false)
		expect(result.current.selectedModes).toEqual(["architect"])

		// The seed array is copied, so toggling never mutates the caller's data.
		act(() => result.current.toggleMode("code", true))
		expect(seed).toEqual(["architect"])

		act(() => result.current.reset([]))
		expect(result.current.isAnyMode).toBe(true)
		expect(result.current.selectedModes).toEqual([])

		act(() => result.current.toggleMode("code", true))
		act(() => result.current.reset())
		expect(result.current.isAnyMode).toBe(true)
		expect(result.current.selectedModes).toEqual([])
	})
})
