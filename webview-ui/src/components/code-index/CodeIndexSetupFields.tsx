import type { EmbedderProvider, CodebaseIndexModels, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { DEFAULT_QDRANT_URL } from "./codeIndexSettings"
import { EMBEDDER_PROVIDERS, getEmbedderForm } from "./embedderForms"
import type { EmbedderFormContext } from "./EmbedderFormFields"

type CodeIndexSetupFieldsProps = Omit<EmbedderFormContext, "models" | "t"> & {
	codebaseIndexModels: CodebaseIndexModels | undefined
	/** The chat API profile; a Bedrock profile pre-fills the Bedrock embedder region and profile. */
	apiConfiguration: ProviderSettings | undefined
}

/**
 * Setup group of the code index form: the embedder provider picker, the selected provider's own
 * fields (from `embedderForms`), and the Qdrant URL and API key.
 */
export const CodeIndexSetupFields = ({
	settings: currentSettings,
	formErrors,
	updateSetting,
	openRouterEmbeddingProviders,
	codebaseIndexModels,
	apiConfiguration,
}: CodeIndexSetupFieldsProps) => {
	const { t } = useAppTranslation()

	const getAvailableModels = (): EmbedderFormContext["models"] => {
		const models = codebaseIndexModels?.[currentSettings.codebaseIndexEmbedderProvider]
		return models ? Object.entries(models).map(([id, profile]) => ({ id, profile })) : []
	}

	return (
		<>
			{/* Embedder Provider Section */}
			<div className="space-y-2">
				<label className="text-sm font-medium">{t("settings:codeIndex.embedderProviderLabel")}</label>
				<Select
					value={currentSettings.codebaseIndexEmbedderProvider}
					onValueChange={(value: EmbedderProvider) => {
						updateSetting("codebaseIndexEmbedderProvider", value)
						// Clear model selection when switching providers
						updateSetting("codebaseIndexEmbedderModelId", "")

						// Auto-populate Region and Profile when switching to Bedrock
						// if the main API provider is also configured for Bedrock
						if (value === "bedrock" && apiConfiguration?.apiProvider === "bedrock") {
							// Only populate if currently empty
							if (!currentSettings.codebaseIndexBedrockRegion && apiConfiguration.awsRegion) {
								updateSetting("codebaseIndexBedrockRegion", apiConfiguration.awsRegion)
							}
							if (!currentSettings.codebaseIndexBedrockProfile && apiConfiguration.awsProfile) {
								updateSetting("codebaseIndexBedrockProfile", apiConfiguration.awsProfile)
							}
						}
					}}>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{EMBEDDER_PROVIDERS.map((provider) => (
							<SelectItem key={provider} value={provider}>
								{t(getEmbedderForm(provider)!.labelKey)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Provider-specific settings */}
			{getEmbedderForm(currentSettings.codebaseIndexEmbedderProvider)?.render({
				settings: currentSettings,
				formErrors,
				updateSetting,
				models: getAvailableModels(),
				openRouterEmbeddingProviders,
				t,
			})}

			{/* Qdrant Settings */}
			<div className="space-y-2">
				<label className="text-sm font-medium">{t("settings:codeIndex.qdrantUrlLabel")}</label>
				<Input
					value={currentSettings.codebaseIndexQdrantUrl || ""}
					onChange={(e) => updateSetting("codebaseIndexQdrantUrl", e.target.value)}
					onBlur={(e) => {
						// Set default Qdrant URL if field is empty
						if (!e.target.value.trim()) {
							updateSetting("codebaseIndexQdrantUrl", DEFAULT_QDRANT_URL)
						}
					}}
					placeholder={t("settings:codeIndex.qdrantUrlPlaceholder")}
					className={cn("w-full", {
						"border-[var(--vscode-inputValidation-errorBorder)]": formErrors.codebaseIndexQdrantUrl,
					})}
				/>
				{formErrors.codebaseIndexQdrantUrl && (
					<p className="text-xs text-vscode-errorForeground mt-1 mb-0">{formErrors.codebaseIndexQdrantUrl}</p>
				)}
			</div>

			<div className="space-y-2">
				<label className="text-sm font-medium">{t("settings:codeIndex.qdrantApiKeyLabel")}</label>
				<Input
					type="password"
					value={currentSettings.codeIndexQdrantApiKey || ""}
					onChange={(e) => updateSetting("codeIndexQdrantApiKey", e.target.value)}
					placeholder={t("settings:codeIndex.qdrantApiKeyPlaceholder")}
					className={cn("w-full", {
						"border-[var(--vscode-inputValidation-errorBorder)]": formErrors.codeIndexQdrantApiKey,
					})}
				/>
				{formErrors.codeIndexQdrantApiKey && (
					<p className="text-xs text-vscode-errorForeground mt-1 mb-0">{formErrors.codeIndexQdrantApiKey}</p>
				)}
			</div>
		</>
	)
}
