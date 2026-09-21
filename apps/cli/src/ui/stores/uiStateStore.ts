import { create } from "zustand"
import type { AutocompletePickerState } from "../components/autocomplete/types.js"

/**
 * UI-specific state that doesn't need to persist across task switches.
 * This separates UI state from task/message state in the main CLI store.
 */
interface UIState {
	// Exit handling state
	showExitHint: boolean
	pendingExit: boolean

	// Countdown timer for auto-accepting followup questions
	countdownSeconds: number | null

	// Custom input mode for followup questions
	showCustomInput: boolean
	isTransitioningToCustomInput: boolean

	// Focus management for scroll area vs input
	manualFocus: "scroll" | "input" | null

	// TODO viewer overlay
	showTodoViewer: boolean

	// Verbose transcript (ctrl+o): tool previews and thinking print in full.
	// Only ever consumed by the `<Static>` region; the dynamic tail keeps its
	// clamps in both modes (plan: 2026-09-21 answer lost in dynamic tail, I1).
	verboseTranscript: boolean
	// Bumped every time the promoted transcript must be printed again. It feeds
	// the `<Static>` key in App.tsx, and a key change is the only way to make
	// ink reprint items it has already written into native scrollback (I2).
	transcriptReprintEpoch: number

	// Autocomplete picker state
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pickerState: AutocompletePickerState<any>
}

interface UIActions {
	// Exit handling actions
	setShowExitHint: (show: boolean) => void
	setPendingExit: (pending: boolean) => void

	// Countdown timer actions
	setCountdownSeconds: (seconds: number | null) => void

	// Custom input mode actions
	setShowCustomInput: (show: boolean) => void
	setIsTransitioningToCustomInput: (transitioning: boolean) => void

	// Focus management actions
	setManualFocus: (focus: "scroll" | "input" | null) => void

	// TODO viewer actions
	setShowTodoViewer: (show: boolean) => void

	// Verbose transcript actions
	toggleVerboseTranscript: () => void

	// Picker state actions
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	setPickerState: (state: AutocompletePickerState<any>) => void

	// Reset all UI state to defaults
	resetUIState: () => void
}

const initialState: UIState = {
	showExitHint: false,
	pendingExit: false,
	countdownSeconds: null,
	showCustomInput: false,
	isTransitioningToCustomInput: false,
	manualFocus: null,
	showTodoViewer: false,
	verboseTranscript: false,
	transcriptReprintEpoch: 0,
	pickerState: {
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	},
}

export const useUIStateStore = create<UIState & UIActions>((set) => ({
	...initialState,

	setShowExitHint: (show) => set({ showExitHint: show }),
	setPendingExit: (pending) => set({ pendingExit: pending }),
	setCountdownSeconds: (seconds) => set({ countdownSeconds: seconds }),
	setShowCustomInput: (show) => set({ showCustomInput: show }),
	setIsTransitioningToCustomInput: (transitioning) => set({ isTransitioningToCustomInput: transitioning }),
	setManualFocus: (focus) => set({ manualFocus: focus }),
	setShowTodoViewer: (show) => set({ showTodoViewer: show }),
	toggleVerboseTranscript: () =>
		set((state) => {
			const next = !state.verboseTranscript
			// Only turning verbose ON bumps the epoch. Already printed items can
			// never be re-rendered in place, so the expanded bodies are shown by
			// reprinting the promoted transcript once. Turning it OFF has nothing
			// new to show, and a reprint there would duplicate the transcript for
			// no gain, so the epoch (and with it the `<Static>` key) stays put.
			return next
				? { verboseTranscript: true, transcriptReprintEpoch: state.transcriptReprintEpoch + 1 }
				: { verboseTranscript: false }
		}),
	setPickerState: (state) => set({ pickerState: state }),
	resetUIState: () => set(initialState),
}))
