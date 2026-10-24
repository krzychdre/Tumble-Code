import { fireEvent, renderHook } from "@testing-library/react"

import { getAllModes } from "@shared/modes"

import { useModeSwitchShortcuts } from "../useModeSwitchShortcuts"

const slugs = getAllModes(undefined).map((mode) => mode.slug)

describe("useModeSwitchShortcuts", () => {
	// event.key, not event.code: on Dvorak the physical Period key types "v".
	it.each([
		["Ctrl+.", { key: ".", ctrlKey: true }, slugs[1]],
		["Cmd+.", { key: ".", metaKey: true }, slugs[1]],
		[
			"Ctrl+Shift+. from the first mode wraps to the last",
			{ key: ".", ctrlKey: true, shiftKey: true },
			slugs.at(-1),
		],
		["Ctrl+v on the physical Period key", { key: "v", code: "Period", ctrlKey: true }, undefined],
		[". without a modifier", { key: "." }, undefined],
	])("%s switches to %s", (_name, init, target) => {
		const switchToMode = vi.fn()
		renderHook(() => useModeSwitchShortcuts(slugs[0], undefined, switchToMode))

		const notPrevented = fireEvent.keyDown(window, init)

		expect(switchToMode.mock.calls).toEqual(target ? [[target]] : [])
		expect(notPrevented).toBe(target === undefined)
	})

	it("counts custom modes in the cycle", () => {
		const switchToMode = vi.fn()
		const custom = [{ slug: "reviewer", name: "Reviewer", roleDefinition: "r", groups: [] }]
		renderHook(() => useModeSwitchShortcuts(slugs.at(-1)!, custom as never, switchToMode))

		fireEvent.keyDown(window, { key: ".", ctrlKey: true })

		expect(switchToMode).toHaveBeenCalledWith("reviewer")
	})
})
