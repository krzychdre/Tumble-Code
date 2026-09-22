import { Text } from "ink"
import { render } from "ink-testing-library"

import { FOLLOWUP_TIMEOUT_SECONDS } from "../../../types/constants.js"
import { useUIStateStore } from "../../stores/uiStateStore.js"
import type { PendingAsk } from "../../types.js"
import { useFollowupCountdown } from "../useFollowupCountdown.js"

describe("useFollowupCountdown", () => {
	const pendingAsk: PendingAsk = {
		id: "followup-1",
		type: "followup",
		content: "Choose",
		suggestions: [{ answer: "First" }, { answer: "Second" }],
	}

	let autoAcceptEnabled = true
	let onAutoSubmit: ReturnType<typeof vi.fn<(text: string) => void>>

	function Harness() {
		useFollowupCountdown({ pendingAsk, onAutoSubmit, autoAcceptEnabled })
		return <Text>harness</Text>
	}

	beforeEach(() => {
		vi.useFakeTimers()
		useUIStateStore.getState().resetUIState()
		autoAcceptEnabled = true
		onAutoSubmit = vi.fn()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("auto-selects the first suggestion when permissions allow actions", () => {
		render(<Harness />)

		expect(useUIStateStore.getState().countdownSeconds).toBe(FOLLOWUP_TIMEOUT_SECONDS)
		vi.advanceTimersByTime(FOLLOWUP_TIMEOUT_SECONDS * 1000)

		expect(onAutoSubmit).toHaveBeenCalledWith("First")
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
})
