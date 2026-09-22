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

	it("turning verbose off bumps the epoch too, because collapsing is a reprint", () => {
		// Ink prints a `<Static>` item once and can never rewrite it, so the
		// collapsed transcript has to be printed again (onto the screen that
		// useGlobalInput wipes first) rather than edited in place.
		useUIStateStore.getState().toggleVerboseTranscript()
		useUIStateStore.getState().toggleVerboseTranscript()

		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(false)
		expect(state.transcriptReprintEpoch).toBe(2)
	})

	it("bumps the epoch on every toggle", () => {
		const toggle = () => useUIStateStore.getState().toggleVerboseTranscript()
		toggle()
		toggle()
		toggle()

		const state = useUIStateStore.getState()
		expect(state.verboseTranscript).toBe(true)
		expect(state.transcriptReprintEpoch).toBe(3)
	})
})

describe("useUIStateStore clearTranscript", () => {
	beforeEach(() => {
		useUIStateStore.getState().resetUIState()
	})

	it("starts at clear epoch 0", () => {
		expect(useUIStateStore.getState().transcriptClearEpoch).toBe(0)
	})

	it("bumps the clear epoch so the Static region remounts", () => {
		useUIStateStore.getState().clearTranscript()
		expect(useUIStateStore.getState().transcriptClearEpoch).toBe(1)

		useUIStateStore.getState().clearTranscript()
		expect(useUIStateStore.getState().transcriptClearEpoch).toBe(2)
	})

	it("resets the reprint epoch, so the cleared screen opens with the banner", () => {
		useUIStateStore.getState().toggleVerboseTranscript()
		expect(useUIStateStore.getState().transcriptReprintEpoch).toBe(1)

		useUIStateStore.getState().clearTranscript()

		expect(useUIStateStore.getState().transcriptReprintEpoch).toBe(0)
	})

	it("leaves the verbose preference alone", () => {
		useUIStateStore.getState().toggleVerboseTranscript()

		useUIStateStore.getState().clearTranscript()

		expect(useUIStateStore.getState().verboseTranscript).toBe(true)
	})
})
