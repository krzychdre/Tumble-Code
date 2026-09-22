import { Box, Text } from "ink"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

/**
 * Help shortcut result type.
 * Represents a keyboard shortcut or trigger hint.
 */
export interface HelpShortcutResult extends AutocompleteItem {
	/** The shortcut key or trigger character */
	shortcut: string
	/** Description of what the shortcut does */
	description: string
}

/**
 * Built-in shortcuts to display in the help menu.
 *
 * Every entry here is a promise to the user, so it must match a binding that
 * really exists: the four trigger characters live in the sibling trigger
 * modules, the key presses are handled in `useGlobalInput`,
 * `MultilineTextInput` and `AutocompleteInput`.
 */
const HELP_SHORTCUTS: HelpShortcutResult[] = [
	{ key: "slash", shortcut: "/", description: "for commands" },
	{ key: "at", shortcut: "@", description: "for file paths" },
	{ key: "bang", shortcut: "!", description: "for modes" },
	{ key: "hash", shortcut: "#", description: "for task history" },
	{ key: "accept", shortcut: "tab", description: "to accept the highlighted suggestion" },
	{ key: "mode", shortcut: "shift + tab", description: "to cycle modes" },
	{ key: "newline", shortcut: "alt + ⏎", description: "for newline (shift + ⏎ in some terminals)" },
	{ key: "history", shortcut: "↑ / ↓", description: "to browse previous prompts" },
	{ key: "todos", shortcut: "ctrl + t", description: "to view TODO list" },
	{ key: "verbose", shortcut: "ctrl + o", description: "to expand or collapse tool output and thinking" },
	{ key: "cancel", shortcut: "esc", description: "to interrupt the task, or clear the input" },
	{ key: "quit", shortcut: "ctrl + c", description: "twice to quit" },
]

/**
 * Entries whose "shortcut" is a character the user types into the prompt.
 * Selecting one of those inserts the character; every other entry describes a
 * key press, so selecting it only closes the menu.
 */
const TRIGGER_CHARACTER_KEYS = new Set(["slash", "at", "bang", "hash"])

/**
 * Create a help trigger for ? shortcuts menu.
 *
 * This trigger activates when the user types ? at the start of a line,
 * and displays a menu of available keyboard shortcuts.
 *
 * @returns AutocompleteTrigger for help shortcuts
 */
export function createHelpTrigger(): AutocompleteTrigger<HelpShortcutResult> {
	return {
		id: "help",
		triggerChar: "?",
		position: "line-start",
		consumeTrigger: true,

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Check if line starts with ? (after optional whitespace)
			const trimmed = lineText.trimStart()

			if (!trimmed.startsWith("?")) {
				return null
			}

			// Extract query after ?
			const query = trimmed.substring(1)

			// Close picker if query contains space
			if (query.includes(" ")) {
				return null
			}

			// Calculate trigger index (position of ? in original line)
			const triggerIndex = lineText.length - trimmed.length

			return { query, triggerIndex }
		},

		search: (query: string): HelpShortcutResult[] => {
			if (query.length === 0) {
				// Show all shortcuts when just "?" is typed
				return HELP_SHORTCUTS
			}

			// Filter shortcuts based on query
			const lowerQuery = query.toLowerCase()
			return HELP_SHORTCUTS.filter(
				(item) =>
					item.shortcut.toLowerCase().includes(lowerQuery) ||
					item.description.toLowerCase().includes(lowerQuery),
			)
		},

		renderItem: (item: HelpShortcutResult, isSelected: boolean) => {
			return (
				<Box paddingLeft={2}>
					<Text color={isSelected ? "cyan" : undefined} wrap="truncate-end">
						<Text bold color={isSelected ? "cyan" : "yellow"}>
							{item.shortcut}
						</Text>
						<Text> {item.description}</Text>
					</Text>
				</Box>
			)
		},

		getReplacementText: (item: HelpShortcutResult, _lineText: string, _triggerIndex: number): string => {
			// Only the trigger characters are typeable, so only they get inserted.
			// Anything else is a key press (tab, esc, ctrl + c, ...) and inserting
			// its label would leave text like "shift + tab" in the prompt.
			return TRIGGER_CHARACTER_KEYS.has(item.key) ? item.shortcut : ""
		},

		emptyMessage: "No matching shortcuts",
		debounceMs: 0, // No debounce needed for static list
	}
}
