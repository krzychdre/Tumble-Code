/**
 * The two React contexts of the extension state store (roadmap P1).
 *
 * - `ExtensionStateContext` holds the flattened value (state + actions). Its
 *   value identity changes on every committed store change, so every legacy
 *   `useExtensionState()` consumer re-renders per update — unchanged
 *   behavior.
 * - `ExtensionStoreContext` holds the store client handle. Its value is
 *   stable for the provider's lifetime, so `useExtensionSelector` consumers
 *   subscribe through it without becoming value-context consumers — that is
 *   what lets them skip re-renders when their slice did not change.
 *
 * Both contexts live in this leaf module so the provider and the selector
 * hook can import them without an import cycle.
 */
import { createContext } from "react"

import type { ExtensionStateContextType } from "./ExtensionStateContext"
import type { ExtensionStore } from "./extensionStateReducer"

/** The subset of `ExtensionStoreClient` the selector hook needs. */
export interface ExtensionStoreHandle {
	readonly subscribe: (listener: () => void) => () => void
	/** The read model for the current store version (the flattened value). */
	readonly getValue: () => ExtensionStateContextType
	/** The raw store, for provider-side effects only. */
	readonly getStore: () => ExtensionStore
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStoreContext = createContext<ExtensionStoreHandle | undefined>(undefined)
