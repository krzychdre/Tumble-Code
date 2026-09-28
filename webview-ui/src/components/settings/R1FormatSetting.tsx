import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"

import { useAppTranslation } from "@/i18n/TranslationContext"

interface R1FormatSettingProps {
	onChange: (value: boolean) => void
	openAiR1FormatEnabled?: boolean
}

export const R1FormatSetting = ({ onChange, openAiR1FormatEnabled }: R1FormatSettingProps) => {
	const { t } = useAppTranslation()

	return (
		<div>
			<div className="flex items-center gap-2">
				<LabeledCheckbox checked={openAiR1FormatEnabled} onCheckedChange={onChange}>
					<span className="font-medium">{t("settings:modelInfo.enableR1Format")}</span>
				</LabeledCheckbox>
			</div>
			<p className="text-vscode-descriptionForeground text-sm mt-0">
				{t("settings:modelInfo.enableR1FormatTips")}
			</p>
		</div>
	)
}
