import { useState, useEffect, useMemo, useRef } from "react"
import { z } from "zod"

import { CODEBASE_INDEX_DEFAULTS, type ExtensionMessage, type CodebaseIndexConfig } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { onExtensionMessage } from "@src/utils/extensionBus"

import { SECRET_PLACEHOLDER, type CodeIndexTranslate, type LocalCodeIndexSettings } from "./codeIndexSettings"
import { EMBEDDER_SECRETS, createValidationSchema } from "./embedderForms"

export type CodeIndexSaveStatus = "idle" | "saving" | "saved" | "error"

/** How long the error line of a failed save stays visible. */
const SAVE_ERROR_VISIBLE_MS = 5000

// Default settings template
const getDefaultSettings = (): LocalCodeIndexSettings => ({
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: "",
	codebaseIndexEmbedderProvider: "openai",
	codebaseIndexEmbedderBaseUrl: "",
	codebaseIndexEmbedderModelId: "",
	codebaseIndexEmbedderModelDimension: undefined,
	codebaseIndexSearchMaxResults: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
	codebaseIndexSearchMinScore: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
	codebaseIndexBedrockRegion: "",
	codebaseIndexBedrockProfile: "",
	codeIndexOpenAiKey: "",
	codeIndexQdrantApiKey: "",
	codebaseIndexOpenAiCompatibleBaseUrl: "",
	codebaseIndexOpenAiCompatibleApiKey: "",
	codebaseIndexGeminiApiKey: "",
	codebaseIndexMistralApiKey: "",
	codebaseIndexOpenRouterApiKey: "",
	codebaseIndexOpenRouterSpecificProvider: "",
})

/**
 * The code index settings form state: the settings as loaded (`initialSettings`) and as edited
 * (`currentSettings`), stored secrets shown as a placeholder, validation, and the atomic save with
 * the host's answer. A secret still showing the placeholder is neither an unsaved change nor sent
 * back on save, so the host keeps the stored secret.
 */
