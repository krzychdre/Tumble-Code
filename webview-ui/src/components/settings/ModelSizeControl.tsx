import React, { useCallback } from "react"
import { LabeledCheckbox, ThemedRadio, ThemedRadioGroup } from "@src/components/ui"

import { useAppTranslation } from "@/i18n/TranslationContext"

/** The three prompt and tool profiles a provider profile can send. */
export type ModelSizeOption = "standard" | "slim" | "compact"

type ModelSizeField = "slimToolset" | "slimHidesMcp" | "compactProfile"

interface ModelSizeControlProps {
	slimToolset?: boolean
	slimHidesMcp?: boolean
	compactProfile?: boolean
	onChange: (field: ModelSizeField, value: boolean) => void
}

/**
 * The option the stored flags select. Compact wins over slim, exactly as in the
 * tool filter (`filterNativeToolsForMode`), so a profile that carries both flags
 * shows the behaviour it really gets.
 */
export function modelSizeOf(flags: { slimToolset?: boolean; compactProfile?: boolean }): ModelSizeOption {
	if (flags.compactProfile === true) {
		return "compact"
	}
	if (flags.slimToolset === true) {
		return "slim"
	}
	return "standard"
}

/**
 * One choice between the full prompt and tools (large models), the slim toolset
 * (smaller models: the full prompt with one obvious tool per job) and the
 * compact mode (very small models with a 32k to 40k window: a short prompt, a
 * minimal tool set with simple editing, shorter environment details).
 *
 * The profile still stores the two flags it always had, `slimToolset` and
 * `compactProfile`, so existing profiles need no migration. A selection writes
 * only the flags whose effective value changes, which keeps a profile that never
 * touched the control free of explicit `false` values.
 *
 * The MCP sub-checkbox belongs to the slim toolset and only appears while it is
 * selected. It is checked by default there because MCP schemas are the single
 * largest part of the tool prompt; compact always hides MCP.
 *
 * Compact also turns subagents off for the profile, so selecting it shows a
 * disabled, unchecked "Subagents" switch. The global subagent settings
 * (`parallelTasksMaxConcurrency` and friends) are deliberately not written:
 * they apply to every profile, and large models must keep them.
 */
export const ModelSizeControl: React.FC<ModelSizeControlProps> = ({
	slimToolset,
	slimHidesMcp,
	compactProfile,
	onChange,
}) => {
	const { t } = useAppTranslation()
	const selected = modelSizeOf({ slimToolset, compactProfile })

	const handleSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const next = e.target.value as ModelSizeOption
			if ((slimToolset === true) !== (next === "slim")) {
				onChange("slimToolset", next === "slim")
			}
			if ((compactProfile === true) !== (next === "compact")) {
				onChange("compactProfile", next === "compact")
			}
		},
		[slimToolset, compactProfile, onChange],
	)

	const handleSlimHidesMcpChange = useCallback(
		(e: any) => {
			onChange("slimHidesMcp", e.target.checked)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div className="font-medium">{t("settings:advanced.modelSize.title")}</div>
			<div className="text-vscode-descriptionForeground text-sm">
				{t("settings:advanced.modelSize.description")}
			</div>
			<ThemedRadioGroup
				value={selected}
				onChange={handleSelect}
				orientation="vertical"
				aria-label={t("settings:advanced.modelSize.title")}>
				{(["standard", "slim", "compact"] as const).map((option) => (
					<ThemedRadio key={option} value={option}>
						<span className="font-medium">{t(`settings:advanced.modelSize.${option}.label`)}</span>
						<div className="text-vscode-descriptionForeground text-sm">
							{t(`settings:advanced.modelSize.${option}.description`)}
						</div>
					</ThemedRadio>
				))}
			</ThemedRadioGroup>
			{selected === "slim" && (
				<div className="ml-6">
					{/* Undefined means "hide MCP" while the slim toolset is on, so the
					    checkbox reads an unset value as checked. */}
					<LabeledCheckbox checked={slimHidesMcp !== false} onChange={handleSlimHidesMcpChange}>
						<span className="font-medium">{t("settings:advanced.modelSize.slim.hideMcp.label")}</span>
					</LabeledCheckbox>
					<div className="text-vscode-descriptionForeground text-sm">
						{t("settings:advanced.modelSize.slim.hideMcp.description")}
					</div>
				</div>
			)}
			{selected === "compact" && (
				<div className="ml-6">
					{/* Subagents are off for a compact profile at runtime (NewTaskTool and
					    RunParallelTasksTool refuse), so the switch is shown off and
					    disabled. The global subagent settings are not touched: they
					    still apply to every other profile. */}
					<LabeledCheckbox checked={false} disabled data-testid="model-size-compact-subagents">
						<span className="font-medium">{t("settings:advanced.modelSize.compact.subagents.label")}</span>
					</LabeledCheckbox>
					<div className="text-vscode-descriptionForeground text-sm">
						{t("settings:advanced.modelSize.compact.subagents.description")}
					</div>
				</div>
			)}
		</div>
	)
}
