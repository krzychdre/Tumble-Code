import { Trans } from "react-i18next"

import type { ModeConfig, PromptComponent, CustomModePrompts } from "@tumble-code/types"

import { getCustomInstructions } from "@shared/modes"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Textarea } from "@src/components/ui"
import { useTextDraft } from "@src/components/ui/hooks"

import { PromptFieldHeader } from "./ModePromptFields"

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
	// Saved when the field is left after an edit, not on every keystroke.
	const instructions = useTextDraft(
		customMode?.customInstructions ?? prompt?.customInstructions ?? getCustomInstructions(visualMode, customModes),
		(value) => {
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
		},
	)

	return (
		<div className="mb-row">
			<PromptFieldHeader
				title={t("prompts:customInstructions.title")}
				resetTooltip={t("prompts:customInstructions.resetToDefault")}
				resetTestId="custom-instructions-reset"
				isCustomMode={Boolean(customMode)}
				onReset={onReset}
			/>
			<div className="text-base text-vscode-descriptionForeground mb-row">
				{t("prompts:customInstructions.description", {
					modeName: currentMode?.name || "Code",
				})}
			</div>
			<Textarea
				{...instructions}
				rows={10}
				className="w-full resize-y"
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
						"0": <code />,
					}}
				/>
			</div>
		</div>
	)
}
