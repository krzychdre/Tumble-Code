import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import { zaiApiLineConfigs, zaiApiLineSchema } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { cn } from "@/lib/utils"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type ZAiProps = ProviderFormProps

export const ZAi = ({ apiConfiguration, setApiConfigurationField }: ZAiProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.zaiEntrypoint")}</label>
				<VSCodeDropdown
					value={apiConfiguration.zaiApiLine || zaiApiLineSchema.enum.international_coding}
					onChange={handleInputChange("zaiApiLine")}
					className={cn("w-full")}>
					{zaiApiLineSchema.options.map((zaiApiLine) => {
						const config = zaiApiLineConfigs[zaiApiLine]
						return (
							<VSCodeOption key={zaiApiLine} value={zaiApiLine} className="p-2">
								{config.name} ({config.baseUrl})
							</VSCodeOption>
						)
					})}
				</VSCodeDropdown>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:providers.zaiEntrypointDescription")}
				</div>
			</div>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="zaiApiKey"
				labelKey="settings:providers.zaiApiKey"
				getKeyUrl={
					zaiApiLineConfigs[apiConfiguration.zaiApiLine ?? "international_coding"].isChina
						? "https://open.bigmodel.cn/console/overview"
						: "https://z.ai/manage-apikey/apikey-list"
				}
				getKeyLabelKey="settings:providers.getZaiApiKey"
				grouped
			/>
		</>
	)
}
