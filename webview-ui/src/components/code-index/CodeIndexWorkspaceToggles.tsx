import type { IndexingStatus } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { LabeledCheckbox } from "@src/components/ui"

type CodeIndexWorkspaceTogglesProps = {
	indexingStatus: IndexingStatus
}

/**
 * The per-workspace switches, shown while code indexing is enabled: auto-enable for new workspaces
 * and indexing of this workspace. Both are posted to the host at once, outside the Save button.
 * They sit inside the collapsed Advanced Configuration group; the popover shows the
 * "workspace disabled" note itself, so it stays visible while the group is closed.
 */
export const CodeIndexWorkspaceToggles = ({ indexingStatus }: CodeIndexWorkspaceTogglesProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			{/* Auto-enable default */}
			<div className="pt-4 pb-1">
				<LabeledCheckbox
					id="auto-enable-default-toggle"
					checked={indexingStatus.autoEnableDefault ?? true}
					onChange={(e) =>
						vscode.postMessage({
							type: "setAutoEnableDefault",
							bool: e.target.checked,
						})
					}
					className="text-xs text-vscode-foreground">
					{t("settings:codeIndex.autoEnableDefaultLabel")}
				</LabeledCheckbox>
			</div>

			{/* Workspace Toggle */}
			<div className="pt-1 pb-2">
				<LabeledCheckbox
					id="workspace-indexing-toggle"
					checked={indexingStatus.workspaceEnabled ?? false}
					onChange={(e) =>
						vscode.postMessage({
							type: "toggleWorkspaceIndexing",
							bool: e.target.checked,
						})
					}
					className="text-xs text-vscode-foreground">
					{t("settings:codeIndex.workspaceToggleLabel")}
				</LabeledCheckbox>
			</div>
		</>
	)
}
