import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Download, Upload, TriangleAlert } from "lucide-react"

import { Package } from "@shared/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button, LabeledCheckbox } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { useSetting } from "./SettingsDraftContext"
import { SettingsCard, checkboxDescription } from "./SettingsCard"

type AboutProps = HTMLAttributes<HTMLDivElement>

export const About = ({ className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()
	const [debug, setDebug] = useSetting("debug")

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>{t("settings:sections.about")}</SectionHeader>

			<Section>
				<SettingsCard>
				<p className="m-0">
					{Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`}
				</p>
				<SearchableSetting
					settingId="about-debug-mode"
					section="about"
					label={t("settings:about.debugMode.label")}>
					<LabeledCheckbox
						checked={debug ?? false}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setDebug(checked)
						}}>
						{t("settings:about.debugMode.label")}
					</LabeledCheckbox>
					<p className={cn(checkboxDescription, "mb-0")}>
						{t("settings:about.debugMode.description")}
					</p>
				</SearchableSetting>
				</SettingsCard>
			</Section>

			<Section className="pt-0">
				<SettingsCard>
				<SearchableSetting
					settingId="about-manage-settings"
					section="about"
					label={t("settings:about.manageSettings")}>
					<h3 className="m-0 mb-2 text-base font-medium">{t("settings:about.manageSettings")}</h3>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="w-28">
							<Upload className="p-0.5" />
							{t("settings:footer.settings.export")}
						</Button>
						<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="w-28">
							<Download className="p-0.5" />
							{t("settings:footer.settings.import")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => vscode.postMessage({ type: "resetState" })}
							className="w-28">
							<TriangleAlert className="p-0.5" />
							{t("settings:footer.settings.reset")}
						</Button>
					</div>
				</SearchableSetting>
				</SettingsCard>
			</Section>
		</div>
	)
}
