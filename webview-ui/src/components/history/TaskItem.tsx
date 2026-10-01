import { memo } from "react"
import { ArrowRight, Folder } from "lucide-react"
import type { DisplayHistoryItem } from "./types"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { LabeledCheckbox } from "@/components/ui/labeled-checkbox"

import TaskItemFooter from "./TaskItemFooter"
import { StandardTooltip } from "../ui"

interface TaskItemProps {
	item: DisplayHistoryItem
	variant: "compact" | "full"
	showWorkspace?: boolean
	isSelectionMode?: boolean
	isSelected?: boolean
	onToggleSelection?: (taskId: string, isSelected: boolean) => void
	onDelete?: (taskId: string) => void
	className?: string
}

/**
 * One history row. §2.9: the row is a real <button> — keyboard-focusable,
 * Enter/Space activate it natively — instead of a div with onClick.
 */
const TaskItem = ({
	item,
	variant,
	showWorkspace = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelection,
	onDelete,
	className,
}: TaskItemProps) => {
	const isCompact = variant === "compact"

	const handleClick = () => {
		if (isSelectionMode && onToggleSelection) {
			onToggleSelection(item.id, !isSelected)
		} else {
			vscode.postMessage({ type: "showTaskWithId", text: item.id })
		}
	}

	return (
		<button
			type="button"
			key={item.id}
			data-testid={`task-item-${item.id}`}
			aria-label={item.task}
			aria-pressed={isSelectionMode ? isSelected : undefined}
			className={cn(
				"cursor-pointer group relative overflow-hidden text-left w-full",
				"bg-transparent border-none p-0 font-inherit",
				"text-vscode-foreground/80 hover:text-vscode-foreground transition-colors",
				"focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-focusBorder",
				className,
			)}
			onClick={handleClick}>
			<div className={(!isCompact && isSelectionMode ? "pl-3 pb-3" : "pl-4") + " flex gap-3 px-3 pt-3 pb-1"}>
				{/* Selection checkbox - only in full variant */}
				{!isCompact && isSelectionMode && (
					<div
						className="task-checkbox mt-1"
						onClick={(e) => {
							e.stopPropagation()
						}}>
						<LabeledCheckbox
							checked={isSelected}
							onCheckedChange={(checked: boolean) => onToggleSelection?.(item.id, checked === true)}
						/>
					</div>
				)}

				<div className="flex-1 min-w-0">
					<div className="flex items-start gap-1">
						{item.highlight ? (
							<div
								className={cn(
									"flex-1 min-w-0 overflow-hidden whitespace-pre-wrap font-light text-ellipsis line-clamp-3",
									{
										"text-base": !isCompact,
									},
									!isCompact && isSelectionMode ? "mb-1" : "",
								)}
								data-testid="task-content"
								dangerouslySetInnerHTML={{ __html: item.highlight }}
							/>
						) : (
							<div
								className={cn(
									"flex-1 min-w-0 overflow-hidden whitespace-pre-wrap font-light text-ellipsis line-clamp-3",
									{
										"text-base": !isCompact,
									},
									!isCompact && isSelectionMode ? "mb-1" : "",
								)}
								data-testid="task-content">
								<StandardTooltip content={item.task}>
									<span>{item.task}</span>
								</StandardTooltip>
							</div>
						)}
						{/* Arrow icon that appears on hover */}
						<ArrowRight className="size-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
					</div>

					{showWorkspace && item.workspace && (
						<div className="flex items-center font-mono gap-1 text-vscode-descriptionForeground text-xs mt-1">
							<Folder className="size-3" />
							<span>{item.workspace}</span>
						</div>
					)}

					<TaskItemFooter
						item={item}
						variant={variant}
						isSelectionMode={isSelectionMode}
						isSubtask={item.isSubtask}
						onDelete={onDelete}
					/>
				</div>
			</div>
		</button>
	)
}

export default memo(TaskItem)
