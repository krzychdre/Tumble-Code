import { useEffect, useRef } from "react"
import { useInput, useStdout } from "ink"
import type { WebviewMessage } from "@roo-code/types"

import { matchesGlobalSequence } from "@/lib/utils/input.js"

import type { ModeResult } from "../components/autocomplete/index.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import { useSecretPromptStore } from "../stores/secretPromptStore.js"
import { useCLIStore } from "../store.js"
import { CLEAR_TERMINAL } from "../utils/clearTerminal.js"

export interface UseGlobalInputOptions {
	pickerIsOpen: boolean
	availableModes: ModeResult[]
	currentMode: string | null
	mode: string
	sendToExtension: ((msg: WebviewMessage) => void) | null
	showInfo: (msg: string, duration?: number) => void
	exit: () => void
	cleanup: () => Promise<void>
	closePicker: () => void
}

/**
 * Hook to handle global keyboard shortcuts.
 *
 * Shortcuts:
 * - Ctrl+C: Double-press to exit
 * - Shift+Tab: Cycle through available modes (only while no picker is open,
 *   because Tab belongs to the picker then)
 * - Ctrl+T: Toggle TODO list viewer
 * - Ctrl+O: Toggle the verbose transcript (clears the screen and prints the
 *   promoted transcript again at the new verbosity)
 * - Escape: Cancel task (when loading) or close TODO viewer
 *
 * Note: the scroll/input focus toggle (Tab) was removed with the ScrollArea
 * component — the transcript now flows into native scrollback via `<Static>`,
 * so there is no in-app scroll viewport to focus.
 */
export function useGlobalInput({
	pickerIsOpen,
	availableModes,
	currentMode,
	mode,
	sendToExtension,
	showInfo,
	exit,
	cleanup,
	closePicker,
}: UseGlobalInputOptions): void {
	const { isLoading, currentTodos } = useCLIStore()
	const { write } = useStdout()
	const {
		showTodoViewer,
		setShowTodoViewer,
		showExitHint: _showExitHint,
		setShowExitHint,
		pendingExit,
		setPendingExit,
		verboseTranscript,
		toggleVerboseTranscript,
	} = useUIStateStore()

	// Track Ctrl+C presses for "press again to exit" behavior
	const exitHintTimeout = useRef<NodeJS.Timeout | null>(null)

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (exitHintTimeout.current) {
				clearTimeout(exitHintTimeout.current)
			}
		}
	}, [])

	// Handle global keyboard shortcuts
	useInput((input, key) => {
		// A command waiting for a password owns the keyboard: its dialog is the
		// only thing that can move the session forward, and the shortcuts here
		// would otherwise fire alongside it. Esc is the sharp one, because it
		// means "refuse this prompt" there and "cancel the whole task" here.
		// Read through getState() rather than a subscription: this callback is
		// registered once and would otherwise close over a stale value.
		// Ctrl+C stays available, it is the way out of anything.
		if (useSecretPromptStore.getState().current && !(key.ctrl && input === "c")) {
			return
		}

		// Shift+Tab to cycle through modes (only when not loading and we have available modes)
		// Uses centralized global input sequence detection
		if (matchesGlobalSequence(input, key, "cycle-mode")) {
			// While a picker is open, Tab accepts the highlighted item, so leave
			// the whole Tab family to the picker.
			if (pickerIsOpen) {
				return
			}

			// Don't allow mode switching while a task is in progress (loading)
			if (isLoading) {
				showInfo("Cannot switch modes while task is in progress", 2000)
				return
			}

			// Need at least 2 modes to cycle
			if (availableModes.length < 2) {
				return
			}

			// Find current mode index
			const currentModeSlug = currentMode || mode
			const currentIndex = availableModes.findIndex((m) => m.slug === currentModeSlug)
			const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableModes.length
			const nextMode = availableModes[nextIndex]

			if (nextMode && sendToExtension) {
				sendToExtension({ type: "mode", text: nextMode.slug })
				showInfo(`Switched to ${nextMode.name}`, 2000)
			}

			return
		}

		// Ctrl+T to toggle TODO list viewer
		if (matchesGlobalSequence(input, key, "ctrl-t")) {
			// Close picker if open
			if (pickerIsOpen) {
				closePicker()
			}
			// Toggle TODO viewer
			setShowTodoViewer(!showTodoViewer)
			if (!showTodoViewer && currentTodos.length === 0) {
				showInfo("No TODO list available", 2000)
				setShowTodoViewer(false)
			}
			return
		}

		// Ctrl+O to toggle the verbose transcript
		if (matchesGlobalSequence(input, key, "ctrl-o")) {
			// Close picker if open: the reprint writes a whole transcript into
			// scrollback, which would scroll an open dropdown off the screen.
			if (pickerIsOpen) {
				closePicker()
			}
			// Wipe first, toggle second, exactly as /clear does. A terminal cannot
			// take back lines it has already printed, so the only honest way to
			// collapse an expanded transcript is to clear the screen and print the
			// whole thing again at the new verbosity. Without the wipe the reprint
			// would simply stack another copy under the old one, which is what made
			// ctrl+o expand but never collapse.
			write(CLEAR_TERMINAL)
			toggleVerboseTranscript()
			// `verboseTranscript` is the value from before the toggle, so the
			// message describes the state the user is switching into.
			showInfo(
				verboseTranscript ? "Collapsed view" : "Expanded view: tool output and thinking print in full",
				2000,
			)
			return
		}

		// Escape key to close TODO viewer
		if (key.escape && showTodoViewer) {
			setShowTodoViewer(false)
			return
		}

		// Escape key to cancel/pause task when loading (streaming)
		if (key.escape && isLoading && sendToExtension) {
			// If picker is open, let the picker handle escape first
			if (pickerIsOpen) {
				return
			}
			// Send cancel message to extension (same as webview-ui Cancel button)
			sendToExtension({ type: "cancelTask" })
			return
		}

		// Ctrl+C to exit
		if (key.ctrl && input === "c") {
			// If picker is open, close it first
			if (pickerIsOpen) {
				closePicker()
				return
			}

			if (pendingExit) {
				// Second press - exit immediately
				if (exitHintTimeout.current) {
					clearTimeout(exitHintTimeout.current)
				}
				cleanup().finally(() => {
					exit()
					process.exit(0)
				})
			} else {
				// First press - show hint and wait for second press
				setPendingExit(true)
				setShowExitHint(true)

				exitHintTimeout.current = setTimeout(() => {
					setPendingExit(false)
					setShowExitHint(false)
					exitHintTimeout.current = null
				}, 2000)
			}
		}
	})
}
