import { useState, useSyncExternalStore } from "react"

import type { ExtensionState } from "@tumble-code/types"

import { pickCachedSettings } from "./schema"
import { createSettingsDraftStore } from "./settingsDraftStore"

/**
 * The Save buffer of the Settings view: a copy of the settings taken from the
 * webview state, edited by the form and sent by the Save button, plus the
 * "something changed" flag that enables Save and the discard dialog.
 *
 * The buffer lives in a `SettingsDraftStore` created once per mount; the
 * sections read and write it through `SettingsDraftProvider` + `useSetting`,
 * this hook gives the Settings view the whole buffer for Save.
 */
export function useCachedSettings(initialState: Partial<ExtensionState>) {
	const [store] = useState(() => createSettingsDraftStore(pickCachedSettings(initialState)))
	const cachedState = useSyncExternalStore(store.subscribe, store.getState, store.getState)
	const isChangeDetected = useSyncExternalStore(store.subscribe, store.isDirty, store.isDirty)
	// §2.10: the tabs (scopes) with unsaved edits, for the dots in the tab list.
	const dirtyScopes = useSyncExternalStore(store.subscribe, store.getDirtyScopes, store.getDirtyScopes)

	return {
		store,
		cachedState,
		isChangeDetected,
		dirtyScopes,
		setChangeDetected: store.setDirty,
		setApiConfigurationField: store.setApiConfigurationField,
		mergeFromState: store.mergeFromState,
		resetToState: store.resetToState,
	}
}
