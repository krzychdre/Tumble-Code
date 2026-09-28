import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"

import { mentionRegex, unescapeSpaces } from "@roo-code/core/browser"
import type { Command, ExtensionMessage, ModeConfig } from "@roo-code/types"

import { WebviewMessage } from "@roo/WebviewMessage"
import { Mode } from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import {
	ContextMenuOptionType,
	getContextMenuOptions,
	insertMention,
	removeMention,
	shouldShowContextMenu,
	SearchResult,
} from "@src/utils/context-mentions"
import { onExtensionMessage } from "@src/utils/extensionBus"

interface UseMentionMenuOptions {
	textAreaRef: RefObject<HTMLTextAreaElement | null>
	inputValue: string
	setInputValue: (value: string) => void
	setMode: (value: Mode) => void
	/** The composer's cursor, shared with paste and drop handling. */
	cursorPosition: number
	setCursorPosition: (position: number) => void
	/** Cursor position to apply after the next input value render. */
	setIntendedCursorPosition: (position: number | null) => void
	allModes: ModeConfig[]
	commands: Command[] | undefined
}

/**
 * The composer's "@" mention and "/" command menu: when it opens, what it lists (opened tabs, workspace
 * files, file and commit search results from the extension, modes, commands), keyboard navigation,
 * inserting the selected option, and backspace over a whole mention.
 *
 * The caller renders `ContextMenu` with `menuProps` inside `contextMenuContainerRef`, calls
 * `updateMenuForInput` from the textarea change handler, and gives `handleMenuKeyDown` and
 * `handleMentionBackspace` the key events in that order.
 */
