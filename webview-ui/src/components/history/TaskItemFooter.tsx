import React from "react"
import { CopyButton } from "./CopyButton"
import { ExportButton } from "./ExportButton"
import TaskDetails from "./TaskDetails"
import type { DisplayHistoryItem } from "./types"
import { DeleteButton } from "./DeleteButton"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Split } from "lucide-react"

export interface TaskItemFooterProps {
	item: DisplayHistoryItem
	variant: "compact" | "full"
	isSelectionMode?: boolean
	isSubtask?: boolean
	onDelete?: (taskId: string) => void
	/** Lets the row button point `aria-describedby` at the summary. */
	detailsId?: string
}

const TaskItemFooter: React.FC<TaskItemFooterProps> = ({
	item,
	variant,
	isSelectionMode = false,
	isSubtask = false,
	onDelete,
	detailsId,
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="text-xs text-vscode-descriptionForeground flex justify-between items-center mt-1">
			<div className="flex min-w-0 flex-1 gap-1 items-center">
				{/* Subtask tag */}
				{isSubtask && (
					<>
						<Split className="size-3" />
						<span>{t("history:subtaskTag")}</span>
						<span>·</span>
					</>
				)}
				{/* The same summary a subtask row shows: mode, time, outcome, cost, tokens. */}
				<TaskDetails item={item} id={detailsId} />
			</div>

			{/* Row actions: always visible (keyboard and touch users see them too), in the description colour */}
			{!isSelectionMode && (
				<div className="flex flex-row gap-0.5 -mr-1 items-center text-vscode-descriptionForeground">
					<CopyButton itemTask={item.task} />
					{variant === "full" && <ExportButton itemId={item.id} />}
					{onDelete && <DeleteButton itemId={item.id} onDelete={onDelete} />}
				</div>
			)}
		</div>
	)
}

export default TaskItemFooter
