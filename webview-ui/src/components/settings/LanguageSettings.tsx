import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { Language } from "@roo-code/types"

import { LANGUAGES } from "@roo-code/types"

import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement>

export const LanguageSettings = ({ className, ...props }: LanguageSettingsProps) => {
	const { t } = useAppTranslation()
	const [languageSetting, setLanguage] = useSetting("language")
	const language = languageSetting || "en"

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.language")}</SectionHeader>

			<Section>
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
										<span className="text-muted-foreground">({code})</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</SearchableSetting>
			</Section>
		</div>
	)
}
