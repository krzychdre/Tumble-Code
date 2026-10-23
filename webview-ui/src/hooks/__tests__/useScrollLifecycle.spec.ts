import { act, renderHook } from "@testing-library/react"
import type { VirtuosoHandle } from "react-virtuoso"

import { useScrollLifecycle } from "../useScrollLifecycle"

const setup = () => {
	const scrollToIndex = vi.fn()
	const virtuosoRef = { current: { scrollToIndex } as unknown as VirtuosoHandle }
	const scrollContainerRef = { current: document.createElement("div") }
	const { result } = renderHook(() =>
		useScrollLifecycle({
			virtuosoRef,
			scrollContainerRef,
			taskTs: 1,
			isStreaming: false,
			isHidden: false,
			hasTask: true,
		}),
	)
	const behaviours = () => scrollToIndex.mock.calls.map(([options]) => options.behavior)
	return { result, behaviours }
}

describe("useScrollLifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("a task that is not at the bottom when hydration ends scrolls once more, then anchors", () => {
		const { result, behaviours } = setup()
		expect(behaviours()).toEqual(["auto"])
		expect(result.current.scrollPhaseRef.current).toBe("HYDRATING_PINNED_TO_BOTTOM")

		act(() => vi.advanceTimersByTime(600))
		expect(behaviours()).toEqual(["auto", "auto"])
		expect(result.current.scrollPhaseRef.current).toBe("HYDRATING_PINNED_TO_BOTTOM")

		act(() => vi.advanceTimersByTime(160))
		expect(behaviours()).toEqual(["auto", "auto"])
		expect(result.current.scrollPhaseRef.current).toBe("ANCHORED_FOLLOWING")
	})

	it("a taller row at the bottom scrolls smoothly once per burst", () => {
		const { result, behaviours } = setup()
		act(() => result.current.atBottomStateChangeCallback(true))
		act(() => vi.advanceTimersByTime(600))
		expect(result.current.scrollPhaseRef.current).toBe("ANCHORED_FOLLOWING")

		act(() => {
			result.current.handleRowHeightChange(true)
			result.current.handleRowHeightChange(true)
		})
		expect(behaviours().filter((b) => b === "smooth")).toHaveLength(1)

		act(() => vi.advanceTimersByTime(20))
		act(() => result.current.handleRowHeightChange(true))
		expect(behaviours().filter((b) => b === "smooth")).toHaveLength(2)
	})
})
