import { useCallback, useMemo } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useProviderModels } from "@src/components/ui/hooks/useProviderModels"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type OllamaProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const Ollama = ({ apiConfiguration, setApiConfigurationField }: OllamaProps) => {
	const { t } = useAppTranslation()

	const { models: ollamaModels = {} } = useProviderModels("ollama", {
		baseUrl: apiConfiguration.ollamaBaseUrl,
		apiKey: apiConfiguration.ollamaApiKey,
	})

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	// Check if the selected model exists in the fetched models
	const modelNotAvailableError = useMemo(() => {
		const selectedModel = apiConfiguration?.ollamaModelId
		if (!selectedModel) return undefined

		// Check if model exists in local ollama models
		if (Object.keys(ollamaModels).length > 0 && selectedModel in ollamaModels) {
			return undefined // Model is available locally
		}

		if (Object.keys(ollamaModels).length > 0 && !(selectedModel in ollamaModels)) {
			return t("settings:validation.modelAvailability", { modelId: selectedModel })
		}

		// If neither source has loaded yet, don't show warning
		return undefined
	}, [apiConfiguration?.ollamaModelId, ollamaModels, t])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.ollamaBaseUrl || ""}
				type="url"
				onInput={handleInputChange("ollamaBaseUrl")}
				placeholder={t("settings:defaults.ollamaUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ollama.baseUrl")}</label>
			</VSCodeTextField>
			{apiConfiguration?.ollamaBaseUrl && (
				<VSCodeTextField
					value={apiConfiguration?.ollamaApiKey || ""}
					type="password"
					onInput={handleInputChange("ollamaApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.ollama.apiKey")}</label>
					<div className="text-xs text-vscode-descriptionForeground mt-1">
						{t("settings:providers.ollama.apiKeyHelp")}
					</div>
				</VSCodeTextField>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId=""
				models={ollamaModels}
				modelIdKey="ollamaModelId"
				serviceName="Ollama"
				serviceUrl="https://ollama.ai"
				errorMessage={modelNotAvailableError}
				hidePricing
			/>
			<VSCodeTextField
				value={apiConfiguration?.ollamaNumCtx?.toString() || ""}
				onInput={(e) => {
					const value = (e.target as HTMLInputElement)?.value
					if (value === "") {
						setApiConfigurationField("ollamaNumCtx", undefined)
					} else {
						const numValue = parseInt(value, 10)
						if (!isNaN(numValue) && numValue >= 128) {
							setApiConfigurationField("ollamaNumCtx", numValue)
						}
					}
				}}
				placeholder="e.g., 4096"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ollama.numCtx")}</label>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:providers.ollama.numCtxHelp")}
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.ollama.description")}
				<span className="text-vscode-errorForeground ml-1">{t("settings:providers.ollama.warning")}</span>
			</div>
		</>
	)
}
