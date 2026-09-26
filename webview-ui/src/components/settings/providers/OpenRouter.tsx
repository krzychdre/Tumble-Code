import { useState } from "react"
import { VSCRUICheckbox as Checkbox } from "@src/components/ui/vscrui-checkbox"

import { type OrganizationAllowList, type RouterModels, openRouterDefaultModelId } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedTextField } from "@src/components/ui"
import { getOpenRouterAuthUrl } from "@src/oauth/urls"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { ModelPicker } from "../ModelPicker"
import { OpenRouterBalanceDisplay } from "./OpenRouterBalanceDisplay"
import { type ProviderFormProps, useProviderField } from "./shared"

type OpenRouterProps = ProviderFormProps & {
	routerModels?: RouterModels
	selectedModelId: string
	uriScheme: string | undefined
	simplifySettings?: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const OpenRouter = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	uriScheme,
	simplifySettings,
	organizationAllowList,
	modelValidationError,
}: OpenRouterProps) => {
	const { t } = useAppTranslation()

	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<ThemedTextField
				value={apiConfiguration?.openRouterApiKey || ""}
				type="password"
				onInput={handleInputChange("openRouterApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.openRouterApiKey")}</label>
					{apiConfiguration?.openRouterApiKey && (
						<OpenRouterBalanceDisplay
							apiKey={apiConfiguration.openRouterApiKey}
							baseUrl={apiConfiguration.openRouterBaseUrl}
						/>
					)}
				</div>
			</ThemedTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getOpenRouterApiKey")}
				</VSCodeButtonLink>
			)}
			{!simplifySettings && (
				<div>
					<Checkbox
						checked={openRouterBaseUrlSelected}
						onChange={(checked: boolean) => {
							setOpenRouterBaseUrlSelected(checked)

							if (!checked) {
								setApiConfigurationField("openRouterBaseUrl", "")
							}
						}}>
						{t("settings:providers.useCustomBaseUrl")}
					</Checkbox>
					{openRouterBaseUrlSelected && (
						<ThemedTextField
							value={apiConfiguration?.openRouterBaseUrl || ""}
							type="url"
							onInput={handleInputChange("openRouterBaseUrl")}
							placeholder="Default: https://openrouter.ai/api/v1"
							className="w-full mt-1"
						/>
					)}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={openRouterDefaultModelId}
				models={routerModels?.openrouter ?? {}}
				modelIdKey="openRouterModelId"
				serviceName="OpenRouter"
				serviceUrl="https://openrouter.ai/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
