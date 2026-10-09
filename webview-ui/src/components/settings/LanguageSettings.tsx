import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { Language } from "@tumble-code/types"

import { LANGUAGES } from "@tumble-code/types"

import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard } from "./SettingsCard"

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement>

export const LanguageSettings = ({ className, ...props }: LanguageSettingsProps) => {
	const { t } = useAppTranslation()
	const [languageSetting, setLanguage] = useSetting("language")
	const language = languageSetting || "en"

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>{t("settings:sections.language")}</SectionHeader>

			<Section>
				<SettingsCard>
				<SearchableSetting
					settingId="language-select"
					section="language"
					label={t("settings:sections.language")}>
					<Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{Object.entries(LANGUAGES).map(([code, name]) => (
									<SelectItem key={code} value={code}>
										{name}
										<span className="text-vscode-descriptionForeground">({code})</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</SearchableSetting>
				</SettingsCard>
			</Section>
		</div>
	)
}
