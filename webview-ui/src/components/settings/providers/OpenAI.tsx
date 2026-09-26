import { useState } from "react"
import { VSCRUICheckbox as Checkbox } from "@src/components/ui/vscrui-checkbox"

import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
	ThemedTextField,
} from "@src/components/ui"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type OpenAIProps = ProviderFormProps & {
	selectedModelInfo?: ModelInfo
	simplifySettings?: boolean
}

export const OpenAI = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo }: OpenAIProps) => {
	const { t } = useAppTranslation()

	const [openAiNativeBaseUrlSelected, setOpenAiNativeBaseUrlSelected] = useState(
		!!apiConfiguration?.openAiNativeBaseUrl,
	)

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<Checkbox
				checked={openAiNativeBaseUrlSelected}
				onChange={(checked: boolean) => {
					setOpenAiNativeBaseUrlSelected(checked)

					if (!checked) {
						setApiConfigurationField("openAiNativeBaseUrl", "")
					}
				}}>
				{t("settings:providers.useCustomBaseUrl")}
			</Checkbox>
			{openAiNativeBaseUrlSelected && (
				<>
					<ThemedTextField
						value={apiConfiguration?.openAiNativeBaseUrl || ""}
						type="url"
						onInput={handleInputChange("openAiNativeBaseUrl")}
						placeholder="https://api.openai.com/v1"
						className="w-full mt-1"
					/>
				</>
			)}
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="openAiNativeApiKey"
				labelKey="settings:providers.openAiApiKey"
				getKeyUrl="https://platform.openai.com/api-keys"
				getKeyLabelKey="settings:providers.getOpenAiApiKey"
			/>

			{(() => {
				const allowedTiers = (selectedModelInfo?.tiers?.map((t) => t.name).filter(Boolean) || []).filter(
					(t) => t === "flex" || t === "priority",
				)
				if (allowedTiers.length === 0) return null

				return (
					<div className="flex flex-col gap-1 mt-2" data-testid="openai-service-tier">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">Service tier</label>
							<StandardTooltip content="For faster processing of API requests, try the priority processing service tier. For lower prices with higher latency, try the flex processing tier.">
								<i className="codicon codicon-info text-vscode-descriptionForeground text-xs" />
							</StandardTooltip>
						</div>

						<Select
							value={apiConfiguration.openAiNativeServiceTier || "default"}
							onValueChange={(value) =>
								setApiConfigurationField(
									"openAiNativeServiceTier",
									value as ProviderSettings["openAiNativeServiceTier"],
								)
							}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="default">Standard</SelectItem>
								{allowedTiers.includes("flex") && <SelectItem value="flex">Flex</SelectItem>}
								{allowedTiers.includes("priority") && (
									<SelectItem value="priority">Priority</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				)
			})()}
		</>
	)
}
