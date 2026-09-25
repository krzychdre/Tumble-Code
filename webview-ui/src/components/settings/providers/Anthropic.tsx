import { useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

import { noTransform } from "../transforms"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type AnthropicProps = ProviderFormProps & {
	simplifySettings?: boolean
}

export const Anthropic = ({ apiConfiguration, setApiConfigurationField }: AnthropicProps) => {
	const { t } = useAppTranslation()
	const selectedModel = useSelectedModel(apiConfiguration)

	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)

	// Check if the current model supports 1M context beta
	const supports1MContextBeta =
		selectedModel?.id === "claude-sonnet-4-20250514" ||
		selectedModel?.id === "claude-sonnet-4-5" ||
		selectedModel?.id === "claude-sonnet-4-6" ||
		selectedModel?.id === "claude-opus-4-6"

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="apiKey"
				labelKey="settings:providers.anthropicApiKey"
				getKeyUrl="https://console.anthropic.com/settings/keys"
				getKeyLabelKey="settings:providers.getAnthropicApiKey"
			/>
			<div>
				<Checkbox
					checked={anthropicBaseUrlSelected}
					onChange={(checked: boolean) => {
						setAnthropicBaseUrlSelected(checked)

						if (!checked) {
							setApiConfigurationField("anthropicBaseUrl", "")
							setApiConfigurationField("anthropicUseAuthToken", false)
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{anthropicBaseUrlSelected && (
					<>
						<VSCodeTextField
							value={apiConfiguration?.anthropicBaseUrl || ""}
							type="url"
							onInput={handleInputChange("anthropicBaseUrl")}
							placeholder="https://api.anthropic.com"
							className="w-full mt-1"
						/>
						<Checkbox
							checked={apiConfiguration?.anthropicUseAuthToken ?? false}
							onChange={handleInputChange("anthropicUseAuthToken", noTransform)}
							className="w-full mt-1">
							{t("settings:providers.anthropicUseAuthToken")}
						</Checkbox>
					</>
				)}
			</div>
			{supports1MContextBeta && (
				<div>
					<Checkbox
						checked={apiConfiguration?.anthropicBeta1MContext ?? false}
						onChange={(checked: boolean) => {
							setApiConfigurationField("anthropicBeta1MContext", checked)
						}}>
						{t("settings:providers.anthropic1MContextBetaLabel")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">
						{t("settings:providers.anthropic1MContextBetaDescription")}
					</div>
				</div>
			)}
		</>
	)
}
