import { Trans } from "react-i18next"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Textarea } from "@src/components/ui"
import { useTextDraft } from "@src/components/ui/hooks"

type GlobalCustomInstructionsSectionProps = {
	customInstructions: string | undefined
	setCustomInstructions: (value: string | undefined) => void
}

/** Instructions for every mode: saved when the field is left after an edit, plus the link to the workspace rules file. */
export const GlobalCustomInstructionsSection = ({
	customInstructions,
	setCustomInstructions,
}: GlobalCustomInstructionsSectionProps) => {
	const { t } = useAppTranslation()
	const instructions = useTextDraft(customInstructions || "", (value) => {
		setCustomInstructions(value ?? undefined)
		vscode.postMessage({
			type: "customInstructions",
			text: value ?? undefined,
		})
	})

	return (
		<div className="pb-5">
			<h3 className="text-vscode-foreground mb-block">{t("prompts:globalCustomInstructions.title")}</h3>

			<div className="text-sm text-vscode-descriptionForeground mb-row">
				{t("prompts:globalCustomInstructions.description")}
			</div>
			<Textarea
				{...instructions}
				rows={4}
				className="w-full resize-y"
				data-testid="global-custom-instructions-textarea"
			/>
			<div className="text-xs text-vscode-descriptionForeground mt-1.5">
				<Trans
					i18nKey="prompts:globalCustomInstructions.loadFromFile"
					components={{
						span: (
							<span
								className="text-vscode-textLink-foreground cursor-pointer underline"
								onClick={() =>
									vscode.postMessage({
										type: "openFile",
										text: "./.roo/rules/rules.md",
										values: {
											create: true,
											content: "",
										},
									})
								}
							/>
						),
						"0": <code />,
					}}
				/>
			</div>
		</div>
	)
}
