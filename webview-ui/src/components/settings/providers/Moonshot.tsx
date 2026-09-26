import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedDropdown, ThemedOption } from "@src/components/ui"

import { cn } from "@/lib/utils"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type MoonshotProps = ProviderFormProps & {
	simplifySettings?: boolean
}

export const Moonshot = ({ apiConfiguration, setApiConfigurationField }: MoonshotProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.moonshotBaseUrl")}</label>
				<ThemedDropdown
					value={apiConfiguration.moonshotBaseUrl}
					onChange={handleInputChange("moonshotBaseUrl")}
					className={cn("w-full")}>
					<ThemedOption value="https://api.moonshot.ai/v1" className="p-2">
						api.moonshot.ai
					</ThemedOption>
					<ThemedOption value="https://api.moonshot.cn/v1" className="p-2">
						api.moonshot.cn
					</ThemedOption>
				</ThemedDropdown>
			</div>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="moonshotApiKey"
				labelKey="settings:providers.moonshotApiKey"
				getKeyUrl={
					apiConfiguration.moonshotBaseUrl === "https://api.moonshot.cn/v1"
						? "https://platform.moonshot.cn/console/api-keys"
						: "https://platform.moonshot.ai/console/api-keys"
				}
				getKeyLabelKey="settings:providers.getMoonshotApiKey"
				grouped
			/>
		</>
	)
}
