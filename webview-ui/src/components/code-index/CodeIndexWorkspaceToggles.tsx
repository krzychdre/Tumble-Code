import type { IndexingStatus } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

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
			<div className="flex items-center gap-2 pt-4 pb-1">
				<input
					type="checkbox"
					id="auto-enable-default-toggle"
					checked={indexingStatus.autoEnableDefault ?? true}
					onChange={(e) =>
						vscode.postMessage({
							type: "setAutoEnableDefault",
							bool: e.target.checked,
						})
					}
					className="accent-vscode-focusBorder"
				/>
				<label htmlFor="auto-enable-default-toggle" className="text-xs text-vscode-foreground cursor-pointer">
					{t("settings:codeIndex.autoEnableDefaultLabel")}
				</label>
			</div>

			{/* Workspace Toggle */}
			<div className="flex items-center gap-2 pt-1 pb-2">
				<input
					type="checkbox"
					id="workspace-indexing-toggle"
					checked={indexingStatus.workspaceEnabled ?? false}
					onChange={(e) =>
						vscode.postMessage({
							type: "toggleWorkspaceIndexing",
							bool: e.target.checked,
						})
					}
					className="accent-vscode-focusBorder"
				/>
				<label htmlFor="workspace-indexing-toggle" className="text-xs text-vscode-foreground cursor-pointer">
					{t("settings:codeIndex.workspaceToggleLabel")}
				</label>
			</div>
		</>
	)
}
