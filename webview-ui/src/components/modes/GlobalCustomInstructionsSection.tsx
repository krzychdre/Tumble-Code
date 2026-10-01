import { Trans } from "react-i18next"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Link, ThemedTextArea } from "@src/components/ui"

import { readTextEventValue } from "./modePromptUpdates"

type GlobalCustomInstructionsSectionProps = {
	customInstructions: string | undefined
	setCustomInstructions: (value: string | undefined) => void
}

/** Instructions for every mode: saved on each edit, plus the link to the workspace rules file. */
export const GlobalCustomInstructionsSection = ({
	customInstructions,
	setCustomInstructions,
}: GlobalCustomInstructionsSectionProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="pb-5">
			<h3 className="text-vscode-foreground mb-block">{t("prompts:globalCustomInstructions.title")}</h3>

			<div className="text-sm text-vscode-descriptionForeground mb-row">
				{t("prompts:globalCustomInstructions.description")}
			</div>
			<ThemedTextArea
				resize="vertical"
				value={customInstructions || ""}
				onChange={(e) => {
					const value = readTextEventValue(e)
					setCustomInstructions(value ?? undefined)
					vscode.postMessage({
						type: "customInstructions",
						text: value ?? undefined,
					})
				}}
				rows={4}
				className="w-full"
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
						"0": (
							<Link
								href={buildDocLink(
									"features/custom-instructions#setting-up-global-rules",
									"prompts_global_rules",
								)}
								style={{ display: "inline" }}
								aria-label={t("prompts:globalCustomInstructions.docsLinkAriaLabel")}
							/>
						),
					}}
				/>
			</div>
		</div>
	)
}
