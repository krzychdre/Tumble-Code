import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { LabeledCheckbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { telemetryClient } from "@/utils/TelemetryClient"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

interface UISettingsProps extends HTMLAttributes<HTMLDivElement> {
	reasoningBlockCollapsed: boolean
	enterBehavior: "send" | "newline"
	uiDensity: "comfortable" | "compact"
	setCachedStateField: SetCachedStateField<"reasoningBlockCollapsed" | "enterBehavior" | "uiDensity">
}

export const UISettings = ({
	reasoningBlockCollapsed,
	enterBehavior,
	uiDensity,
	setCachedStateField,
	...props
}: UISettingsProps) => {
	const { t } = useAppTranslation()

	// Detect platform for dynamic modifier key display
	const primaryMod = useMemo(() => {
		const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
		return isMac ? "⌘" : "Ctrl"
	}, [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setCachedStateField("reasoningBlockCollapsed", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_collapse_thinking_changed", {
			enabled: value,
		})
	}

	const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
		const newBehavior = requireCtrlEnter ? "newline" : "send"
		setCachedStateField("enterBehavior", newBehavior)

		// Track telemetry event
		telemetryClient.capture("ui_settings_enter_behavior_changed", {
			behavior: newBehavior,
		})
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.ui")}</SectionHeader>

			<Section>
				<div className="space-y-6">
					{/* Collapse Thinking Messages Setting */}
					<SearchableSetting
						settingId="ui-collapse-thinking"
						section="ui"
						label={t("settings:ui.collapseThinking.label")}>
						<div className="flex flex-col gap-1">
							<LabeledCheckbox
								checked={reasoningBlockCollapsed}
								onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
								data-testid="collapse-thinking-checkbox">
								<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.collapseThinking.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Enter Key Behavior Setting */}
					<SearchableSetting
						settingId="ui-enter-behavior"
						section="ui"
						label={t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}>
						<div className="flex flex-col gap-1">
							<LabeledCheckbox
								checked={enterBehavior === "newline"}
								onChange={(e: any) => handleEnterBehaviorChange(e.target.checked)}
								data-testid="enter-behavior-checkbox">
								<span className="font-medium">
									{t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}
								</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.requireCtrlEnterToSend.description", { primaryMod })}
							</div>
						</div>
					</SearchableSetting>

					{/* Chat density setting (§2.1, ai_plans/2026-09-27_ui-modernization.md) */}
					<SearchableSetting settingId="ui-density" section="ui" label={t("settings:ui.density.label")}>
						<div className="flex flex-col gap-1">
							<div className="flex justify-between items-center">
								<label className="block font-medium mb-1">{t("settings:ui.density.label")}</label>
							</div>
							<Select
								value={uiDensity}
								onValueChange={(value) => {
									const newDensity = value as "comfortable" | "compact"
									setCachedStateField("uiDensity", newDensity)

									// Track telemetry event
									telemetryClient.capture("ui_settings_density_changed", {
										density: newDensity,
									})
								}}>
								<SelectTrigger className="w-full" data-testid="ui-density-select">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="comfortable">{t("settings:ui.density.comfortable")}</SelectItem>
									<SelectItem value="compact">{t("settings:ui.density.compact")}</SelectItem>
								</SelectContent>
							</Select>
							<div className="text-xs text-muted-foreground mt-1">{t("settings:ui.density.description")}</div>
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
