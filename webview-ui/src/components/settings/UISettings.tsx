import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { LabeledCheckbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard, checkboxDescription, settingDescription } from "./SettingsCard"

type UISettingsProps = HTMLAttributes<HTMLDivElement>

export const UISettings = (props: UISettingsProps) => {
	const { t } = useAppTranslation()
	const [reasoningBlockCollapsedSetting, setReasoningBlockCollapsed] = useSetting("reasoningBlockCollapsed")
	const [enterBehaviorSetting, setEnterBehavior] = useSetting("enterBehavior")
	const [uiDensitySetting, setUiDensity] = useSetting("uiDensity")
	const reasoningBlockCollapsed = reasoningBlockCollapsedSetting ?? true
	const enterBehavior = enterBehaviorSetting ?? "send"
	const uiDensity = uiDensitySetting ?? "comfortable"

	// Detect platform for dynamic modifier key display
	const primaryMod = useMemo(() => {
		const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
		return isMac ? "⌘" : "Ctrl"
	}, [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setReasoningBlockCollapsed(value)
	}

	const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
		const newBehavior = requireCtrlEnter ? "newline" : "send"
		setEnterBehavior(newBehavior)
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.ui")}</SectionHeader>

			<Section>
				<SettingsCard>
					{/* Collapse Thinking Messages Setting */}
					<SearchableSetting
						settingId="ui-collapse-thinking"
						section="ui"
						label={t("settings:ui.collapseThinking.label")}>
						<div className="flex flex-col">
							<LabeledCheckbox
								checked={reasoningBlockCollapsed}
								onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
								data-testid="collapse-thinking-checkbox">
								<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
							</LabeledCheckbox>
							<div className={checkboxDescription}>
								{t("settings:ui.collapseThinking.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Enter Key Behavior Setting */}
					<SearchableSetting
						settingId="ui-enter-behavior"
						section="ui"
						label={t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}>
						<div className="flex flex-col">
							<LabeledCheckbox
								checked={enterBehavior === "newline"}
								onChange={(e: any) => handleEnterBehaviorChange(e.target.checked)}
								data-testid="enter-behavior-checkbox">
								<span className="font-medium">
									{t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}
								</span>
							</LabeledCheckbox>
							<div className={checkboxDescription}>
								{t("settings:ui.requireCtrlEnterToSend.description", { primaryMod })}
							</div>
						</div>
					</SearchableSetting>

					{/* Density setting (§2.1, ai_plans/2026-09-27_ui-modernization.md): chat, settings, MCP and Modes */}
					<SearchableSetting settingId="ui-density" section="ui" label={t("settings:ui.density.label")}>
						<div className="flex flex-col">
							<label className="block font-medium mb-1">{t("settings:ui.density.label")}</label>
							<Select
								value={uiDensity}
								onValueChange={(value) => {
									const newDensity = value as "comfortable" | "compact"
									setUiDensity(newDensity)
								}}>
								<SelectTrigger className="w-full" data-testid="ui-density-select">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="comfortable">{t("settings:ui.density.comfortable")}</SelectItem>
									<SelectItem value="compact">{t("settings:ui.density.compact")}</SelectItem>
								</SelectContent>
							</Select>
							<div className={settingDescription}>
								{t("settings:ui.density.description")}
							</div>
						</div>
					</SearchableSetting>
				</SettingsCard>
			</Section>
		</div>
	)
}
