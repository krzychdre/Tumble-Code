import { act } from "react"

import { render, screen } from "@/utils/test-utils"

import { BlockTimestamp } from "../BlockTimestamp"

// Deterministic, locale-independent formatting for assertions.
vi.mock("@src/utils/format", () => ({
	formatTimestamp: (ts: number) => `T(${ts})`,
	formatDuration: (ms: number) => `D(${ms})`,
}))

describe("BlockTimestamp", () => {
	it("renders the start timestamp when only startTs is given", () => {
		render(<BlockTimestamp startTs={1000} />)

		expect(screen.getByText("T(1000)")).toBeInTheDocument()
		expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
	})

	it("renders both start time and duration when endTs is given", () => {
		render(<BlockTimestamp startTs={1000} endTs={4500} />)

		expect(screen.getByText("T(1000)")).toBeInTheDocument()
		// Duration is endTs - startTs = 3500
		expect(screen.getByText("D(3500)")).toBeInTheDocument()
	})

	it("does not render a duration when endTs is not after startTs", () => {
		render(<BlockTimestamp startTs={4000} endTs={4000} />)

		expect(screen.getByText("T(4000)")).toBeInTheDocument()
		expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
	})

	it("uses the muted description-foreground token for non-intrusive styling", () => {
		render(<BlockTimestamp startTs={1000} />)

		expect(screen.getByText("T(1000)").closest("span")).toHaveClass("text-vscode-descriptionForeground")
	})

	describe("live ticking", () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it("renders a live elapsed duration when live and no endTs is given", () => {
			vi.setSystemTime(new Date(2_000))
			render(<BlockTimestamp startTs={1_000} live />)

			// At mount, elapsed = 2000 - 1000 = 1000ms.
			expect(screen.getByText("D(1000)")).toBeInTheDocument()

			// Advance the fake timer; the 1 Hz interval fires and the
			// duration span re-renders with the new elapsed value.
			act(() => {
				vi.advanceTimersByTime(3_000)
			})
			// After +3s the clock is at 5000ms, elapsed = 4000ms.
			expect(screen.getByText("D(4000)")).toBeInTheDocument()
		})

		it("does not tick when endTs is already set (renders the static final duration)", () => {
			vi.setSystemTime(new Date(99_999_999))
			render(<BlockTimestamp startTs={1_000} endTs={3_500} live />)

			expect(screen.getByText("D(2500)")).toBeInTheDocument()

			// Advancing time must not change the rendered value.
			act(() => {
				vi.setSystemTime(new Date(99_999_999 + 5_000))
				vi.advanceTimersByTime(5_000)
			})
			expect(screen.getByText("D(2500)")).toBeInTheDocument()
		})

		it("renders no duration when live is false and endTs is absent (regression: per-item completed-todo badge)", () => {
			vi.setSystemTime(new Date(10_000))
			render(<BlockTimestamp startTs={1_000} />)

			expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()

			act(() => {
				vi.advanceTimersByTime(3_000)
			})
			expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
		})
	})
})
