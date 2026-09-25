import { useCallback, useState } from "react"

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
 * The Save buffer of the Settings view: a copy of the settings taken from the
 * webview state, edited by the form and sent by the Save button, plus the
 * "something changed" flag that enables Save and the discard dialog.
 */
export function useCachedSettings(initialState: Partial<ExtensionState>) {
	const [cachedState, setCachedState] = useState<CachedSettings>(() => pickCachedSettings(initialState))
	const [isChangeDetected, setChangeDetected] = useState(false)

	const setCachedStateField = useCallback(<K extends BufferedKey>(field: K, value: CachedSettings[K]) => {
		setCachedState((prevState) => {
			if (!isSettingChange(field, prevState[field], value)) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, [field]: value }
		})
	}, [])

	const setApiConfigurationField = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction: boolean = true) => {
			setCachedState((prevState) => {
				if (prevState.apiConfiguration?.[field] === value) {
					return prevState
				}

				const previousValue = prevState.apiConfiguration?.[field]

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

				if (!isInitialSync && !isAutomaticNoOpSync) {
					setChangeDetected(true)
				}
				return {
					...prevState,
					apiConfiguration: { ...prevState.apiConfiguration, [field]: value } as ProviderSettings,
				}
			})
		},
		[],
	)

	const setExperimentEnabled = useCallback((id: ExperimentId, enabled: boolean) => {
		setCachedState((prevState) => {
			if (prevState.experiments?.[id] === enabled) {
				return prevState
			}

			setChangeDetected(true)
			return {
				...prevState,
				experiments: { ...prevState.experiments, [id]: enabled } as ExtensionState["experiments"],
			}
		})
	}, [])

	/** Takes the settings of `state` over the buffer (keys absent from `state` keep their buffered value). */
	const mergeFromState = useCallback((state: Partial<ExtensionState>) => {
		setCachedState((prevState) => ({ ...prevState, ...pickCachedSettings(state) }))
		setChangeDetected(false)
	}, [])

	/** Throws away every unsaved edit. */
	const resetToState = useCallback((state: Partial<ExtensionState>) => {
		setCachedState(pickCachedSettings(state))
		setChangeDetected(false)
	}, [])

	return {
		cachedState,
		isChangeDetected,
		setChangeDetected,
		setCachedStateField,
		setApiConfigurationField,
		setExperimentEnabled,
		mergeFromState,
		resetToState,
	}
}
