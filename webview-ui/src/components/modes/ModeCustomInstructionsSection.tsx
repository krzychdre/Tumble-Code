import { Trans } from "react-i18next"

import type { ModeConfig, PromptComponent, CustomModePrompts } from "@roo-code/types"

import { getCustomInstructions } from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Link, ThemedTextArea } from "@src/components/ui"

import { PromptFieldHeader } from "./ModePromptFields"
import { readTextEventValue } from "./modePromptUpdates"

type ModeCustomInstructionsSectionProps = {
	visualMode: string
	/** The selected mode (built-in or custom), if it exists. */
	currentMode: ModeConfig | undefined
	/** Its config if it is a custom mode. */
	customMode: ModeConfig | undefined
	customModes: ModeConfig[] | undefined
	customModePrompts: CustomModePrompts | undefined
	onUpdateCustomMode: (modeConfig: ModeConfig) => void
	onUpdateAgentPrompt: (promptData: PromptComponent) => void
	onReset: () => void
}

/**
 * The selected mode's own custom instructions, and the link that opens (or creates) its rules file.
 * A custom mode keeps the text as typed (an empty string stays empty); a built-in mode trims it.
 */
export const ModeCustomInstructionsSection = ({
	visualMode,
	currentMode,
	customMode,
	customModes,
	customModePrompts,
	onUpdateCustomMode,
	onUpdateAgentPrompt,
	onReset,
}: ModeCustomInstructionsSectionProps) => {
	const { t } = useAppTranslation()
	const prompt = customModePrompts?.[visualMode] as PromptComponent

	return (
		<div className="mb-2">
			<PromptFieldHeader
				title={t("prompts:customInstructions.title")}
				resetTooltip={t("prompts:customInstructions.resetToDefault")}
				resetTestId="custom-instructions-reset"
				isCustomMode={Boolean(customMode)}
				onReset={onReset}
			/>
			<div className="text-base text-vscode-descriptionForeground mb-2">
				{t("prompts:customInstructions.description", {
					modeName: currentMode?.name || "Code",
				})}
			</div>
			<ThemedTextArea
				resize="vertical"
				value={
					customMode?.customInstructions ??
					prompt?.customInstructions ??
					getCustomInstructions(visualMode, customModes)
				}
				onChange={(e) => {
					const value = readTextEventValue(e)
					if (customMode) {
						// For custom modes, update the JSON file
						onUpdateCustomMode({
							...customMode,
							// Preserve empty string; only treat null/undefined as unset
							customInstructions: value ?? undefined,
							source: customMode.source || "global",
						})
					} else {
						// For built-in modes, update the prompts
						onUpdateAgentPrompt({
							...prompt,
							customInstructions: value.trim() || undefined,
						})
					}
				}}
				rows={10}
				className="w-full"
				data-testid={`${currentMode?.slug || "code"}-custom-instructions-textarea`}
			/>
			<div className="text-xs text-vscode-descriptionForeground mt-1.5">
				<Trans
					i18nKey="prompts:customInstructions.loadFromFile"
					values={{
						mode: currentMode?.name || "Code",
						slug: currentMode?.slug || "code",
					}}
					components={{
						span: (
							<span
								className="text-vscode-textLink-foreground cursor-pointer underline"
								onClick={() => {
									if (!currentMode) return

									// Open or create an empty file
									vscode.postMessage({
										type: "openFile",
										text: `./.roo/rules-${currentMode.slug}/rules.md`,
										values: {
											create: true,
											content: "",
										},
									})
								}}
							/>
						),
						"0": (
							<Link
								href={buildDocLink(
									"features/custom-instructions#global-rules-directory",
									"prompts_mode_specific_global_rules",
								)}
								style={{ display: "inline" }}
								aria-label={t("prompts:customInstructions.docsLinkAriaLabel")}
							/>
						),
					}}
				/>
			</div>
		</div>
	)
}
