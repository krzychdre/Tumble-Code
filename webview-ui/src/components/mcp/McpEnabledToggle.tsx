import { FormEvent } from "react"
import { LabeledCheckbox } from "@src/components/ui"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { postImmediateSetting } from "../settings/postImmediateSetting"

const McpEnabledToggle = () => {
	const { mcpEnabled, setMcpEnabled } = useExtensionState()
	const { t } = useAppTranslation()

	const handleChange = (e: Event | FormEvent<HTMLElement>) => {
		const target = ("target" in e ? e.target : null) as HTMLInputElement | null

		if (!target) {
			return
		}

		setMcpEnabled(target.checked)
		postImmediateSetting("mcpEnabled", target.checked)
	}

	return (
		<div className="mb-block">
			<LabeledCheckbox checked={mcpEnabled} onChange={handleChange}>
				<span className="font-medium">{t("mcp:enableToggle.title")}</span>
			</LabeledCheckbox>
			<p className="mt-1 text-sm text-vscode-descriptionForeground">{t("mcp:enableToggle.description")}</p>
		</div>
	)
}

export default McpEnabledToggle
