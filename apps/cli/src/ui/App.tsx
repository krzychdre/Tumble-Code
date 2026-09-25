import { Box, Text, useApp, useInput } from "ink"
import { useState, useCallback, useRef, useMemo } from "react"

import type { UsableSuggestion } from "@roo-code/types"

import { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"

import { getPermissionMode, type PermissionMode } from "@/lib/utils/permissions.js"
import { getContextWindow } from "@/lib/utils/context-window.js"
import { summarizeProviderSettings } from "@/lib/utils/provider-config.js"

import * as theme from "./theme.js"
import { figures } from "./figures.js"
import { useCLIStore } from "./store.js"
import { useUIStateStore } from "./stores/uiStateStore.js"
import { useSecretPromptStore } from "./stores/secretPromptStore.js"
import { remainderAfterCommit } from "./streamCommit.js"

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
	useTranscriptPromotion,
	useMcpPanel,
	useAutocompleteTriggers,
	useSecretPromptBridge,
} from "./hooks/index.js"

// Import components.
import TranscriptStatic from "./components/TranscriptStatic.js"
import DynamicTailMessage from "./components/DynamicTailMessage.js"
import TailViewport from "./components/TailViewport.js"
import Spinner from "./components/Spinner.js"
import ToastDisplay from "./components/ToastDisplay.js"
import TodoDisplay from "./components/TodoDisplay.js"
import ApprovalDialog from "./components/dialogs/ApprovalDialog.js"
import FollowupDialog from "./components/dialogs/FollowupDialog.js"
import SecretPromptDialog from "./components/dialogs/SecretPromptDialog.js"
import McpPanel from "./components/McpPanel.js"
import InputArea, { type AutocompleteInputHandle } from "./components/input/InputArea.js"
import { type FileResult, type SlashCommandResult, PickerSelect } from "./components/autocomplete/index.js"

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
	const { initialPrompt, initialTaskId, initialSessionId, continueSession, version, ...hostOptions } =
		extensionHostOptions
	const { workspacePath, user, provider, model, mode, nonInteractive = false, reasoningEffort } = hostOptions

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
		mcpServers,
		turnStartedAt,
		stepStartedAt,
	} = useCLIStore()

	// Access UI state from the UI store
	const {
		showExitHint,
		countdownSeconds,
		showCustomInput,
		isTransitioningToCustomInput,
		showTodoViewer,
		showMcpPanel,
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

	// A mode switch can change provider, model and reasoning effort (per-mode
	// entries in cli-settings.json), so show what the extension holds now and
	// fall back to the startup options until its first state arrives.
	const liveProviderSettings = useMemo(() => summarizeProviderSettings(apiConfiguration), [apiConfiguration])
	const activeProvider = liveProviderSettings?.provider ?? provider
	const activeModel = liveProviderSettings?.model ?? model
	const activeReasoningEffort = liveProviderSettings ? liveProviderSettings.reasoningEffort : reasoningEffort

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

	// Terminal size drives the dynamic-tail row budget below: if the tail
	// outgrows the terminal, its top rows scroll into native scrollback where
	// ink can never erase them again (permanent duplicated lines), and ink
	// falls back to clearing the whole terminal every frame.
	const { rows: terminalRows, columns: terminalColumns } = useTerminalSize()

	// Toast notifications for ephemeral messages (e.g., mode changes).
	const { currentToast, showInfo, showWarning } = useToast()

	const {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef: _pendingCommandRef,
		firstTextMessageSkipped,
	} = useMessageHandlers({
		nonInteractive: permissionMode === "allow",
	})

	const { sendToExtension, runTask, cleanup } = useExtensionHost({
		...hostOptions,
		initialPrompt,
		initialTaskId,
		initialSessionId,
		continueSession,
		onExtensionMessage: handleExtensionMessage,
		createExtensionHost,
	})

	// Initialize task submit hook
	const { handleSubmit, handleSuggestion, handleApprove, handleReject } = useTaskSubmit({
		sendToExtension,
		runTask,
		seenMessageIds,
		firstTextMessageSkipped,
		permissionMode,
		onPermissionModeChange: setPermissionMode,
	})

	// Initialize countdown hook for followup auto-accept
	const autoSubmitSuggestion = useCallback(
		(suggestion: UsableSuggestion) => handleSuggestion(suggestion, false),
		[handleSuggestion],
	)
	const { cancelCountdown } = useFollowupCountdown({
		pendingAsk,
		onAutoSubmit: autoSubmitSuggestion,
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

	useSecretPromptBridge()

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
			provider: activeProvider,
			model: activeModel,
			mode: currentMode || mode,
			reasoningEffort: activeReasoningEffort,
			nonInteractive,
			version,
		}),
		[
			workspacePath,
			user,
			activeProvider,
			activeModel,
			currentMode,
			mode,
			activeReasoningEffort,
			nonInteractive,
			version,
		],
	)

	const { staticKey, staticItems, dynamicMessages, streamCommits, committedHead } = useTranscriptPromotion({
		messages,
		isLoading,
		hasPendingAsk,
		verboseTranscript,
		transcriptReprintEpoch,
		welcomeProps,
	})

	// Row budget per dynamic-tail message (plan: 2026-08-07 clamp dynamic
	// tail). Reserve covers spinner + bordered input/footer or dialogs.
	const TAIL_RESERVED_ROWS = 12
	const tailRowsPerMessage = Math.max(
		3,
		Math.floor((terminalRows - TAIL_RESERVED_ROWS) / Math.max(1, dynamicMessages.length)),
	)

	// --- Loading spinner timing -----------------------------------------------

	// A step is one request to the model plus the tools it asked for. A start
	// older than the turn (replayed history) means this turn's first request
	// has not begun yet, so the step is the turn so far. Both are only read
	// while loading, when the turn start is always set.
	const turnStart = turnStartedAt ?? 0
	const stepStart = Math.max(turnStart, stepStartedAt ?? 0)

	// --- Context percent for the footer ---------------------------------------

	const contextPercent = useMemo(() => {
		if (!contextWindow || contextWindow <= 0 || !tokenUsage) return null
		return Math.min(100, Math.round((tokenUsage.contextTokens / contextWindow) * 100))
	}, [contextWindow, tokenUsage])

	const footerCost = tokenUsage?.totalCost && tokenUsage.totalCost > 0 ? tokenUsage.totalCost : undefined

	// --- Dialog / input visibility flags --------------------------------------

	// A command is blocked waiting for a password or a passphrase. It outranks
	// everything else on screen: nothing else can move until it is answered, and
	// the command's own timeout is running while it waits.
	const secretPrompt = useSecretPromptStore((state) => state.current)

	const showApprovalDialog = Boolean(pendingAsk && pendingAsk.type !== "followup") && !secretPrompt
	const showFollowupDialog =
		pendingAsk?.type === "followup" &&
		Boolean(pendingAsk.suggestions && pendingAsk.suggestions.length > 0) &&
		!showCustomInput &&
		!secretPrompt
	const showFollowupCustomInput =
		pendingAsk?.type === "followup" && (showCustomInput || isTransitioningToCustomInput) && !secretPrompt

	// Input is owned by whichever dialog is up; the picker renders on top of
	// the input area only when the input itself is active.
	const inputActive = !showApprovalDialog && !showFollowupDialog && !showTodoViewer && !showMcpPanel && !secretPrompt

	// --- MCP servers (/mcp panel, failure notice) ------------------------------

	const mcpPanel = useMcpPanel({
		mcpServers,
		workspacePath,
		mcpSettingsPath: hostOptions.mcpSettingsPath,
		sendToExtension,
		showInfo,
		showWarning,
	})

	// `showFollowupSuggestions` is reused by the arrow-key countdown-cancel
	// `useInput` below.
	const showFollowupSuggestions =
		pendingAsk?.type === "followup" &&
		Boolean(pendingAsk.suggestions && pendingAsk.suggestions.length > 0) &&
		!showCustomInput

	// --- Autocomplete triggers (unchanged logic) ------------------------------

	const autocompleteTriggers = useAutocompleteTriggers({
		fileSearchResults,
		allSlashCommands,
		availableModes,
		taskHistory,
		workspacePath,
		sendToExtension,
		pickerState,
		autocompleteRef,
		followupAutocompleteRef,
	})

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
			<TranscriptStatic
				key={`${staticKey}:${transcriptReprintEpoch}:${transcriptClearEpoch}`}
				items={staticItems}
				columns={terminalColumns}
			/>

			{/* Hard bound: the whole tail (messages + spinner + dialogs + input)
			    must stay under the terminal height, or ink's erase sequences
			    miss rows and leave permanent duplicates. rows − 2 keeps us off
			    ink's clearTerminal fallback (triggers at height ≥ rows). */}
			<TailViewport maxRows={Math.max(6, terminalRows - 2)}>
				{/* Dynamic tail: in-flight / streaming messages still re-rendering.
				    Height-clamped so the tail never outgrows the terminal; in the
				    expanded transcript a running block shows its newest rows live. */}
				{dynamicMessages.map((m) => {
					// The head's finished lines are already in scrollback; the
					// tail keeps only the line the model is still writing.
					const commit = streamCommits[m.id]
					const rest = commit && m === committedHead ? remainderAfterCommit(m.content, commit) : null
					return (
						<DynamicTailMessage
							key={m.id}
							message={rest === null ? m : { ...m, content: rest }}
							continuation={rest !== null}
							maxRows={tailRowsPerMessage}
							columns={terminalColumns}
							expanded={verboseTranscript}
						/>
					)
				})}

				{/* Spinner while loading and no dialog is stealing the frame */}
				{isLoading && !pendingAsk && (
					<Spinner
						startTime={turnStart}
						stepStartTime={stepStart}
						tokensOut={tokenUsage?.totalTokensOut}
						isActive
					/>
				)}

				{/* TODO viewer overlay (ctrl+t) */}
				{showTodoViewer && (
					<Box flexDirection="column" paddingLeft={1}>
						<TodoDisplay todos={currentTodos} showProgress={true} title="TODO List" />
						<Text dimColor>{figures.pointer} Ctrl+T to close</Text>
					</Box>
				)}

				{/* MCP servers (/mcp); a dialog that comes up meanwhile takes the keys */}
				{showMcpPanel && (
					<McpPanel
						servers={mcpServers}
						globalConfigPath={mcpPanel.globalConfigPath}
						projectConfigPath={mcpPanel.projectConfigPath}
						onRestart={mcpPanel.onRestart}
						onToggleDisabled={mcpPanel.onToggleDisabled}
						onReload={mcpPanel.onReload}
						isActive={!showApprovalDialog && !showFollowupDialog && !secretPrompt}
					/>
				)}

				{/* A running command is waiting for a password or a passphrase */}
				{secretPrompt && (
					<SecretPromptDialog
						prompt={secretPrompt}
						onSubmit={(value) => useSecretPromptStore.getState().answer(value)}
						onCancel={() => useSecretPromptStore.getState().cancel()}
						isActive
					/>
				)}

				{/* Approval dialog (tool/command) */}
				{showApprovalDialog && pendingAsk && (
					<ApprovalDialog ask={pendingAsk} onApprove={handleApprove} onReject={handleReject} isActive />
				)}

				{/* Followup suggestions dialog */}
				{showFollowupDialog && pendingAsk && (
					<FollowupDialog
						ask={pendingAsk}
						onSelect={(suggestion) => handleSuggestion(suggestion, true)}
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
						model={activeModel}
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
