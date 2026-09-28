/**
 * `useExtensionSelector(selector)` — subscribe to a slice of the extension
 * store (roadmap P1).
 *
 * Built on `useSyncExternalStore`. The snapshot React subscribes to is the
 * **selected value** itself, not the store version: `getSnapshot` caches the
 * selector result per hook instance and keeps the previous reference while
 * the selector's equality (`Object.is` default, optional `isEqual` override)
 * says it is unchanged, so React sees an identical snapshot and skips the
 * re-render entirely. Subscribing to a raw version counter here would defeat
 * the purpose — every committed store change bumps it and re-renders every
 * consumer, which is exactly the defect P1 fixes.
 *
 * The hook subscribes through the stable `ExtensionStoreContext` (the store
 * client handle), NOT the value context: reading the value context here would
 * turn every selector consumer back into a full-context consumer and defeat
 * the selector.
 *
 * The selector receives the flattened context value (`ExtensionStateContextType`),
 * the same object `useExtensionState()` returns, so selectors written against
 * destructured state work verbatim: `(s) => s.clineMessages`.
 *
 * Guidelines for consumers:
 * - Select the smallest slice; prefer primitives.
 * - For several values, either call the hook once per value, or return an
 *   array/object and pass a custom `isEqual` (shallow compare) — the default
 *   `Object.is` would see a new container identity per store version.
 */
import { useCallback, useContext, useRef, useSyncExternalStore } from "react"

import { ExtensionStoreContext } from "./extensionContexts"
import type { ExtensionStateContextType } from "./ExtensionStateContext"

export type ExtensionSelector<T> = (value: ExtensionStateContextType) => T

export function useExtensionSelectorHook<T>(
	selector: ExtensionSelector<T>,
	isEqual: (a: T, b: T) => boolean = Object.is,
): T {
	const client = useContext(ExtensionStoreContext)

	if (client === undefined) {
		throw new Error("useExtensionSelector must be used within an ExtensionStateContextProvider")
	}

	// The latest accepted snapshot, per hook instance. `getSnapshot` may be
	// called multiple times per render and again between renders; it must
	// return a reference-stable value while the selected slice is unchanged
	// or React reports "getSnapshot should be cached" and loops.
	const snapshotRef = useRef<{ value: T } | undefined>(undefined)
	const getSnapshot = useCallback((): T => {
		const next = selector(client.getValue())
		const prev = snapshotRef.current
		if (prev === undefined || !isEqual(prev.value, next)) {
			snapshotRef.current = { value: next }
		}
		return snapshotRef.current!.value
	}, [client, isEqual, selector])

	// The store handle is stable for the provider's lifetime, so the
	// subscription is established once.
	const subscribe = useCallback((listener: () => void) => client.subscribe(listener), [client])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