export function useCodeIndexSettings(codebaseIndexConfig: CodebaseIndexConfig | undefined, t: CodeIndexTranslate) {
	const [saveStatus, setSaveStatus] = useState<CodeIndexSaveStatus>("idle")
	const [saveError, setSaveError] = useState<string | null>(null)

	// Form validation state
	const [formErrors, setFormErrors] = useState<Record<string, string>>({})

	// Initial settings state - stores the settings when popover opens
	const [initialSettings, setInitialSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Current settings state - tracks user changes
	const [currentSettings, setCurrentSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Initialize settings from global state
	useEffect(() => {
		if (codebaseIndexConfig) {
			const settings = {
				codebaseIndexEnabled: codebaseIndexConfig.codebaseIndexEnabled ?? true,
				codebaseIndexQdrantUrl: codebaseIndexConfig.codebaseIndexQdrantUrl || "",
				codebaseIndexEmbedderProvider: codebaseIndexConfig.codebaseIndexEmbedderProvider || "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig.codebaseIndexEmbedderBaseUrl || "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig.codebaseIndexEmbedderModelId || "",
				codebaseIndexEmbedderModelDimension:
					codebaseIndexConfig.codebaseIndexEmbedderModelDimension || undefined,
				codebaseIndexSearchMaxResults:
					codebaseIndexConfig.codebaseIndexSearchMaxResults ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
				codebaseIndexSearchMinScore:
					codebaseIndexConfig.codebaseIndexSearchMinScore ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
				codebaseIndexBedrockRegion: codebaseIndexConfig.codebaseIndexBedrockRegion || "",
				codebaseIndexBedrockProfile: codebaseIndexConfig.codebaseIndexBedrockProfile || "",
				codeIndexOpenAiKey: "",
				codeIndexQdrantApiKey: "",
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl || "",
				codebaseIndexOpenAiCompatibleApiKey: "",
				codebaseIndexGeminiApiKey: "",
				codebaseIndexMistralApiKey: "",
				codebaseIndexOpenRouterApiKey: "",
				codebaseIndexOpenRouterSpecificProvider:
					codebaseIndexConfig.codebaseIndexOpenRouterSpecificProvider || "",
			}
			setInitialSettings(settings)
			setCurrentSettings(settings)

			// Request secret status to check if secrets exist
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
	}, [codebaseIndexConfig])

	// Use a ref to capture current settings for the save handler
	const currentSettingsRef = useRef(currentSettings)
	currentSettingsRef.current = currentSettings

	// Hides the error of a failed save after SAVE_ERROR_VISIBLE_MS. A new save cancels it, so the
	// old timer cannot reset a running save to "idle".
	const saveErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const clearSaveErrorTimer = () => {
		if (saveErrorTimerRef.current !== undefined) {
			clearTimeout(saveErrorTimerRef.current)
			saveErrorTimerRef.current = undefined
		}
	}
	useEffect(() => clearSaveErrorTimer, [])

	// Listen for save responses
	useEffect(() => {
		const handleMessage = (message: ExtensionMessage) => {
			if (message.type === "codeIndexSettingsSaved") {
				if (message.success) {
					setSaveStatus("saved")
					// Update initial settings to match current settings after successful save
					// This ensures hasUnsavedChanges becomes false
					const savedSettings = { ...currentSettingsRef.current }
					setInitialSettings(savedSettings)
					// Also update current settings to maintain consistency
					setCurrentSettings(savedSettings)
					// Request secret status to ensure we have the latest state
					// This is important to maintain placeholder display after save

					vscode.postMessage({ type: "requestCodeIndexSecretStatus" })

					setSaveStatus("idle")
				} else {
					setSaveStatus("error")
					setSaveError(message.error || t("settings:codeIndex.saveError"))
					// Clear error message after 5 seconds
					clearSaveErrorTimer()
					saveErrorTimerRef.current = setTimeout(() => {
						saveErrorTimerRef.current = undefined
						setSaveStatus("idle")
						setSaveError(null)
					}, SAVE_ERROR_VISIBLE_MS)
				}
			}
		}

		return onExtensionMessage("codeIndexSettingsSaved", handleMessage)
	}, [t])

	// Listen for secret status
	useEffect(() => {
		const handleMessage = (message: ExtensionMessage) => {
			if (message.type === "codeIndexSecretStatus") {
				// Update settings to show placeholders for existing secrets
				const secretStatus = message.values as NonNullable<ExtensionMessage["values"]>

				// Update both current and initial settings based on what secrets exist
				const updateWithSecrets = (prev: LocalCodeIndexSettings): LocalCodeIndexSettings => {
					const updated = { ...prev }

					// Only update to placeholder if the field is currently empty or already a placeholder
					// This preserves user input when they're actively editing
					const secrets = [
						{ field: "codeIndexQdrantApiKey" as const, statusFlag: "hasQdrantApiKey" },
						...EMBEDDER_SECRETS,
					]
					for (const { field, statusFlag } of secrets) {
						if (!prev[field] || prev[field] === SECRET_PLACEHOLDER) {
							;(updated as Record<string, unknown>)[field] = secretStatus[statusFlag]
								? SECRET_PLACEHOLDER
								: ""
						}
					}

					return updated
				}

				// Only update settings if we're not in the middle of saving
				// After save is complete (saved status), we still want to update to maintain consistency
				if (saveStatus === "idle" || saveStatus === "saved") {
					setCurrentSettings(updateWithSecrets)
					setInitialSettings(updateWithSecrets)
				}
			}
		}

		return onExtensionMessage("codeIndexSecretStatus", handleMessage)
	}, [saveStatus])

	// Generic comparison function that detects changes between initial and current settings
	const hasUnsavedChanges = useMemo(() => {
		// Get all keys from both objects to handle any field
		const allKeys = [...Object.keys(initialSettings), ...Object.keys(currentSettings)] as Array<
			keyof LocalCodeIndexSettings
		>

		// Use a Set to ensure unique keys
		const uniqueKeys = Array.from(new Set(allKeys))

		for (const key of uniqueKeys) {
			const currentValue = currentSettings[key]
			const initialValue = initialSettings[key]

			// For secret fields, check if the value has been modified from placeholder
			if (currentValue === SECRET_PLACEHOLDER) {
				// If it's still showing placeholder, no change
				continue
			}

			// Compare values - handles all types including undefined
			if (currentValue !== initialValue) {
				return true
			}
		}

		return false
	}, [currentSettings, initialSettings])

	const updateSetting = (key: keyof LocalCodeIndexSettings, value: any) => {
		setCurrentSettings((prev) => ({ ...prev, [key]: value }))
		// Clear validation error for this field when user starts typing
		if (formErrors[key]) {
			setFormErrors((prev) => {
				const newErrors = { ...prev }
				delete newErrors[key]
				return newErrors
			})
		}
	}

	// Validation function
	const validateSettings = (): boolean => {
		const schema = createValidationSchema(currentSettings.codebaseIndexEmbedderProvider, t)

		// Prepare data for validation
		const dataToValidate: any = {}
		for (const [key, value] of Object.entries(currentSettings)) {
			// For secret fields with placeholder values, treat them as valid (they exist in backend)
			if (value === SECRET_PLACEHOLDER) {
				// Add a dummy value that will pass validation for these fields
				if (EMBEDDER_SECRETS.some((secret) => secret.field === key)) {
					dataToValidate[key] = "placeholder-valid"
				}
			} else {
				dataToValidate[key] = value
			}
		}

		try {
			// Validate using the schema
			schema.parse(dataToValidate)
			setFormErrors({})
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errors: Record<string, string> = {}
				// Keep the first issue per field: an empty URL fails `min(1)` and then `url()`, and the
				// "required" message from the first check is the one the user needs to see.
				error.issues.forEach((err) => {
					const field = err.path[0]
					if (field && !(field in errors)) {
						errors[field as string] = err.message
					}
				})
				setFormErrors(errors)
			}
			return false
		}
	}

	const handleSaveSettings = () => {
		// Validate settings before saving
		if (!validateSettings()) {
			return
		}

		clearSaveErrorTimer()
		setSaveStatus("saving")
		setSaveError(null)

		// Prepare settings to save
		const settingsToSave: any = {}

		// Iterate through all current settings
		for (const [key, value] of Object.entries(currentSettings)) {
			// For secret fields with placeholder, don't send the placeholder
			// but also don't send an empty string - just skip the field
			// This tells the backend to keep the existing secret
			if (value === SECRET_PLACEHOLDER) {
				// Skip sending placeholder values - backend will preserve existing secrets
				continue
			}

			// Include all other fields, including empty strings (which clear secrets)
			settingsToSave[key] = value
		}

		// Always include codebaseIndexEnabled to ensure it's persisted
		settingsToSave.codebaseIndexEnabled = currentSettings.codebaseIndexEnabled

		// Save settings to backend
		vscode.postMessage({
			type: "saveCodeIndexSettingsAtomic",
			codeIndexSettings: settingsToSave,
		})
	}

	/** Drops the edits and the validation errors: back to the settings as loaded. */
	const discardChanges = () => {
		setCurrentSettings(initialSettings)
		setFormErrors({}) // Clear any validation errors
	}

	return {
		currentSettings,
		formErrors,
		saveStatus,
		saveError,
		hasUnsavedChanges,
		updateSetting,
		handleSaveSettings,
		discardChanges,
	}
}
