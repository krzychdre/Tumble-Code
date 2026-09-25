import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react"

import type { WebviewMessage } from "@roo-code/types"

import { arePathsEqual } from "@roo-code/core/cli"

import { getGlobalCommandsForAutocomplete } from "@/lib/utils/commands.js"

import type { TaskHistoryItem } from "../types.js"
import {
	type AutocompleteInputHandle,
	type AutocompletePickerState,
	type AutocompleteTrigger,
	type FileResult,
	type ModeResult,
	type SlashCommandResult,
	createFileTrigger,
	createSlashCommandTrigger,
	createModeTrigger,
	createHelpTrigger,
	createHistoryTrigger,
	toFileResult,
	toSlashCommandResult,
	toModeResult,
	toHistoryResult,
} from "../components/autocomplete/index.js"

export interface UseAutocompleteTriggersOptions {
	fileSearchResults: FileResult[]
	allSlashCommands: SlashCommandResult[]
	availableModes: ModeResult[]
	taskHistory: TaskHistoryItem[]
	workspacePath: string
	sendToExtension: ((msg: WebviewMessage) => void) | null
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pickerState: AutocompletePickerState<any>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	autocompleteRef: RefObject<AutocompleteInputHandle<any> | null>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	followupAutocompleteRef: RefObject<AutocompleteInputHandle<any> | null>
}

/**
 * The input's autocomplete triggers (@ files, / commands, ! modes, ? help,
 * # history), plus the refresh of an open file picker when search results
 * arrive after the query was typed.
 */
export function useAutocompleteTriggers({
	fileSearchResults,
	allSlashCommands,
	availableModes,
	taskHistory,
	workspacePath,
	sendToExtension,
	pickerState,
	autocompleteRef,
	followupAutocompleteRef,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
}: UseAutocompleteTriggersOptions): AutocompleteTrigger<any>[] {
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

	return autocompleteTriggers
}
