import { vscode } from "@/utils/vscode"
import { Button, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useCallback } from "react"

export const ExportButton = ({ itemId }: { itemId: string }) => {
	const { t } = useAppTranslation()

	const handleExportClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			vscode.postMessage({ type: "exportTaskWithId", text: itemId })
		},
		[itemId],
	)

	return (
		<StandardTooltip content={t("history:exportTask")}>
			<Button
				aria-label={t("history:exportTask")}
				data-testid="export"
				variant="ghost"
				size="icon"
				className="h-[22px] w-[22px] text-vscode-descriptionForeground hover:text-vscode-foreground"
				onClick={handleExportClick}>
				<span className="codicon codicon-desktop-download scale-80" />
			</Button>
		</StandardTooltip>
	)
}
