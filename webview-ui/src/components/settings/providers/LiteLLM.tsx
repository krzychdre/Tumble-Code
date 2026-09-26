import { useCallback, useState, useEffect } from "react"

import { type OrganizationAllowList, litellmDefaultModelId } from "@roo-code/types"

import { useProviderModels } from "@src/components/ui/hooks/useProviderModels"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, LabeledCheckbox, ThemedTextField } from "@src/components/ui"

import { ModelPicker } from "../ModelPicker"
import { type ProviderFormProps, useProviderField } from "./shared"

type LiteLLMProps = ProviderFormProps & {
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const LiteLLM = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: LiteLLMProps) => {
	const { t } = useAppTranslation()
	const {
		models: litellmModels = {},
		refresh: refreshModels,
		error: providerModelsError,
	} = useProviderModels("litellm", {
		liteLlmApiKey: apiConfiguration.litellmApiKey,
		liteLlmBaseUrl: apiConfiguration.litellmBaseUrl,
	})
	const [refreshStatus, setRefreshStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
	const [refreshError, setRefreshError] = useState<string | undefined>()
	useEffect(() => {
		if (refreshStatus === "loading" && providerModelsError) {
			setRefreshStatus("error")
			setRefreshError(providerModelsError)
		} else if (refreshStatus === "loading" && Object.keys(litellmModels).length > 0) {
			setRefreshStatus("success")
		}
	}, [litellmModels, providerModelsError, refreshStatus])

	const handleInputChange = useProviderField(setApiConfigurationField)

	const handleRefreshModels = useCallback(() => {
		setRefreshStatus("loading")
		setRefreshError(undefined)

		const key = apiConfiguration.litellmApiKey
		const url = apiConfiguration.litellmBaseUrl

		if (!key || !url) {
			setRefreshStatus("error")
			setRefreshError(t("settings:providers.refreshModels.missingConfig"))
			return
		}

		refreshModels()
	}, [apiConfiguration, refreshModels, t])

	return (
		<>
			<ThemedTextField
				value={apiConfiguration?.litellmBaseUrl || ""}
				onInput={handleInputChange("litellmBaseUrl")}
				placeholder={t("settings:placeholders.baseUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmBaseUrl")}</label>
			</ThemedTextField>

			<ThemedTextField
				value={apiConfiguration?.litellmApiKey || ""}
				type="password"
				onInput={handleInputChange("litellmApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmApiKey")}</label>
			</ThemedTextField>

			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<Button
				variant="outline"
				onClick={handleRefreshModels}
				disabled={
					refreshStatus === "loading" || !apiConfiguration.litellmApiKey || !apiConfiguration.litellmBaseUrl
				}
				className="w-full">
				<div className="flex items-center gap-2">
					{refreshStatus === "loading" ? (
						<span className="codicon codicon-loading codicon-modifier-spin" />
					) : (
						<span className="codicon codicon-refresh" />
					)}
					{t("settings:providers.refreshModels.label")}
				</div>
			</Button>
			{refreshStatus === "loading" && (
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.refreshModels.loading")}
				</div>
			)}
			{refreshStatus === "success" && (
				<div className="text-sm text-vscode-foreground">{t("settings:providers.refreshModels.success")}</div>
			)}
			{refreshStatus === "error" && (
				<div className="text-sm text-vscode-errorForeground">
					{refreshError || t("settings:providers.refreshModels.error")}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={litellmDefaultModelId}
				models={litellmModels}
				modelIdKey="litellmModelId"
				serviceName="LiteLLM"
				serviceUrl="https://docs.litellm.ai/"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>

			{/* Show prompt caching option if the selected model supports it */}
			{(() => {
				const selectedModelId = apiConfiguration.litellmModelId || litellmDefaultModelId
				const selectedModel = litellmModels[selectedModelId]
				if (selectedModel?.supportsPromptCache) {
					return (
						<div className="mt-4">
							<LabeledCheckbox
								checked={apiConfiguration.litellmUsePromptCache || false}
								onChange={(e: any) => {
									setApiConfigurationField("litellmUsePromptCache", e.target.checked)
								}}>
								<span className="font-medium">{t("settings:providers.enablePromptCaching")}</span>
							</LabeledCheckbox>
							<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
								{t("settings:providers.enablePromptCachingTitle")}
							</div>
						</div>
					)
				}
				return null
			})()}
		</>
	)
}
