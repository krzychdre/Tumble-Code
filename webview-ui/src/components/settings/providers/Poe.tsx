import { useCallback, useState, useEffect } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	poeDefaultModelId,
	type ProviderName,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { useProviderModels } from "@src/components/ui/hooks/useProviderModels"
import { Button } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { handleModelChangeSideEffects } from "../utils/providerModelConfig"

type PoeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const Poe = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: PoeProps) => {
	const { t } = useAppTranslation()
	const {
		models: poeModels = {},
		refresh: refreshModels,
		error: providerModelsError,
	} = useProviderModels("poe", {
		apiKey: apiConfiguration.poeApiKey,
		baseUrl: apiConfiguration.poeBaseUrl,
	})
	const [refreshStatus, setRefreshStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
	const [refreshError, setRefreshError] = useState<string | undefined>()
	useEffect(() => {
		if (refreshStatus === "loading" && providerModelsError) {
			setRefreshStatus("error")
			setRefreshError(providerModelsError)
		} else if (refreshStatus === "loading" && Object.keys(poeModels).length > 0) {
			setRefreshStatus("success")
		}
	}, [poeModels, providerModelsError, refreshStatus])

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

	const handleRefreshModels = useCallback(() => {
		setRefreshStatus("loading")
		setRefreshError(undefined)

		const key = apiConfiguration.poeApiKey

		if (!key) {
			setRefreshStatus("error")
			setRefreshError(t("settings:providers.refreshModels.missingConfig"))
			return
		}

		refreshModels()
	}, [apiConfiguration.poeApiKey, refreshModels, t])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.poeApiKey || ""}
				type="password"
				onInput={handleInputChange("poeApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.poeApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.poeApiKey && (
				<VSCodeButtonLink href="https://poe.com/api_key" appearance="secondary">
					{t("settings:providers.getPoeApiKey")}
				</VSCodeButtonLink>
			)}
			<Button
				variant="outline"
				onClick={handleRefreshModels}
				disabled={refreshStatus === "loading" || !apiConfiguration.poeApiKey}>
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
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={poeDefaultModelId}
				models={poeModels}
				modelIdKey="apiModelId"
				serviceName="Poe"
				serviceUrl="https://poe.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
				onModelChange={(modelId) =>
					handleModelChangeSideEffects("poe" as ProviderName, modelId, setApiConfigurationField)
				}
			/>
		</>
	)
}
