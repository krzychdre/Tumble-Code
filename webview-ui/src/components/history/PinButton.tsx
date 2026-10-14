import { useCallback } from "react"

import { vscode } from "@/utils/vscode"
import { Button, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

/**
 * Pins a task to the top of the task lists, or unpins it. The host stores the
 * flag on the task's history item (`pinnedAt`) and pushes the item back, so
 * the row moves once the update arrives. A pinned row shows the filled pin.
 */
export const PinButton = ({ itemId, pinned }: { itemId: string; pinned: boolean }) => {
	const { t } = useAppTranslation()
	const label = pinned ? t("history:unpinTask") : t("history:pinTask")

	const handlePinClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			vscode.postMessage({ type: "setTaskPinned", text: itemId, bool: !pinned })
		},
		[itemId, pinned],
	)

	return (
		<StandardTooltip content={label}>
			<Button
				aria-label={label}
				aria-pressed={pinned}
				data-testid="pin-task-button"
				variant="ghost"
				size="icon"
				className={cn(
					"h-[22px] w-[22px] hover:text-vscode-foreground",
					pinned ? "text-vscode-foreground" : "text-vscode-descriptionForeground",
				)}
				onClick={handlePinClick}>
				<span className={cn("codicon scale-80", pinned ? "codicon-pinned" : "codicon-pin")} />
			</Button>
		</StandardTooltip>
	)
}