export function useMentionMenu({
	textAreaRef,
	inputValue,
	setInputValue,
	setMode,
	cursorPosition,
	setCursorPosition,
	setIntendedCursorPosition,
	allModes,
	commands,
}: UseMentionMenuOptions) {
	const filePaths = useExtensionSelector((s) => s.filePaths)
	const openedTabs = useExtensionSelector((s) => s.openedTabs)

	const [gitCommits, setGitCommits] = useState<any[]>([])
	const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
	const [searchLoading, setSearchLoading] = useState(false)
	const [searchRequestId, setSearchRequestId] = useState<string>("")
	const [showContextMenu, setShowContextMenu] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
	const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
	const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
	const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
	const contextMenuContainerRef = useRef<HTMLDivElement>(null)
	// Ref to store the search timeout.
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Commit and file search results.
	useEffect(() => {
		const messageHandler = (message: ExtensionMessage) => {
			if (message.type === "commitSearchResults") {
				const commits = (message.commits as NonNullable<ExtensionMessage["commits"]>).map((commit: any) => ({
					type: ContextMenuOptionType.Git,
					value: commit.hash,
					label: commit.subject,
					description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
					icon: "$(git-commit)",
				}))

				setGitCommits(commits)
			} else if (message.type === "fileSearchResults") {
				setSearchLoading(false)
				if (message.requestId === searchRequestId) {
					setFileSearchResults((message.results as SearchResult[] | undefined) || [])
				}
			}
		}

		return onExtensionMessage(["commitSearchResults", "fileSearchResults"], messageHandler)
	}, [searchRequestId])

	// Fetch git commits when Git is selected or when typing a hash.
	useEffect(() => {
		if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
			const message: WebviewMessage = {
				type: "searchCommits",
				query: searchQuery || "",
			} as const
			vscode.postMessage(message)
		}
	}, [selectedType, searchQuery])

	const queryItems = useMemo(() => {
		return [
			{ type: ContextMenuOptionType.Problems, value: "problems" },
			{ type: ContextMenuOptionType.Terminal, value: "terminal" },
			...gitCommits,
			...openedTabs
				.filter((tab) => tab.path)
				.map((tab) => ({
					type: ContextMenuOptionType.OpenedFile,
					value: "/" + tab.path,
				})),
			...filePaths
				.map((file) => "/" + file)
				.filter((path) => !openedTabs.some((tab) => tab.path && "/" + tab.path === path)) // Filter out paths that are already in openedTabs
				.map((path) => ({
					type: path.endsWith("/") ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
					value: path,
				})),
		]
	}, [filePaths, gitCommits, openedTabs])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
				setShowContextMenu(false)
			}
		}

		if (showContextMenu) {
			document.addEventListener("mousedown", handleClickOutside)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showContextMenu, setShowContextMenu])

	const handleMentionSelect = useCallback(
		(type: ContextMenuOptionType, value?: string) => {
			if (type === ContextMenuOptionType.NoResults) {
				return
			}

			if (type === ContextMenuOptionType.Mode && value) {
				// Handle mode selection.
				setMode(value)
				setInputValue("")
				setShowContextMenu(false)
				vscode.postMessage({ type: "mode", text: value })
				return
			}

			if (type === ContextMenuOptionType.Command && value) {
				// Handle command selection.
				setSelectedMenuIndex(-1)
				setInputValue("")
				setShowContextMenu(false)

				// Insert the command mention into the textarea
				const commandMention = `/${value}`
				setInputValue(commandMention + " ")
				setCursorPosition(commandMention.length + 1)
				setIntendedCursorPosition(commandMention.length + 1)

				// Focus the textarea
				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.focus()
					}
				}, 0)
				return
			}

			if (
				type === ContextMenuOptionType.File ||
				type === ContextMenuOptionType.Folder ||
				type === ContextMenuOptionType.Git
			) {
				if (!value) {
					setSelectedType(type)
					setSearchQuery("")
					setSelectedMenuIndex(0)
					return
				}
			}

			setShowContextMenu(false)
			setSelectedType(null)

			if (textAreaRef.current) {
				let insertValue = value || ""

				if (type === ContextMenuOptionType.URL) {
					insertValue = value || ""
				} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
					insertValue = value || ""
				} else if (type === ContextMenuOptionType.Problems) {
					insertValue = "problems"
				} else if (type === ContextMenuOptionType.Terminal) {
					insertValue = "terminal"
				} else if (type === ContextMenuOptionType.Git) {
					insertValue = value || ""
				} else if (type === ContextMenuOptionType.Command) {
					insertValue = value ? `/${value}` : ""
				}

				// Determine if this is a slash command selection
				const isSlashCommand = type === ContextMenuOptionType.Mode || type === ContextMenuOptionType.Command

				const { newValue, mentionIndex } = insertMention(
					textAreaRef.current.value,
					cursorPosition,
					insertValue,
					isSlashCommand,
				)

				setInputValue(newValue)
				const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)

				// Scroll to cursor.
				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)
			}
		},
		[setInputValue, cursorPosition, setMode, setCursorPosition, setIntendedCursorPosition, textAreaRef],
	)

	/** Menu navigation and selection keys. Returns true when the menu consumed the key. */
	const handleMenuKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!showContextMenu) {
				return false
			}

			if (event.key === "Escape") {
				setSelectedType(null)
				setSelectedMenuIndex(3) // File by default
				return true
			}

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault()
				setSelectedMenuIndex((prevIndex) => {
					const direction = event.key === "ArrowUp" ? -1 : 1
					const options = getContextMenuOptions(
						searchQuery,
						selectedType,
						queryItems,
						fileSearchResults,
						allModes,
						commands,
					)
					const optionsLength = options.length

					if (optionsLength === 0) return prevIndex

					// Find selectable options (non-URL types)
					const selectableOptions = options.filter(
						(option) =>
							option.type !== ContextMenuOptionType.URL &&
							option.type !== ContextMenuOptionType.NoResults &&
							option.type !== ContextMenuOptionType.SectionHeader,
					)

					if (selectableOptions.length === 0) return -1 // No selectable options

					// Find the index of the next selectable option
					const currentSelectableIndex = selectableOptions.findIndex(
						(option) => option === options[prevIndex],
					)

					const newSelectableIndex =
						(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length

					// Find the index of the selected option in the original options array
					return options.findIndex((option) => option === selectableOptions[newSelectableIndex])
				})
				return true
			}

			if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
				event.preventDefault()
				const selectedOption = getContextMenuOptions(
					searchQuery,
					selectedType,
					queryItems,
					fileSearchResults,
					allModes,
					commands,
				)[selectedMenuIndex]
				if (
					selectedOption &&
					selectedOption.type !== ContextMenuOptionType.URL &&
					selectedOption.type !== ContextMenuOptionType.NoResults &&
					selectedOption.type !== ContextMenuOptionType.SectionHeader
				) {
					handleMentionSelect(selectedOption.type, selectedOption.value)
				}
				return true
			}

			return false
		},
		[
			showContextMenu,
			searchQuery,
			selectedMenuIndex,
			handleMentionSelect,
			selectedType,
			queryItems,
			allModes,
			fileSearchResults,
			commands,
		],
	)

	/**
	 * Backspace right after "@mention ": the first press steps over the space (or deletes it when nothing
	 * follows), the next one removes the whole mention.
	 */
	const handleMentionBackspace = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			const charBeforeCursor = inputValue[cursorPosition - 1]
			const charAfterCursor = inputValue[cursorPosition + 1]

			const charBeforeIsWhitespace =
				charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"

			const charAfterIsWhitespace =
				charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

			// Checks if char before cursor is whitespace after a mention.
			if (
				charBeforeIsWhitespace &&
				// "$" is added to ensure the match occurs at the end of the string.
				inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
			) {
				const newCursorPosition = cursorPosition - 1
				// If mention is followed by another word, then instead
				// of deleting the space separating them we just move
				// the cursor to the end of the mention.
				if (!charAfterIsWhitespace) {
					event.preventDefault()
					textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
					setCursorPosition(newCursorPosition)
				}

				setCursorPosition(newCursorPosition)
				setJustDeletedSpaceAfterMention(true)
			} else if (justDeletedSpaceAfterMention) {
				const { newText, newPosition } = removeMention(inputValue, cursorPosition)

				if (newText !== inputValue) {
					event.preventDefault()
					setInputValue(newText)
					setIntendedCursorPosition(newPosition) // Store the new cursor position in state
				}

				setJustDeletedSpaceAfterMention(false)
				setShowContextMenu(false)
			} else {
				setJustDeletedSpaceAfterMention(false)
			}
		},
		[
			inputValue,
			cursorPosition,
			justDeletedSpaceAfterMention,
			setInputValue,
			setCursorPosition,
			setIntendedCursorPosition,
			textAreaRef,
		],
	)

	/** Opens, filters or closes the menu for the new textarea value, and starts the searches it needs. */
	const updateMenuForInput = useCallback((newValue: string, newCursorPosition: number) => {
		const showMenu = shouldShowContextMenu(newValue, newCursorPosition)
		setShowContextMenu(showMenu)

		if (showMenu) {
			if (newValue.startsWith("/") && !newValue.includes(" ")) {
				// Handle slash command - request fresh commands
				const query = newValue
				setSearchQuery(query)
				// Set to first selectable item (skip section headers)
				setSelectedMenuIndex(1) // Section header is at 0, first command is at 1
				// Request commands fresh each time slash menu is shown
				vscode.postMessage({ type: "requestCommands" })
			} else {
				// Existing @ mention handling.
				const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
				const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
				setSearchQuery(query)

				// Send file search request if query is not empty.
				if (query.length > 0) {
					setSelectedMenuIndex(0)

					// Don't clear results until we have new ones. This
					// prevents flickering.

					// Clear any existing timeout.
					if (searchTimeoutRef.current) {
						clearTimeout(searchTimeoutRef.current)
					}

					// Set a timeout to debounce the search requests.
					searchTimeoutRef.current = setTimeout(() => {
						// Generate a request ID for this search.
						const reqId = Math.random().toString(36).substring(2, 9)
						setSearchRequestId(reqId)
						setSearchLoading(true)

						// Send message to extension to search files.
						vscode.postMessage({
							type: "searchFiles",
							query: unescapeSpaces(query),
							requestId: reqId,
						})
					}, 200) // 200ms debounce.
				} else {
					setSelectedMenuIndex(3) // Set to "File" option by default.
				}
			}
		} else {
			setSearchQuery("")
			setSelectedMenuIndex(-1)
			setFileSearchResults([]) // Clear file search results.
		}
	}, [])

	useEffect(() => {
		if (!showContextMenu) {
			setSelectedType(null)
		}
	}, [showContextMenu])

	/** Textarea blur: hide the menu unless the user clicked on it. */
	const handleMenuBlur = useCallback(() => {
		if (!isMouseDownOnMenu) {
			setShowContextMenu(false)
		}
	}, [isMouseDownOnMenu])

	const closeMenu = useCallback(() => setShowContextMenu(false), [])

	const handleMenuMouseDown = useCallback(() => {
		setIsMouseDownOnMenu(true)
	}, [])

	const menuProps = {
		onSelect: handleMentionSelect,
		searchQuery,
		inputValue,
		onMouseDown: handleMenuMouseDown,
		selectedIndex: selectedMenuIndex,
		setSelectedIndex: setSelectedMenuIndex,
		selectedType,
		queryItems,
		modes: allModes,
		loading: searchLoading,
		dynamicSearchResults: fileSearchResults,
		commands,
	}

	return {
		showContextMenu,
		contextMenuContainerRef,
		menuProps,
		handleMenuKeyDown,
		handleMentionBackspace,
		updateMenuForInput,
		handleMenuBlur,
		closeMenu,
	}
}
