import React, { useCallback } from "react"
import { LabeledCheckbox } from "@src/components/ui"

import { useAppTranslation } from "@/i18n/TranslationContext"

interface CompactProfileControlProps {
	compactProfile?: boolean
	onChange: (field: "compactProfile", value: boolean) => void
}

/**
 * Per-profile switch for small local models (a 32k to 40k context window): a
 * short system prompt, a minimal tool set with simple editing, shorter
 * environment details and tighter output limits. Like the slim toolset it lives
 * on the profile, so binding the profile to a mode makes the behaviour follow
 * every mode switch; when both are on, the compact rules apply.
 *
 * The value comes from the profile being edited (the settings draft, not the
 * live extension state) and is written back through `onChange`. Unchecking
 * writes an explicit false, which behaves exactly like an absent flag.
 */
export const CompactProfileControl: React.FC<CompactProfileControlProps> = ({ compactProfile, onChange }) => {
	const { t } = useAppTranslation()

	const handleChange = useCallback(
		(e: any) => {
			onChange("compactProfile", e.target.checked)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div>
				<LabeledCheckbox checked={compactProfile === true} onChange={handleChange}>
					<span className="font-medium">{t("settings:advanced.compactProfile.label")}</span>
				</LabeledCheckbox>
				<div className="text-vscode-descriptionForeground text-sm">
					{t("settings:advanced.compactProfile.description")}
				</div>
			</div>
		</div>
	)
}
