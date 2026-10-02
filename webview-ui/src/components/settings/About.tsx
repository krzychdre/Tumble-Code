import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Download, Upload, TriangleAlert } from "lucide-react"

import { Package } from "@roo/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button, LabeledCheckbox } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { useSetting } from "./SettingsDraftContext"

type AboutProps = HTMLAttributes<HTMLDivElement>

export const About = ({ className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()
	const [debug, setDebug] = useSetting("debug")

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.about")}</SectionHeader>

			<Section>
				<p>
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
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:about.debugMode.description")}
					</p>
				</SearchableSetting>
			</Section>

			<Section className="space-y-0">
				<SearchableSetting
					settingId="about-manage-settings"
					section="about"
					label={t("settings:about.manageSettings")}>
					<h3>{t("settings:about.manageSettings")}</h3>
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
			</Section>
		</div>
	)
}
