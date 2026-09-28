/**
 * The TUI error boundary (R6): a render crash must show a readable fallback
 * and hand the error to onError, instead of leaving ink's renderer running
 * over a broken tree with the terminal in raw mode.
 */

import { render } from "ink-testing-library"

import { TuiErrorBoundary } from "../TuiErrorBoundary.js"

function Boom(): never {
	throw new Error("render exploded")
}

describe("TuiErrorBoundary", () => {
	it("renders children when nothing throws", () => {
		const { lastFrame } = render(
			<TuiErrorBoundary>
				<>{}</>
			</TuiErrorBoundary>,
		)

		expect(lastFrame()).toBe("")
	})

	it("shows a readable fallback and reports the error when a child throws", async () => {
		const onError = vi.fn()

		const { lastFrame } = render(
			<TuiErrorBoundary onError={onError}>
				<Boom />
			</TuiErrorBoundary>,
		)

		// React schedules the boundary's fallback render; wait for the frame.
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("Error: render exploded")
		})

		const frame = lastFrame() ?? ""
		expect(frame).toContain("Press Ctrl+C to exit")
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
	})

	it("shows the crash hint (debug log path, --debug) under the fallback", async () => {
		const { lastFrame } = render(
			<TuiErrorBoundary hint="Run again with --debug to write a debug log to /tmp/x.log">
				<Boom />
			</TuiErrorBoundary>,
		)

		await vi.waitFor(() => {
			expect(lastFrame()).toContain("Error: render exploded")
		})

		expect(lastFrame()).toContain("Run again with --debug to write a debug log to /tmp/x.log")
	})
})
