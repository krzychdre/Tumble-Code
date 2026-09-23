import { render } from "ink-testing-library"

import Spinner, { formatElapsed } from "../Spinner.js"

describe("formatElapsed", () => {
	it.each([
		[0, "0s"],
		[42.9, "42s"],
		[59, "59s"],
		[60, "1m 00s"],
		[976, "16m 16s"],
		[3599, "59m 59s"],
		[3600, "1h 00m"],
		[3905, "1h 05m"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatElapsed(seconds)).toBe(expected)
	})

	it("never goes negative when a start lies a moment in the future", () => {
		expect(formatElapsed(-0.4)).toBe("0s")
	})
})

describe("Spinner", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	// Real task 01a0ceed (2026-09-23, the screenshot): the turn had run 976 s,
	// and the request after the searxNcrawl crawl began at +885.0 s, so the
	// model had been thinking for 91 s of it.
	it("shows the time of the whole turn and of the current step", async () => {
		const now = new Date("2026-09-23T12:00:00Z").getTime()
		vi.setSystemTime(now)

		const { lastFrame } = render(
			<Spinner startTime={now - 976_000} stepStartTime={now - 91_000} tokensOut={70_900} sound="Sploosh" />,
		)

		expect(lastFrame()).toContain("(esc to interrupt · total 16m 16s · step 1m 31s · ↓ 70.9K tokens)")

		await vi.advanceTimersByTimeAsync(1_000)

		expect(lastFrame()).toContain("total 16m 17s · step 1m 32s")
	})

	it("times the step from the turn start when no step start is given", () => {
		const now = new Date("2026-09-23T12:00:00Z").getTime()
		vi.setSystemTime(now)

		const { lastFrame } = render(<Spinner startTime={now - 5_000} sound="Sploosh" />)

		expect(lastFrame()).toContain("(esc to interrupt · total 5s · step 5s)")
	})

	it("restarts the step without touching the total when a new request begins", async () => {
		const now = new Date("2026-09-23T12:00:00Z").getTime()
		vi.setSystemTime(now)
		const turnStart = now - 300_000

		const { lastFrame, rerender } = render(
			<Spinner startTime={turnStart} stepStartTime={now - 120_000} sound="Sploosh" />,
		)
		expect(lastFrame()).toContain("total 5m 00s · step 2m 00s")

		await vi.advanceTimersByTimeAsync(3_000)
		rerender(<Spinner startTime={turnStart} stepStartTime={Date.now()} sound="Sploosh" />)

		expect(lastFrame()).toContain("total 5m 03s · step 0s")
	})
})
