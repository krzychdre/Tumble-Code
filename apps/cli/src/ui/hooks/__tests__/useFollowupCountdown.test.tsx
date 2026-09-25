import { Text } from "ink"
import { cleanup, render } from "ink-testing-library"

import { FOLLOWUP_TIMEOUT_SECONDS } from "../../../types/constants.js"
import { useUIStateStore } from "../../stores/uiStateStore.js"
import type { PendingAsk } from "../../types.js"
import { useFollowupCountdown } from "../useFollowupCountdown.js"

describe("useFollowupCountdown", () => {
	let pendingAsk: PendingAsk
	const defaultPendingAsk: PendingAsk = {
		id: "followup-1",
		type: "followup",
		content: "Choose",
		suggestions: [{ answer: "First" }, { answer: "Second" }],
	}

	let autoAcceptEnabled = true
	let onAutoSubmit: ReturnType<typeof vi.fn<(suggestion: { answer: string; mode?: string }) => void>>

	function Harness() {
		useFollowupCountdown({ pendingAsk, onAutoSubmit, autoAcceptEnabled })
		return <Text>harness</Text>
	}

	beforeEach(() => {
		vi.useFakeTimers()
		useUIStateStore.getState().resetUIState()
		autoAcceptEnabled = true
		pendingAsk = defaultPendingAsk
		onAutoSubmit = vi.fn()
	})

	afterEach(() => {
		// Unmount, or an earlier test's harness re-runs its effect with the next
		// test's settings and submits again.
		cleanup()
		vi.useRealTimers()
	})

	it("auto-selects the first suggestion when permissions allow actions", () => {
		render(<Harness />)

		expect(useUIStateStore.getState().countdownSeconds).toBe(FOLLOWUP_TIMEOUT_SECONDS)
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)

		expect(onAutoSubmit).toHaveBeenCalledWith({ answer: "First" })
		expect(useUIStateStore.getState().countdownSeconds).toBeNull()
	})

	it("does not start a countdown when permissions require approval", () => {
		autoAcceptEnabled = false
		render(<Harness />)

		expect(useUIStateStore.getState().countdownSeconds).toBeNull()
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)
		expect(onAutoSubmit).not.toHaveBeenCalled()
	})

	it("cancels an active countdown when permissions switch to ask", () => {
		const view = render(<Harness />)
		expect(useUIStateStore.getState().countdownSeconds).toBe(FOLLOWUP_TIMEOUT_SECONDS)

		autoAcceptEnabled = false
		view.rerender(<Harness />)
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)

		expect(onAutoSubmit).not.toHaveBeenCalled()
		expect(useUIStateStore.getState().countdownSeconds).toBeNull()
	})

	// DEF-C28: weak models emit suggestions with a blank or missing answer;
	// the countdown used to send suggestions[0].answer, i.e. an empty reply.
	it("auto-selects the first suggestion with a usable answer", () => {
		pendingAsk = {
			...defaultPendingAsk,
			suggestions: [{ answer: "  " }, { answer: undefined as unknown as string }, { answer: "Yes" }],
		}
		render(<Harness />)
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)

		expect(onAutoSubmit).toHaveBeenCalledTimes(1)
		expect(onAutoSubmit).toHaveBeenCalledWith({ answer: "Yes" })
	})

	it("does not count down when no suggestion has a usable answer", () => {
		pendingAsk = { ...defaultPendingAsk, suggestions: [{ answer: "" }, { answer: " \n" }] }
		render(<Harness />)

		expect(useUIStateStore.getState().countdownSeconds).toBeNull()
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)
		expect(onAutoSubmit).not.toHaveBeenCalled()
	})

	// The chosen suggestion keeps its mode, so the caller can switch to it.
	it("hands over the suggestion's mode with the answer", () => {
		pendingAsk = { ...defaultPendingAsk, suggestions: [{ answer: "Build it", mode: "code" }] }
		render(<Harness />)
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)

		expect(onAutoSubmit).toHaveBeenCalledWith({ answer: "Build it", mode: "code" })
	})
})
