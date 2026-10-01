import type { ModeConfig, PromptComponent, CustomModePrompts } from "@roo-code/types"

import { getRoleDefinition, getWhenToUse, getDescription } from "@roo/modes"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip, ThemedTextArea, ThemedTextField } from "@src/components/ui"

import { readTextEventValue, type ResettablePromptField } from "./modePromptUpdates"

type PromptFieldHeaderProps = {
	title: string
	/** Tooltip of the reset button; the button shows only for built-in modes. */
	resetTooltip: string
	resetTestId: string
	isCustomMode: boolean
	onReset: () => void
}

/** Title of a mode prompt field, with a "reset to default" button for built-in modes. */
export const PromptFieldHeader = ({
	title,
	resetTooltip,
	resetTestId,
	isCustomMode,
	onReset,
}: PromptFieldHeaderProps) => (
	<div className="flex justify-between items-center mb-1">
		<div className="font-bold">{title}</div>
		{!isCustomMode && (
			<StandardTooltip content={resetTooltip}>
				<Button
					aria-label={resetTooltip}
					variant="ghost"
					size="icon"
					onClick={onReset}
					data-testid={resetTestId}>
					<span className="codicon codicon-discard"></span>
				</Button>
			</StandardTooltip>
		)}
	</div>
)

type ModePromptFieldsProps = {
	visualMode: string
	/** The mode's config if it is a custom mode (edits go to the mode file), else a built-in mode. */
	customMode: ModeConfig | undefined
	/** Slug used in the test ids; `undefined` when the mode does not exist. */
	currentModeSlug: string | undefined
	customModePrompts: CustomModePrompts | undefined
	onUpdateCustomMode: (modeConfig: ModeConfig) => void
	onUpdateAgentPrompt: (promptData: PromptComponent) => void
	onReset: (field: ResettablePromptField) => void
}

/**
 * Role definition, description and "when to use" of the selected mode. A custom mode saves its whole
 * config; a built-in mode saves an override with only the edited field.
 */
export const ModePromptFields = ({
	visualMode,
	customMode,
	currentModeSlug,
	customModePrompts,
	onUpdateCustomMode,
	onUpdateAgentPrompt,
	onReset,
}: ModePromptFieldsProps) => {
	const { t } = useAppTranslation()
	const prompt = customModePrompts?.[visualMode] as PromptComponent
	const testIdPrefix = currentModeSlug || "code"

	return (
		<>
			{/* Role Definition section */}
			<div className="mb-section">
				<PromptFieldHeader
					title={t("prompts:roleDefinition.title")}
					resetTooltip={t("prompts:roleDefinition.resetToDefault")}
					resetTestId="role-definition-reset"
					isCustomMode={Boolean(customMode)}
					onReset={() => onReset("roleDefinition")}
				/>
				<div className="text-sm text-vscode-descriptionForeground mb-row">
					{t("prompts:roleDefinition.description")}
				</div>
				<ThemedTextArea
					resize="vertical"
					value={customMode?.roleDefinition ?? prompt?.roleDefinition ?? getRoleDefinition(visualMode)}
					onChange={(e) => {
						const value = readTextEventValue(e)
						if (customMode) {
							// For custom modes, update the JSON file
							onUpdateCustomMode({
								...customMode,
								roleDefinition: value.trim() || "",
								source: customMode.source || "global",
							})
						} else {
							// For built-in modes, update the prompts
							onUpdateAgentPrompt({
								roleDefinition: value.trim() || undefined,
							})
						}
					}}
					className="w-full"
					rows={5}
					data-testid={`${testIdPrefix}-prompt-textarea`}
				/>
			</div>

			{/* Description section */}
			<div className="mb-section">
				<PromptFieldHeader
					title={t("prompts:description.title")}
					resetTooltip={t("prompts:description.resetToDefault")}
					resetTestId="description-reset"
					isCustomMode={Boolean(customMode)}
					onReset={() => onReset("description")}
				/>
				<div className="text-sm text-vscode-descriptionForeground mb-row">
					{t("prompts:description.description")}
				</div>
				<ThemedTextField
					value={customMode?.description ?? prompt?.description ?? getDescription(visualMode)}
					onChange={(e) => {
						const value = readTextEventValue(e)
						if (customMode) {
							// For custom modes, update the JSON file
							onUpdateCustomMode({
								...customMode,
								description: value.trim() || undefined,
								source: customMode.source || "global",
							})
						} else {
							// For built-in modes, update the prompts
							onUpdateAgentPrompt({
								description: value.trim() || undefined,
							})
						}
					}}
					className="w-full"
					data-testid={`${testIdPrefix}-description-textfield`}
				/>
			</div>

			{/* When to Use section */}
			<div className="mb-section">
				<PromptFieldHeader
					title={t("prompts:whenToUse.title")}
					resetTooltip={t("prompts:whenToUse.resetToDefault")}
					resetTestId="when-to-use-reset"
					isCustomMode={Boolean(customMode)}
					onReset={() => onReset("whenToUse")}
				/>
				<div className="text-sm text-vscode-descriptionForeground mb-row">
					{t("prompts:whenToUse.description")}
				</div>
				<ThemedTextArea
					resize="vertical"
					value={customMode?.whenToUse ?? prompt?.whenToUse ?? getWhenToUse(visualMode)}
					onChange={(e) => {
						const value = readTextEventValue(e)
						if (customMode) {
							// For custom modes, update the JSON file
							onUpdateCustomMode({
								...customMode,
								whenToUse: value.trim() || undefined,
								source: customMode.source || "global",
							})
						} else {
							// For built-in modes, update the prompts
							onUpdateAgentPrompt({
								whenToUse: value.trim() || undefined,
							})
						}
					}}
					className="w-full"
					rows={4}
					data-testid={`${testIdPrefix}-when-to-use-textarea`}
				/>
			</div>
		</>
	)
}
