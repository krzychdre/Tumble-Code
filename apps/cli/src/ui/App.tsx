import { Box, Static, Text, useApp, useInput } from "ink"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"

import { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"

import { getGlobalCommandsForAutocomplete } from "@/lib/utils/commands.js"
import { getPermissionMode, type PermissionMode } from "@/lib/utils/permissions.js"
import { arePathsEqual } from "@/lib/utils/path.js"
import { getContextWindow } from "@/lib/utils/context-window.js"

import * as theme from "./theme.js"
import { figures } from "./figures.js"
import { useCLIStore } from "./store.js"
import { useUIStateStore } from "./stores/uiStateStore.js"
import { getStaticCount, buildStaticItems, nextPromotion } from "./transcript.js"

// Import extracted hooks.
import {
	TerminalSizeProvider,
	useTerminalSize,
	useToast,
	useExtensionHost,
	useMessageHandlers,
	useTaskSubmit,
	useGlobalInput,
	useFollowupCountdown,
	usePickerHandlers,
} from "./hooks/index.js"

// Import components.
import WelcomeBanner from "./components/WelcomeBanner.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import DynamicTailMessage from "./components/DynamicTailMessage.js"
import TailViewport from "./components/TailViewport.js"
import Spinner from "./components/Spinner.js"
import ToastDisplay from "./components/ToastDisplay.js"
import TodoDisplay from "./components/TodoDisplay.js"
import ApprovalDialog from "./components/dialogs/ApprovalDialog.js"
import FollowupDialog from "./components/dialogs/FollowupDialog.js"
import InputArea, { type AutocompleteInputHandle } from "./components/input/InputArea.js"
import {
	type AutocompleteTrigger,
	type FileResult,
	type SlashCommandResult,
	PickerSelect,
	createFileTrigger,
	createSlashCommandTrigger,
	createModeTrigger,
	createHelpTrigger,
	createHistoryTrigger,
	toFileResult,
	toSlashCommandResult,
	toModeResult,
	toHistoryResult,
} from "./components/autocomplete/index.js"

const PICKER_MAX_VISIBLE = 8

export interface TUIAppProps extends ExtensionHostOptions {
	initialPrompt?: string
	initialTaskId?: string
	initialSessionId?: string
	continueSession?: boolean
	version: string
	// Create extension host factory for dependency injection.
	createExtensionHost: (options: ExtensionHostOptions) => ExtensionHostInterface
}

// Imported here to avoid a circular type-only import through components.
import type { StaticItem } from "./transcript.js"
import type { WelcomeBannerProps } from "./components/WelcomeBanner.js"

/**
 * Inner App component that uses the terminal size context.
 *
 * Layout (plan §8): a `<Static>` transcript region (finalized messages + the
 * welcome banner, printed once into native scrollback) followed by a dynamic
 * tail of in-flight messages, spinner, dialogs, the autocomplete picker, and
 * the bordered `InputArea` with its footer.
 */
function AppInner({ createExtensionHost, ...extensionHostOptions }: TUIAppProps) {
	const {
		initialPrompt,
		initialTaskId,
		initialSessionId,
		continueSession,
		workspacePath,
		extensionPath,
		user,
		provider,
		apiKey,
		model,
		baseUrl,
		mode,
		nonInteractive = false,
		debug,
		exitOnComplete,
		reasoningEffort,
		ephemeral,
		version,
	} = extensionHostOptions

	const { exit } = useApp()
	const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => getPermissionMode(nonInteractive))

	const {
		messages,
		pendingAsk,
		isLoading,
		isComplete,
		hasStartedTask: _hasStartedTask,
		error,
		fileSearchResults,
		allSlashCommands,
		availableModes,
		taskHistory,
		currentMode,
		tokenUsage,
		routerModels,
		apiConfiguration,
		currentTodos,
	} = useCLIStore()

	// Access UI state from the UI store
	const {
		showExitHint,
		countdownSeconds,
		showCustomInput,
		isTransitioningToCustomInput,
		showTodoViewer,
		pickerState,
		setIsTransitioningToCustomInput,
		verboseTranscript,
		transcriptReprintEpoch,
		transcriptClearEpoch,
	} = useUIStateStore()

	// Compute context window from router models and API configuration
	const contextWindow = useMemo(() => {
		return getContextWindow(routerModels, apiConfiguration)
	}, [routerModels, apiConfiguration])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

	// Stable refs for autocomplete data - prevents useMemo from recreating triggers on every data change
	const fileSearchResultsRef = useRef(fileSearchResults)
	const allSlashCommandsRef = useRef(allSlashCommands)
	const availableModesRef = useRef(availableModes)
	const taskHistoryRef = useRef(taskHistory)

	// Keep refs in sync with current state
	useEffect(() => {
		fileSearchResultsRef.current = fileSearchResults
	}, [fileSearchResults])
	useEffect(() => {
		allSlashCommandsRef.current = allSlashCommands
	}, [allSlashCommands])
	useEffect(() => {
		availableModesRef.current = availableModes
	}, [availableModes])
	useEffect(() => {
		taskHistoryRef.current = taskHistory
	}, [taskHistory])

	// Terminal size drives the dynamic-tail row budget below: if the tail
	// outgrows the terminal, its top rows scroll into native scrollback where
	// ink can never erase them again (permanent duplicated lines), and ink
	// falls back to clearing the whole terminal every frame.
	const { rows: terminalRows, columns: terminalColumns } = useTerminalSize()

	// Toast notifications for ephemeral messages (e.g., mode changes).
	const { currentToast, showInfo } = useToast()

	const {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef: _pendingCommandRef,
		firstTextMessageSkipped,
	} = useMessageHandlers({
		nonInteractive: permissionMode === "allow",
	})

	const { sendToExtension, runTask, cleanup } = useExtensionHost({
		initialPrompt,
		initialTaskId,
		initialSessionId,
		continueSession,
		mode,
		reasoningEffort,
		user,
		provider,
		apiKey,
		model,
		baseUrl,
		workspacePath,
		extensionPath,
		debug,
		nonInteractive,
		ephemeral,
		exitOnComplete,
		onExtensionMessage: handleExtensionMessage,
		createExtensionHost,
	})

	// Initialize task submit hook
	const { handleSubmit, handleApprove, handleReject } = useTaskSubmit({
		sendToExtension,
		runTask,
		seenMessageIds,
		firstTextMessageSkipped,
		permissionMode,
		onPermissionModeChange: setPermissionMode,
	})

	// Initialize countdown hook for followup auto-accept
	const { cancelCountdown } = useFollowupCountdown({
		pendingAsk,
		onAutoSubmit: handleSubmit,
		autoAcceptEnabled: permissionMode === "allow",
	})

	// Initialize picker handlers hook
	const { handlePickerStateChange, handlePickerSelect, handlePickerClose, handlePickerIndexChange } =
		usePickerHandlers({
			autocompleteRef,
			followupAutocompleteRef,
			sendToExtension,
			showInfo,
			seenMessageIds,
			firstTextMessageSkipped,
		})

	// Initialize global input hook (scroll/focus toggle removed — plan §8)
	useGlobalInput({
		pickerIsOpen: pickerState.isOpen,
		availableModes,
		currentMode,
		mode,
		sendToExtension,
		showInfo,
		exit,
		cleanup,
		closePicker: handlePickerClose,
	})

	// --- Transcript split (plan §3) -------------------------------------------

	const hasPendingAsk = Boolean(pendingAsk)
	const staticCount = getStaticCount(messages, isLoading, hasPendingAsk)

	// Monotonicity + task-switch reset detection. `staticKey` remounts the
	// `<Static>` region when the message array identity changes (task switch
	// cleared it), so the old scrollback stays above a fresh region. The rule
	// itself lives in `nextPromotion` so it can be tested on its own.
	const [staticKey, setStaticKey] = useState(0)
	const [prevStaticCount, setPrevStaticCount] = useState(0)
	// `prevIds` is only consulted inside the effect below to detect task-switch
	// resets (it never participates in rendering) so it lives in a ref instead
	// of state. Keeping it in state made it an effect dependency, and since we
	// rebuild a fresh ids array on every run, the new identity retriggered the
	// effect unconditionally → "Maximum update depth exceeded".
	const prevIdsRef = useRef<string[]>([])
	// Mirror of `prevStaticCount` for the effect to read. Reading the state
	// itself would need it in the dependency list, which would re-run the
	// effect on its own update.
	const promotedRef = useRef(0)

	useEffect(() => {
		const messageIds = messages.map((m) => m.id)
		const next = nextPromotion({
			messageIds,
			previousIds: prevIdsRef.current,
			staticCount,
			promoted: promotedRef.current,
		})
		if (next.remount) {
			setStaticKey((k) => k + 1)
		}
		promotedRef.current = next.promoted
		setPrevStaticCount(next.promoted)
		prevIdsRef.current = messageIds
	}, [messages, staticCount])

	const effectiveStaticCount = Math.max(prevStaticCount, staticCount)
	const staticMessages = messages.slice(0, effectiveStaticCount)
	const dynamicMessages = messages.slice(effectiveStaticCount)

	// Row budget per dynamic-tail message (plan: 2026-08-07 clamp dynamic
	// tail). Reserve covers spinner + bordered input/footer or dialogs.
	const TAIL_RESERVED_ROWS = 12
	const tailRowsPerMessage = Math.max(
		3,
		Math.floor((terminalRows - TAIL_RESERVED_ROWS) / Math.max(1, dynamicMessages.length)),
	)

	// The banner the user is looking at never changes: ink's `<Static>` prints
	// each item once and cannot rewrite it, so the copy already in scrollback
	// stays exactly as it was printed no matter what this object says later.
	// These props therefore only ever decide what a FUTURE printing shows, and
	// the printings that still lie ahead are the ctrl+o reprints, which follow a
	// screen wipe that took the old banner with it. Those must state the mode
	// and model that are current at that moment, not the ones the session
	// opened with.
	const welcomeProps = useMemo<WelcomeBannerProps>(
		() => ({
			workspacePath,
			user,
			provider,
			model,
			mode: currentMode || mode,
			reasoningEffort,
			nonInteractive,
			version,
		}),
		[workspacePath, user, provider, model, currentMode, mode, reasoningEffort, nonInteractive, version],
	)

	const staticItems = useMemo<StaticItem[]>(
		() =>
			buildStaticItems({
				messages: staticMessages,
				welcomeProps,
				expanded: verboseTranscript,
				reprintEpoch: transcriptReprintEpoch,
			}),
		[staticMessages, welcomeProps, verboseTranscript, transcriptReprintEpoch],
	)

	// --- Loading spinner timing -----------------------------------------------

	const loadingStartRef = useRef<number>(0)
	useEffect(() => {
		if (isLoading) loadingStartRef.current = Date.now()
	}, [isLoading])

	// --- Context percent for the footer ---------------------------------------

	const contextPercent = useMemo(() => {
		if (!contextWindow || contextWindow <= 0 || !tokenUsage) return null
		return Math.min(100, Math.round((tokenUsage.contextTokens / contextWindow) * 100))
	}, [contextWindow, tokenUsage])

	const footerCost = tokenUsage?.totalCost && tokenUsage.totalCost > 0 ? tokenUsage.totalCost : undefined

	// --- Dialog / input visibility flags --------------------------------------

	const showApprovalDialog = Boolean(pendingAsk && pendingAsk.type !== "followup")
	const showFollowupDialog =
		pendingAsk?.type === "followup" &&
		Boolean(pendingAsk.suggestions && pendingAsk.suggestions.length > 0) &&
		!showCustomInput
	const showFollowupCustomInput = pendingAsk?.type === "followup" && (showCustomInput || isTransitioningToCustomInput)

	// Input is owned by whichever dialog is up; the picker renders on top of
	// the input area only when the input itself is active.
	const inputActive = !showApprovalDialog && !showFollowupDialog && !showTodoViewer

	// `showFollowupSuggestions` is reused by the arrow-key countdown-cancel
	// `useInput` below.
	const showFollowupSuggestions =
		pendingAsk?.type === "followup" &&
		Boolean(pendingAsk.suggestions && pendingAsk.suggestions.length > 0) &&
		!showCustomInput

	// --- Autocomplete triggers (unchanged logic) ------------------------------

	// File search handler for the file trigger
	const handleFileSearch = useCallback(
		(query: string) => {
			if (!sendToExtension) {
				return
			}
			sendToExtension({ type: "searchFiles", query })
		},
		[sendToExtension],
	)

	// Create autocomplete triggers
	// Using 'any' to allow mixing different trigger types (FileResult, SlashCommandResult, ModeResult, HelpShortcutResult, HistoryResult)
	// IMPORTANT: We use refs here to avoid recreating triggers every time data changes.
	// This prevents the UI flash caused by: data change -> memo recreation -> re-render with stale state
	// The getResults/getCommands/getModes/getHistory callbacks always read from refs to get fresh data.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteTriggers = useMemo((): AutocompleteTrigger<any>[] => {
		const fileTrigger = createFileTrigger({
			onSearch: handleFileSearch,
			getResults: () => {
				const results = fileSearchResultsRef.current
				return results.map(toFileResult)
			},
		})

		const slashCommandTrigger = createSlashCommandTrigger({
			getCommands: () => {
				// Merge CLI global commands with extension commands
				const extensionCommands = allSlashCommandsRef.current.map(toSlashCommandResult)
				const globalCommands = getGlobalCommandsForAutocomplete().map(toSlashCommandResult)
				// Global commands appear first, then extension commands
				return [...globalCommands, ...extensionCommands]
			},
		})

		const modeTrigger = createModeTrigger({
			getModes: () => availableModesRef.current.map(toModeResult),
		})

		const helpTrigger = createHelpTrigger()

		// History trigger - type # to search and resume previous tasks
		const historyTrigger = createHistoryTrigger({
			getHistory: () => {
				// Filter to only show tasks for the current workspace
				// Use arePathsEqual for proper cross-platform path comparison
				// (handles trailing slashes, separators, and case sensitivity)
				const history = taskHistoryRef.current
				const filtered = history.filter((item) => arePathsEqual(item.workspace, workspacePath))
				return filtered.map(toHistoryResult)
			},
		})

		return [fileTrigger, slashCommandTrigger, modeTrigger, helpTrigger, historyTrigger]
	}, [handleFileSearch, workspacePath]) // Only depend on handleFileSearch and workspacePath - data accessed via refs

	// Refresh search results when fileSearchResults changes while file picker is open
	// This handles the async timing where API results arrive after initial search
	// IMPORTANT: Only run when fileSearchResults array identity changes (new API response)
	// We use a ref to track this and avoid depending on pickerState in the effect
	const prevFileSearchResultsRef = useRef(fileSearchResults)
	const pickerStateRef = useRef(pickerState)
	pickerStateRef.current = pickerState

	useEffect(() => {
		// Only run if fileSearchResults actually changed (different array reference)
		if (fileSearchResults === prevFileSearchResultsRef.current) {
			return
		}

		const currentPickerState = pickerStateRef.current
		const willRefresh =
			currentPickerState.isOpen && currentPickerState.activeTrigger?.id === "file" && fileSearchResults.length > 0

		prevFileSearchResultsRef.current = fileSearchResults

		// Only refresh when file picker is open and we have new results
		if (willRefresh) {
			autocompleteRef.current?.refreshSearch()
			followupAutocompleteRef.current?.refreshSearch()
		}
	}, [fileSearchResults]) // Only depend on fileSearchResults - read pickerState from ref

	// --- Followup countdown-cancel: any arrow key cancels the auto-accept ------
	useInput(
		(_input, key) => {
			if (showFollowupSuggestions && countdownSeconds !== null) {
				if (key.upArrow || key.downArrow) {
					cancelCountdown()
				}
			}
		},
		{ isActive: showFollowupSuggestions && countdownSeconds !== null },
	)

	// --- Picker render-item fallback ------------------------------------------

	const getPickerRenderItem = useCallback(() => {
		if (pickerState.activeTrigger) {
			return pickerState.activeTrigger.renderItem
		}

		return (item: FileResult | SlashCommandResult, isSelected: boolean) => (
			<Box paddingLeft={2}>
				<Text color={isSelected ? "cyan" : undefined}>{item.key}</Text>
			</Box>
		)
	}, [pickerState.activeTrigger])

	// --- Error display ---------------------------------------------------------

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.error} bold>
					Error: {error}
				</Text>
				<Text dimColor>Press Ctrl+C to exit</Text>
			</Box>
		)
	}

	// --- Render ----------------------------------------------------------------

	return (
		<>
			{/* The key carries the reprint epoch: remounting `<Static>` resets
			    ink's printed-item index, which is the only way to print the
			    promoted transcript again (this time expanded). Items already in
			    scrollback are never rewritten in place. The clear epoch is in
			    the key for the same reason: after /clear wipes the screen, the
			    welcome banner has to be printed again. */}
			<Static key={`${staticKey}:${transcriptReprintEpoch}:${transcriptClearEpoch}`} items={staticItems}>
				{(item) => {
					if (item.kind === "welcome") {
						return (
							<Box key={item.id}>
								<WelcomeBanner {...item.welcomeProps} />
							</Box>
						)
					}
					if (item.kind === "divider") {
						return (
							<Box key={item.id} marginTop={1}>
								<Text dimColor>{item.label}</Text>
							</Box>
						)
					}
					return (
						<Box key={item.id}>
							<ChatHistoryItem message={item.message} expanded={item.expanded} />
						</Box>
					)
				}}
			</Static>

			{/* Hard bound: the whole tail (messages + spinner + dialogs + input)
			    must stay under the terminal height, or ink's erase sequences
			    miss rows and leave permanent duplicates. rows − 2 keeps us off
			    ink's clearTerminal fallback (triggers at height ≥ rows). */}
			<TailViewport maxRows={Math.max(6, terminalRows - 2)}>
				{/* Dynamic tail: in-flight / streaming messages still re-rendering.
				    Height-clamped so the tail never outgrows the terminal. */}
				{dynamicMessages.map((m) => (
					<DynamicTailMessage key={m.id} message={m} maxRows={tailRowsPerMessage} columns={terminalColumns} />
				))}

				{/* Spinner while loading and no dialog is stealing the frame */}
				{isLoading && !pendingAsk && (
					<Spinner startTime={loadingStartRef.current} tokensOut={tokenUsage?.totalTokensOut} isActive />
				)}

				{/* TODO viewer overlay (ctrl+t) */}
				{showTodoViewer && (
					<Box flexDirection="column" paddingLeft={1}>
						<TodoDisplay todos={currentTodos} showProgress={true} title="TODO List" />
						<Text dimColor>{figures.pointer} Ctrl+T to close</Text>
					</Box>
				)}

				{/* Approval dialog (tool/command) */}
				{showApprovalDialog && pendingAsk && (
					<ApprovalDialog ask={pendingAsk} onApprove={handleApprove} onReject={handleReject} isActive />
				)}

				{/* Followup suggestions dialog */}
				{showFollowupDialog && pendingAsk && (
					<FollowupDialog
						ask={pendingAsk}
						onSelect={(ans) => {
							void handleSubmit(ans)
						}}
						onCustomInput={() => {
							cancelCountdown()
							setIsTransitioningToCustomInput(true)
							useUIStateStore.getState().setShowCustomInput(true)
						}}
						countdownSeconds={countdownSeconds}
						isActive
					/>
				)}

				{/* Autocomplete picker dropdown — shown above the input when open */}
				{pickerState.isOpen && inputActive && (
					<PickerSelect
						results={pickerState.results}
						selectedIndex={pickerState.selectedIndex}
						maxVisible={PICKER_MAX_VISIBLE}
						onSelect={handlePickerSelect}
						onEscape={handlePickerClose}
						onIndexChange={handlePickerIndexChange}
						renderItem={getPickerRenderItem()}
						emptyMessage={pickerState.activeTrigger?.emptyMessage}
						isActive={pickerState.isOpen}
						isLoading={pickerState.isLoading}
					/>
				)}

				{/* Input area — hidden when a dialog or the TODO viewer owns input.
				    In followup custom-input mode, the ❯ is accented and the submit
				    handler clears the custom-input state after sending.
				    The input stays active while the picker is open: typing keeps
				    filtering the list, and the PickerSelect above owns Enter, Tab,
				    the arrows and Escape for that time. */}
				{inputActive && (
					<InputArea
						onSubmit={
							showFollowupCustomInput
								? (text) => {
										if (text && text.trim()) {
											void handleSubmit(text)
											useUIStateStore.getState().setShowCustomInput(false)
											setIsTransitioningToCustomInput(false)
										}
									}
								: (text) => {
										void handleSubmit(text)
									}
						}
						isActive={!isLoading}
						isLoading={isLoading}
						placeholder={
							showFollowupCustomInput ? "Type your response..." : isComplete ? "Type to continue..." : ""
						}
						triggers={autocompleteTriggers}
						onPickerStateChange={handlePickerStateChange}
						inputRef={showFollowupCustomInput ? followupAutocompleteRef : autocompleteRef}
						mode={currentMode || mode}
						model={model}
						contextPercent={contextPercent}
						cost={footerCost}
						toast={currentToast}
						exitHint={showExitHint ? "Press Ctrl+C again to exit" : null}
						accentPrompt={showFollowupCustomInput}
					/>
				)}

				{/* Toast line when a dialog owns input (InputArea/Footer not rendered) */}
				{!inputActive && currentToast && <ToastDisplay toast={currentToast} />}
			</TailViewport>
		</>
	)
}

/**
 * Main TUI Application Component - wraps with TerminalSizeProvider
 */
export function App(props: TUIAppProps) {
	return (
		<TerminalSizeProvider>
			<AppInner {...props} />
		</TerminalSizeProvider>
	)
}
