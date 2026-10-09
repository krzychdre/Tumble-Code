import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { WEB_TOOLS_DEFAULTS, SETTINGS_DEFAULTS } from "@tumble-code/types"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Slider, LabeledCheckbox, Input } from "@/components/ui"
import { SettingsCard, checkboxDescription, settingDescription } from "./SettingsCard"

type WebToolsSettingsProps = HTMLAttributes<HTMLDivElement>

export const WebToolsSettings = (props: WebToolsSettingsProps) => {
	const { t } = useAppTranslation()
	const [webToolsEnabled, setWebToolsEnabled] = useSetting("webToolsEnabled")
	const [searxngBaseUrl, setSearxngBaseUrl] = useSetting("searxngBaseUrl")
	const [webSearchMaxResults, setWebSearchMaxResults] = useSetting("webSearchMaxResults")

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.web")}</SectionHeader>

			<Section>
				<SettingsCard>
				<SearchableSetting settingId="web-enable" section="web" label={t("settings:web.enable.label")}>
					<LabeledCheckbox
						checked={webToolsEnabled ?? SETTINGS_DEFAULTS.webToolsEnabled}
						onChange={(e: any) => {
							setWebToolsEnabled(e.target.checked)
						}}
						data-testid="web-tools-enabled-checkbox">
						<span className="font-medium">{t("settings:web.enable.label")}</span>
					</LabeledCheckbox>
					<div className={checkboxDescription}>
						{t("settings:web.enable.description")}
					</div>
				</SearchableSetting>

				{webToolsEnabled && (
					<>
						<SearchableSetting
							settingId="web-searxng-url"
							section="web"
							label={t("settings:web.searxngBaseUrl.label")}
							className="mt-section">
							<label className="block text-sm font-medium mb-2">
								{t("settings:web.searxngBaseUrl.label")}
							</label>
							<Input
								value={searxngBaseUrl ?? SETTINGS_DEFAULTS.searxngBaseUrl}
								placeholder={t("settings:web.searxngBaseUrl.placeholder")}
								onChange={(e) => {
									setSearxngBaseUrl(e.target.value)
								}}
								className="w-full"
								data-testid="web-searxng-url-input"
							/>
							<div className={settingDescription}>
								{t("settings:web.searxngBaseUrl.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="web-max-results"
							section="web"
							label={t("settings:web.maxResults.label")}
							className="mt-section">
							<label className="block text-sm font-medium mb-2">
								{t("settings:web.maxResults.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={WEB_TOOLS_DEFAULTS.MIN_SEARCH_RESULTS}
									max={WEB_TOOLS_DEFAULTS.MAX_SEARCH_RESULTS}
									step={1}
									defaultValue={[webSearchMaxResults ?? WEB_TOOLS_DEFAULTS.DEFAULT_SEARCH_RESULTS]}
									onValueChange={([value]) => {
										setWebSearchMaxResults(value)
									}}
									className="flex-1"
									data-testid="web-max-results-slider"
								/>
								<span className="w-12 text-center">
									{webSearchMaxResults ?? WEB_TOOLS_DEFAULTS.DEFAULT_SEARCH_RESULTS}
								</span>
							</div>
							<div className={settingDescription}>
								{t("settings:web.maxResults.description")}
							</div>
						</SearchableSetting>
					</>
				)}
				</SettingsCard>
			</Section>
		</div>
	)
}
