import { createContext, useCallback, useContext, useSyncExternalStore } from "react"

import type { BufferedKey, CachedSettings } from "./schema"
import type { SettingsDraftStore } from "./settingsDraftStore"

/**
 * The Settings view's Save buffer, handed to the sections without props
 * (D13). The value is the store itself, whose identity never changes, so the
 * context never re-renders a consumer; `useSetting` subscribes to one key.
 */
const SettingsDraftContext = createContext<SettingsDraftStore | undefined>(undefined)

export const SettingsDraftProvider = SettingsDraftContext.Provider

/** The whole draft store: for the writes `useSetting` does not cover (experiments, provider fields, dirty flag). */
export function useSettingsDraft(): SettingsDraftStore {
	const store = useContext(SettingsDraftContext)
	if (store === undefined) {
		throw new Error("useSetting/useSettingsDraft must be used within a SettingsDraftProvider")
	}
	return store
}

/**
 * One buffered setting as `[value, set]`, like `useState`. The value comes
 * from the Save buffer (never the live extension state) and `set` writes the
 * buffer only, marking the form dirty; Save sends it. The component re-renders
 * only when this key changes. `set` keeps its identity while `key` does.
 */
export function useSetting<K extends BufferedKey>(
	key: K,
): [value: CachedSettings[K], set: (value: CachedSettings[K]) => void] {
	const store = useSettingsDraft()
	const getValue = useCallback(() => store.getState()[key], [store, key])
	const value = useSyncExternalStore(store.subscribe, getValue, getValue)
	const set = useCallback((next: CachedSettings[K]) => store.setField(key, next), [store, key])
	return [value, set]
}
