import { renderHook } from "@testing-library/react"

import { useEscapeKey } from "../useEscapeKey"

const press = (key: string) => {
	const event = new KeyboardEvent("keydown", { key, cancelable: true })
	const stopPropagation = vi.spyOn(event, "stopPropagation")
	window.dispatchEvent(event)
	return { prevented: event.defaultPrevented, stopped: stopPropagation.mock.calls.length > 0 }
}

describe("useEscapeKey", () => {
	it.each([
		{ key: "Escape", isOpen: true, handled: true },
		{ key: "Escape", isOpen: false, handled: false },
		{ key: "Enter", isOpen: true, handled: false },
	])("$key while open=$isOpen: handled=$handled", ({ key, isOpen, handled }) => {
		const onEscape = vi.fn()
		renderHook(() => useEscapeKey(isOpen, onEscape))

		expect(press(key)).toEqual({ prevented: handled, stopped: handled })
		expect(onEscape).toHaveBeenCalledTimes(handled ? 1 : 0)
	})

	it("follows isOpen and the latest callback, and stops listening on unmount", () => {
		const first = vi.fn()
		const second = vi.fn()
		const { rerender, unmount } = renderHook(({ isOpen, onEscape }) => useEscapeKey(isOpen, onEscape), {
			initialProps: { isOpen: false, onEscape: first },
		})

		rerender({ isOpen: true, onEscape: second })
		press("Escape")
		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)

		unmount()
		press("Escape")
		expect(second).toHaveBeenCalledTimes(1)
	})
})
