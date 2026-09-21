import { describe, it, expect, beforeEach } from "vitest"

import { useUIStateStore } from "../uiStateStore.js"

describe("useUIStateStore verbose transcript", () => {
	beforeEach(() => {
		useUIStateStore.getState().resetUIState()
	})

	it("starts collapsed at epoch 0", () => {
		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(false)
		expect(state.transcriptReprintEpoch).toBe(0)
	})

	it("turning verbose on bumps the reprint epoch", () => {
		useUIStateStore.getState().toggleVerboseTranscript()

		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(true)
		expect(state.transcriptReprintEpoch).toBe(1)
	})

	it("turning verbose off leaves the epoch untouched", () => {
		// Nothing new to print when collapsing, and a reprint would duplicate
		// the whole transcript in scrollback for no gain.
		useUIStateStore.getState().toggleVerboseTranscript()
		useUIStateStore.getState().toggleVerboseTranscript()

		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(false)
		expect(state.transcriptReprintEpoch).toBe(1)
	})

	it("bumps the epoch again on every re-expand", () => {
		const toggle = () => useUIStateStore.getState().toggleVerboseTranscript()
		toggle()
		toggle()
		toggle()

		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(true)
		expect(state.transcriptReprintEpoch).toBe(2)
	})
})
