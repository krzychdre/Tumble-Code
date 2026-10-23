import { useId, useState } from "react"
import { ExternalLink } from "lucide-react"
import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"

import { type OrganizationAllowList, type RouterModels, openRouterDefaultModelId } from "@tumble-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/hooks/models/useOpenRouterModelProviders"
import { getOpenRouterAuthUrl } from "@src/oauth/urls"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { ModelPicker } from "../ModelPicker"
import { OpenRouterBalanceDisplay } from "./OpenRouterBalanceDisplay"
import { type ProviderFormProps, useProviderField } from "./shared"
import { settingDescription } from "../SettingsCard"

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
	selectedModelId,
	uriScheme,
	simplifySettings,
	organizationAllowList,
	modelValidationError,
}: OpenRouterProps) => {
	const { t } = useAppTranslation()

	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)

	const handleInputChange = useProviderField(setApiConfigurationField)
	const apiKeyId = useId()

	const openRouterModels = routerModels?.openrouter
	const { data: modelProviders } = useOpenRouterModelProviders(
		apiConfiguration.openRouterModelId,
		apiConfiguration.openRouterBaseUrl,
		{
			enabled:
				!!apiConfiguration.openRouterModelId &&
				!!openRouterModels &&
				Object.keys(openRouterModels).length > 1 &&
				apiConfiguration.openRouterModelId in openRouterModels,
		},
	)

	return (
		<>
			<div className="w-full leading-[normal]">
				<div className="flex justify-between items-center mb-1">
					<label htmlFor={apiKeyId} className="block font-medium">
						{t("settings:providers.openRouterApiKey")}
					</label>
					{apiConfiguration?.openRouterApiKey && (
						<OpenRouterBalanceDisplay
							apiKey={apiConfiguration.openRouterApiKey}
							baseUrl={apiConfiguration.openRouterBaseUrl}
						/>
					)}
				</div>
				<Input
					id={apiKeyId}
					value={apiConfiguration?.openRouterApiKey || ""}
					type="password"
					onChange={handleInputChange("openRouterApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
				/>
				<div className={settingDescription}>{t("settings:providers.apiKeyStorageNotice")}</div>
			</div>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getOpenRouterApiKey")}
				</VSCodeButtonLink>
			)}
			{!simplifySettings && (
				<div>
					<LabeledCheckbox
						checked={openRouterBaseUrlSelected}
						onCheckedChange={(checked: boolean) => {
							setOpenRouterBaseUrlSelected(checked)

							if (!checked) {
								setApiConfigurationField("openRouterBaseUrl", "")
							}
						}}>
						{t("settings:providers.useCustomBaseUrl")}
					</LabeledCheckbox>
					{openRouterBaseUrlSelected && (
						<Input
							value={apiConfiguration?.openRouterBaseUrl || ""}
							type="url"
							onChange={handleInputChange("openRouterBaseUrl")}
							placeholder={t("settings:defaults.openRouterUrl")}
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
			{!simplifySettings && modelProviders && Object.keys(modelProviders).length > 0 && (
				<div>
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("settings:providers.openRouter.providerRouting.title")}
						</label>
						<a href={`https://openrouter.ai/${selectedModelId}/providers`}>
							<ExternalLink className="w-4 h-4" />
						</a>
					</div>
					<Select
						value={apiConfiguration.openRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
						onValueChange={(value) => setApiConfigurationField("openRouterSpecificProvider", value)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
								{OPENROUTER_DEFAULT_PROVIDER_NAME}
							</SelectItem>
							{Object.entries(modelProviders).map(([value, { label }]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className={settingDescription}>
						{t("settings:providers.openRouter.providerRouting.description")}{" "}
						<a href="https://openrouter.ai/docs/features/provider-routing">
							{t("settings:providers.openRouter.providerRouting.learnMore")}.
						</a>
					</div>
				</div>
			)}
		</>
	)
}
