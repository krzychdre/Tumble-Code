import { renderHook } from "@testing-library/react"

import { useStableCallback } from "../useStableCallback"

describe("useStableCallback", () => {
	it("keeps the same identity across renders", () => {
		const { result, rerender } = renderHook(({ value }) => useStableCallback(() => value), {
			initialProps: { value: 1 },
		})
		const first = result.current

		rerender({ value: 2 })

		expect(result.current).toBe(first)
	})

	it("calls the callback from the latest render with the given arguments", () => {
		const { result, rerender } = renderHook(
			({ offset }) => useStableCallback((a: number, b: number) => a + b + offset),
			{ initialProps: { offset: 0 } },
		)

		rerender({ offset: 100 })

		expect(result.current(1, 2)).toBe(103)
	})
})
