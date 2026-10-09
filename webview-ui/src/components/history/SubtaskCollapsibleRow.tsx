import { memo } from "react"
import { ChevronRight } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

interface SubtaskCollapsibleRowProps {
	/** Number of subtasks */
	count: number
	/** Whether the subtask list is expanded */
	isExpanded: boolean
	/** Callback when the row is clicked to toggle expand/collapse */
	onToggle: () => void
	/** Optional className for styling */
	className?: string
}

/**
 * A full-width toggle button that displays the subtask count with an expand/collapse chevron.
 * Clicking this row toggles the visibility of the subtask list.
 */
const SubtaskCollapsibleRow = ({ count, isExpanded, onToggle, className }: SubtaskCollapsibleRowProps) => {
	const { t } = useAppTranslation()

	if (count === 0) {
		return null
	}

	return (
		// A real <button>, so Tab reaches it and Enter/Space toggle it natively.
		// It sits next to the task row, never inside it, so no button nests another.
		<button
			type="button"
			data-testid="subtask-collapsible-row"
			className={cn(
				"flex w-full items-center gap-1 px-3 py-2 -mt-2 cursor-pointer text-xs text-left",
				"bg-transparent border-0 font-inherit",
				"text-vscode-descriptionForeground hover:text-vscode-foreground",
				"transition-colors",
				"focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder",
				className,
			)}
			onClick={(e) => {
				// Toggling the list must not also open the task behind it.
				e.stopPropagation()
				onToggle()
			}}
			aria-expanded={isExpanded}
			aria-label={isExpanded ? t("history:collapseSubtasks") : t("history:expandSubtasks")}>
			<ChevronRight aria-hidden className={`size-3 transition-transform ${isExpanded && "rotate-90"}`} />
			{t("history:subtasks", { count })}
		</button>
	)
}

export default memo(SubtaskCollapsibleRow)
