import { StrictMode } from "react"
import { renderHook } from "@testing-library/react"

import { useDebounceEffect } from "../useDebounceEffect"

type Props = { effect: () => void; delay: number; deps: unknown[] }

function setup(initial: Props, options: { strict?: boolean } = {}) {
	return renderHook(({ effect, delay, deps }: Props) => useDebounceEffect(effect, delay, deps), {
		initialProps: initial,
		wrapper: options.strict ? StrictMode : undefined,
	})
}

describe("useDebounceEffect", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("runs the effect once, after the delay", () => {
		const effect = vi.fn()
		setup({ effect, delay: 100, deps: ["a"] })

		vi.advanceTimersByTime(99)
		expect(effect).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(effect).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(1000)
		expect(effect).toHaveBeenCalledTimes(1)
	})

	it("does not restart the timer when a render passes equal deps in a new array", () => {
		const effect = vi.fn()
		const { rerender } = setup({ effect, delay: 100, deps: ["a", 1] })

		vi.advanceTimersByTime(60)
		rerender({ effect, delay: 100, deps: ["a", 1] })
		vi.advanceTimersByTime(40)
		expect(effect).toHaveBeenCalledTimes(1)
	})

	it("restarts the timer when one of the deps changes, and runs only once", () => {
		const effect = vi.fn()
		const { rerender } = setup({ effect, delay: 100, deps: ["a", 1] })

		vi.advanceTimersByTime(60)
		rerender({ effect, delay: 100, deps: ["a", 2] })
		vi.advanceTimersByTime(60)
		expect(effect).not.toHaveBeenCalled()
		vi.advanceTimersByTime(40)
		expect(effect).toHaveBeenCalledTimes(1)
	})

	it("restarts the timer when the delay changes", () => {
		const effect = vi.fn()
		const { rerender } = setup({ effect, delay: 100, deps: ["a"] })

		vi.advanceTimersByTime(60)
		rerender({ effect, delay: 200, deps: ["a"] })
		vi.advanceTimersByTime(199)
		expect(effect).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(effect).toHaveBeenCalledTimes(1)
	})

	it("runs the latest effect without rescheduling when only the effect function changes", () => {
		const first = vi.fn()
		const latest = vi.fn()
		const { rerender } = setup({ effect: first, delay: 100, deps: ["a"] })

		vi.advanceTimersByTime(60)
		rerender({ effect: latest, delay: 100, deps: ["a"] })
		vi.advanceTimersByTime(40)
		expect(first).not.toHaveBeenCalled()
		expect(latest).toHaveBeenCalledTimes(1)
	})

	it("cancels the pending call on unmount", () => {
		const effect = vi.fn()
		const { unmount } = setup({ effect, delay: 100, deps: ["a"] })

		unmount()
		vi.advanceTimersByTime(1000)
		expect(effect).not.toHaveBeenCalled()
	})

	it("still runs once under StrictMode, which mounts effects twice", () => {
		const effect = vi.fn()
		const { rerender } = setup({ effect, delay: 100, deps: ["a"] }, { strict: true })

		vi.advanceTimersByTime(100)
		expect(effect).toHaveBeenCalledTimes(1)

		rerender({ effect, delay: 100, deps: ["b"] })
		vi.advanceTimersByTime(100)
		expect(effect).toHaveBeenCalledTimes(2)
	})
})
