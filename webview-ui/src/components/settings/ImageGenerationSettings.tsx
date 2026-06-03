import React, { useEffect, useMemo } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { IMAGE_GENERATION_MODELS, type ImageGenerationProvider } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// Only OpenRouter remains as an image-generation provider; coerce any legacy "roo" value.
	const currentProvider: ImageGenerationProvider = "openrouter"

	useEffect(() => {
		if ((imageGenerationProvider as string) === "roo") {
			setImageGenerationProvider("openrouter")
		}
	}, [imageGenerationProvider, setImageGenerationProvider])

	const availableModels = useMemo(() => {
		return IMAGE_GENERATION_MODELS.filter((model) => model.provider === currentProvider)
	}, [currentProvider])

	// Derive the current model value - either from props or first available
	const currentModel = useMemo(() => {
		// If we have a stored model, verify it exists for the current provider
		// (check both value and provider since some models have duplicate values)
		if (openRouterImageGenerationSelectedModel) {
			// Find a model that matches BOTH the value AND the current provider
			const modelInfo = IMAGE_GENERATION_MODELS.find(
				(m) => m.value === openRouterImageGenerationSelectedModel && m.provider === currentProvider,
			)
			if (modelInfo) {
				return openRouterImageGenerationSelectedModel
			}
		}
		// Otherwise use first available model for current provider
		return availableModels[0]?.value || IMAGE_GENERATION_MODELS[0].value
	}, [openRouterImageGenerationSelectedModel, availableModels, currentProvider])

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		setOpenRouterImageApiKey(value)
	}

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		setImageGenerationSelectedModel(value)
	}

	const requiresApiKey = currentProvider === "openrouter"
	const isConfigured = !requiresApiKey || (requiresApiKey && openRouterImageApiKey)

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					{/* API Key Configuration (OpenRouter is the only supported provider) */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
						</label>
						<VSCodeTextField
							value={openRouterImageApiKey || ""}
							onInput={(e: any) => handleApiKeyChange(e.target.value)}
							placeholder={t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder")}
							className="w-full"
							type="password"
						/>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
							<a
								href="https://openrouter.ai/keys"
								target="_blank"
								rel="noopener noreferrer"
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
								openrouter.ai/keys
							</a>
						</p>
					</div>

					{/* Model Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<VSCodeDropdown
							value={currentModel}
							onChange={(e: any) => handleModelChange(e.target.value)}
							className="w-full">
							{availableModels.map((model) => (
								<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
									{model.label}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
						</p>
					</div>

					{/* Status Message */}
					{enabled && !isConfigured && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
