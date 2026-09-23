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

	// MCP server panel overlay (/mcp)
	showMcpPanel: boolean

	// Verbose transcript (ctrl+o): tool previews and thinking print in full.
	// Only ever consumed by the `<Static>` region; the dynamic tail keeps its
	// clamps in both modes (plan: 2026-09-21 answer lost in dynamic tail, I1).
	verboseTranscript: boolean
	// Bumped every time the promoted transcript must be printed again, which is
	// on every ctrl+o, in both directions. It feeds the `<Static>` key in
	// App.tsx, and a key change is the only way to make ink reprint items it has
	// already written into native scrollback (I2).
	transcriptReprintEpoch: number
	// Bumped by /clear, and also part of the `<Static>` key: the region has to
	// remount so the welcome banner prints again onto the freshly wiped screen.
	transcriptClearEpoch: number

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

	// MCP panel actions
	setShowMcpPanel: (show: boolean) => void

	// Verbose transcript actions
	toggleVerboseTranscript: () => void

	// Transcript clear (/clear): remount `<Static>` on an empty transcript
	clearTranscript: () => void

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
	showMcpPanel: false,
	verboseTranscript: false,
	transcriptReprintEpoch: 0,
	transcriptClearEpoch: 0,
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
	setShowMcpPanel: (show) => set({ showMcpPanel: show }),
	toggleVerboseTranscript: () =>
		set((state) => ({
			verboseTranscript: !state.verboseTranscript,
			// BOTH directions bump the epoch, because both are a reprint: ink's
			// `<Static>` prints each item once and can never rewrite it, so the
			// only way to show the transcript at the other verbosity is to print
			// it again. The caller wipes the screen first (useGlobalInput), which
			// is what keeps "print it again" from meaning "one more copy": the
			// reprint lands on an empty screen and is the only copy on it.
			transcriptReprintEpoch: state.transcriptReprintEpoch + 1,
		})),
	clearTranscript: () =>
		set((state) => ({
			transcriptClearEpoch: state.transcriptClearEpoch + 1,
			// The transcript this epoch counted reprints of is gone, so the
			// `<Static>` head goes back to the welcome banner rather than the
			// ctrl+o "expanded transcript" divider, which would now be a
			// divider under nothing.
			transcriptReprintEpoch: 0,
		})),
	setPickerState: (state) => set({ pickerState: state }),
	resetUIState: () => set(initialState),
}))
