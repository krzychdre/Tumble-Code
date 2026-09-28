/**
 * Autocomplete system for CLI input.
 *
 * This module provides a generic, extensible autocomplete system that supports
 * multiple trigger patterns (like @ for files, / for commands) through a
 * plugin-like trigger architecture.
 *
 * @example
 * ```tsx
 * import { AutocompleteInput } from './autocomplete/AutocompleteInput'
 * import {
 *   PickerSelect,
 *   createFileTrigger,
 *   createSlashCommandTrigger,
 * } from './autocomplete'
 *
 * const triggers = [
 *   createFileTrigger({ onSearch, getResults }),
 *   createSlashCommandTrigger({ getCommands }),
 * ]
 *
 * <AutocompleteInput
 *   triggers={triggers}
 *   onSubmit={handleSubmit}
 * />
 * ```
 */

// Main components (AutocompleteInput itself is imported from ./AutocompleteInput.js directly)
export { type AutocompleteInputHandle } from "./AutocompleteInput.js"
export { PickerSelect } from "./PickerSelect.js"

// Types
export * from "./types.js"

// Triggers
export * from "./triggers/index.js"
