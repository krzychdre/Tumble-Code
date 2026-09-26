import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedDropdown, ThemedOption } from "@src/components/ui"

import { cn } from "@/lib/utils"
import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

type MiniMaxProps = ProviderFormProps

export const MiniMax = ({ apiConfiguration, setApiConfigurationField }: MiniMaxProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.minimaxBaseUrl")}</label>
				<ThemedDropdown
					value={apiConfiguration.minimaxBaseUrl}
					onChange={handleInputChange("minimaxBaseUrl")}
					className={cn("w-full")}>
					<ThemedOption value="https://api.minimax.io/v1" className="p-2">
						api.minimax.io
					</ThemedOption>
					<ThemedOption value="https://api.minimaxi.com/v1" className="p-2">
						api.minimaxi.com
					</ThemedOption>
				</ThemedDropdown>
			</div>
			<ApiKeyField
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				field="minimaxApiKey"
				labelKey="settings:providers.minimaxApiKey"
				getKeyUrl={
					apiConfiguration.minimaxBaseUrl === "https://api.minimaxi.com/v1"
						? "https://platform.minimaxi.com/user-center/basic-information/interface-key"
						: "https://www.minimax.io/platform/user-center/basic-information/interface-key"
				}
				getKeyLabelKey="settings:providers.getMiniMaxApiKey"
				grouped
			/>
		</>
	)
}
