import type { ExperimentId, ExtensionState } from "@roo-code/types"

/**
 * Writes one field of the Settings view's Save buffer. Keyed on the webview
 * state's data (not the context type), so a context setter name is not a key.
 */
export type SetCachedStateField<K extends keyof ExtensionState> = (field: K, value: ExtensionState[K]) => void

export type SetExperimentEnabled = (id: ExperimentId, enabled: boolean) => void
