import { useState } from "react"
import { Checkbox } from "vscrui"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedTextField } from "@src/components/ui"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type GeminiProps = ProviderFormProps

export const Gemini = ({ apiConfiguration, setApiConfigurationField }: GeminiProps) => {
	const { t } = useAppTranslation()

	const [googleGeminiBaseUrlSelected, setGoogleGeminiBaseUrlSelected] = useState(
		!!apiConfiguration?.googleGeminiBaseUrl,
	)

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="geminiApiKey"
				labelKey="settings:providers.geminiApiKey"
				getKeyUrl="https://ai.google.dev/"
				getKeyLabelKey="settings:providers.getGeminiApiKey"
			/>

			<div>
				<Checkbox
					data-testid="checkbox-custom-base-url"
					checked={googleGeminiBaseUrlSelected}
					onChange={(checked: boolean) => {
						setGoogleGeminiBaseUrlSelected(checked)
						if (!checked) {
							setApiConfigurationField("googleGeminiBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{googleGeminiBaseUrlSelected && (
					<ThemedTextField
						value={apiConfiguration?.googleGeminiBaseUrl || ""}
						type="url"
						onInput={handleInputChange("googleGeminiBaseUrl")}
						placeholder={t("settings:defaults.geminiUrl")}
						className="w-full mt-1"
					/>
				)}
			</div>
		</>
	)
}
