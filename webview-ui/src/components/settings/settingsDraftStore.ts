import type { ExperimentId, ExtensionState, ProviderSettings } from "@roo-code/types"

import { type BufferedKey, type CachedSettings, isSettingChange, pickCachedSettings } from "./schema"

/** Semantic equality for provider fields synced by the forms themselves. */
const areValuesEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (a == null && b == null) return true
	if (typeof a !== typeof b) return false
	if (typeof a === "object" && typeof b === "object") {
		return JSON.stringify(a) === JSON.stringify(b)
	}
	return false
}

/**
 * The Save buffer of the Settings view (the `cachedState` rule of AGENTS.md):
 * a copy of the settings taken from the webview state, edited by the form and
 * sent by the Save button, plus the "something changed" flag that enables Save
 * and the discard dialog.
 *
 * It is an external store (subscribe + snapshot) rather than React state so a
 * control can subscribe to one key with `useSetting(key)` and skip the renders
 * caused by edits of other keys (D13). The buffer object is replaced on every
 * change and each key keeps its value's identity until that key is written,
 * so `getState()[key]` is a valid `useSyncExternalStore` snapshot.
 */
export interface SettingsDraftStore {
	subscribe: (listener: () => void) => () => void
	/** The buffer; a new object after every change. */
	getState: () => CachedSettings
	/** Whether the buffer holds edits Save has not sent yet. */
	isDirty: () => boolean
	setDirty: (dirty: boolean) => void
	/** Writes one buffered setting; a value equal to the buffered one (per the schema row) is a no-op. */
	setField: <K extends BufferedKey>(key: K, value: CachedSettings[K]) => void
	/**
	 * Writes one field of the buffered provider profile. With `isUserAction`
	 * false (a form syncing its own defaults) filling an empty field or writing
	 * an equal value does not mark the buffer dirty.
	 */
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	setExperimentEnabled: (id: ExperimentId, enabled: boolean) => void
	/** Takes the settings of `state` over the buffer (keys absent from `state` keep their buffered value). */
	mergeFromState: (state: Partial<ExtensionState>) => void
	/** Throws away every unsaved edit. */
	resetToState: (state: Partial<ExtensionState>) => void
	/**
	 * Names where the next edits come from (the Settings view passes the open
	 * tab). Each write that marks the buffer dirty records the current scope.
	 */
	setScope: (scope: string | undefined) => void
	/**
	 * The scopes with unsaved edits (§2.10: the tabs that get a dot). Empty
	 * whenever the buffer is clean; the same object until it changes.
	 */
	getDirtyScopes: () => ReadonlySet<string>
}

const NO_SCOPES: ReadonlySet<string> = new Set()

export function createSettingsDraftStore(initial: CachedSettings): SettingsDraftStore {
	let state = initial
	let dirty = false
	let scope: string | undefined
	let dirtyScopes = NO_SCOPES
	const listeners = new Set<() => void>()

	const emit = () => {
		for (const listener of Array.from(listeners)) {
			listener()
		}
	}

	/**
	 * `markScope`: this write is an edit that marks the buffer dirty, so the
	 * current scope joins the dirty scopes. A clean buffer has none.
	 */
	const commit = (nextState: CachedSettings, nextDirty: boolean, markScope = false) => {
		const nextScopes = !nextDirty
			? NO_SCOPES
			: markScope && scope !== undefined && !dirtyScopes.has(scope)
				? new Set([...dirtyScopes, scope])
				: dirtyScopes
		if (nextState === state && nextDirty === dirty && nextScopes === dirtyScopes) {
			return
		}
		state = nextState
		dirty = nextDirty
		dirtyScopes = nextScopes
		emit()
	}

	return {
		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		getState: () => state,
		isDirty: () => dirty,
		setDirty: (nextDirty) => commit(state, nextDirty, nextDirty),
		setField: (key, value) => {
			if (!isSettingChange(key, state[key], value)) {
				return
			}
			commit({ ...state, [key]: value }, true, true)
		},
		setApiConfigurationField: (field, value, isUserAction = true) => {
			if (state.apiConfiguration?.[field] === value) {
				return
			}

			const previousValue = state.apiConfiguration?.[field]

			// Only skip change detection for automatic initialization (not user actions)
			// This prevents the dirty state when the component initializes and auto-syncs values
			const isInitialSync =
				!isUserAction &&
				(previousValue === undefined || previousValue === "" || previousValue === null) &&
				value !== undefined &&
				value !== "" &&
				value !== null

			// Also skip if it's an automatic sync with semantically equal values
			const isAutomaticNoOpSync = !isUserAction && areValuesEqual(previousValue, value)

			const isEdit = !isInitialSync && !isAutomaticNoOpSync
			commit(
				{
					...state,
					apiConfiguration: { ...state.apiConfiguration, [field]: value } as ProviderSettings,
				},
				dirty || isEdit,
				isEdit,
			)
		},
		setExperimentEnabled: (id, enabled) => {
			if (state.experiments?.[id] === enabled) {
				return
			}
			commit(
				{
					...state,
					experiments: { ...state.experiments, [id]: enabled } as ExtensionState["experiments"],
				},
				true,
				true,
			)
		},
		mergeFromState: (fromState) => commit({ ...state, ...pickCachedSettings(fromState) }, false),
		resetToState: (fromState) => commit(pickCachedSettings(fromState), false),
		setScope: (nextScope) => {
			scope = nextScope
		},
		getDirtyScopes: () => dirtyScopes,
	}
}
