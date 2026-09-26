import { type RouterModels, mistralDefaultModelId } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedTextField } from "@src/components/ui"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type MistralProps = ProviderFormProps & {
	routerModels?: RouterModels
	simplifySettings?: boolean
}

export const Mistral = ({ apiConfiguration, setApiConfigurationField }: MistralProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="mistralApiKey"
				labelKey="settings:providers.mistralApiKey"
				getKeyUrl="https://console.mistral.ai/"
				getKeyLabelKey="settings:providers.getMistralApiKey"
			/>
			{(apiConfiguration?.apiModelId?.startsWith("codestral-") ||
				(!apiConfiguration?.apiModelId && mistralDefaultModelId.startsWith("codestral-"))) && (
				<>
					<ThemedTextField
						value={apiConfiguration?.mistralCodestralUrl || ""}
						type="url"
						onInput={handleInputChange("mistralCodestralUrl")}
						placeholder="https://codestral.mistral.ai"
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.codestralBaseUrl")}</label>
					</ThemedTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.codestralBaseUrlDesc")}
					</div>
				</>
			)}
		</>
	)
}
