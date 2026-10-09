import { memo } from "react"
import { cn } from "@/lib/utils"
import type { TaskGroup } from "./types"
import { countAllSubtasks } from "./types"
import TaskItem from "./TaskItem"
import SubtaskCollapsibleRow from "./SubtaskCollapsibleRow"
import SubtaskRow from "./SubtaskRow"

interface TaskGroupItemProps {
	/** The task group to render */
	group: TaskGroup
	/** Display variant - compact (preview) or full (history view) */
	variant: "compact" | "full"
	/** Whether to show workspace info */
	showWorkspace?: boolean
	/** Whether selection mode is active */
	isSelectionMode?: boolean
	/** Whether this group's parent is selected */
	isSelected?: boolean
	/** Callback when selection state changes */
	onToggleSelection?: (taskId: string, isSelected: boolean) => void
	/** Callback when delete is requested */
	onDelete?: (taskId: string) => void
	/** Callback when the parent group expand/collapse is toggled */
	onToggleExpand: () => void
	/** Callback when a nested subtask node expand/collapse is toggled */
	onToggleSubtaskExpand: (taskId: string) => void
	/** Optional className for styling */
	className?: string
}

/**
 * Renders a task group consisting of a parent task and its collapsible subtask tree.
 * When expanded, shows recursively nested subtask rows.
 */
const TaskGroupItem = ({
	group,
	variant,
	showWorkspace = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelection,
	onDelete,
	onToggleExpand,
	onToggleSubtaskExpand,
	className,
}: TaskGroupItemProps) => {
	const { parent, subtasks, isExpanded } = group
	const hasSubtasks = subtasks.length > 0
	const totalSubtaskCount = hasSubtasks ? countAllSubtasks(subtasks) : 0

	return (
		<div
			data-testid={`task-group-${parent.id}`}
			className={cn(
				"overflow-hidden rounded-control border border-frame bg-surface transition-colors",
				"hover:border-frame-hover hover:bg-surface-hover",
				className,
			)}>
			{/* Parent task */}
			<TaskItem
				item={parent}
				variant={variant}
				showWorkspace={showWorkspace}
				isSelectionMode={isSelectionMode}
				isSelected={isSelected}
				onToggleSelection={onToggleSelection}
				onDelete={onDelete}
			/>

			{/* Subtask collapsible row: shows the total recursive count, under a hairline inside the card */}
			{hasSubtasks && (
				<SubtaskCollapsibleRow
					count={totalSubtaskCount}
					isExpanded={isExpanded}
					onToggle={onToggleExpand}
					className="mt-0 border-t border-frame"
				/>
			)}

			{/* Expanded subtask tree. A collapsed tree stays mounted for the
			    height animation, so `inert` keeps Tab off the clipped rows. */}
			{hasSubtasks && (
				<div
					data-testid="subtask-list"
					inert={!isExpanded}
					className={cn(
						"overflow-clip transition-all duration-500",
						isExpanded ? "max-h-[2000px] pb-2" : "max-h-0",
					)}>
					{subtasks.map((node) => (
						<SubtaskRow key={node.item.id} node={node} depth={1} onToggleExpand={onToggleSubtaskExpand} />
					))}
				</div>
			)}
		</div>
	)
}

export default memo(TaskGroupItem)
