import { memo, useId } from "react"
import { ArrowRight } from "lucide-react"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import type { SubtaskTreeNode } from "./types"
import { countAllSubtasks } from "./types"
import { StandardTooltip } from "../ui"
import SubtaskCollapsibleRow from "./SubtaskCollapsibleRow"
import RunningStatusIndicator from "./RunningStatusIndicator"
import TaskDetails from "./TaskDetails"

interface SubtaskRowProps {
	/** The subtask tree node to display */
	node: SubtaskTreeNode
	/** Nesting depth (1 = direct child of parent group) */
	depth: number
	/** Callback when expand/collapse is toggled for a node */
	onToggleExpand: (taskId: string) => void
	/** Optional className for styling */
	className?: string
}

/**
 * Displays a subtask row with recursive nesting support.
 * Leaf nodes render just the task row. Nodes with children show
 * a collapsible section that can be expanded to reveal nested subtasks.
 */
const SubtaskRow = ({ node, depth, onToggleExpand, className }: SubtaskRowProps) => {
	const { item, children, isExpanded } = node
	const hasChildren = children.length > 0
	const statusId = useId()
	const detailsId = useId()

	const handleClick = () => {
		vscode.postMessage({ type: "showTaskWithId", text: item.id })
	}

	return (
		<div data-testid={`subtask-row-${item.id}`} className={className}>
			{/* Task row with depth indentation. §2.9: a real <button>, so Enter
			    and focus come from the platform instead of a keydown handler. */}
			<button
				type="button"
				aria-label={item.task}
				aria-describedby={item.runningStatus ? `${statusId} ${detailsId}` : detailsId}
				className={cn(
					"text-left bg-transparent border-none p-0 font-inherit",
					"group flex w-full items-start justify-between gap-2 pr-3 py-1 cursor-pointer",
					"text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors",
					"focus:outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder",
				)}
				style={{ paddingLeft: `${depth * 16}px` }}
				onClick={handleClick}>
				<span className="flex min-w-0 items-start gap-1.5">
					{/* List marker column: a dash at rest, the live status in the
					    same slot while the subtask works, so the text never shifts.
					    h-5 matches the title's line height. */}
					<span className="flex h-5 shrink-0 items-center">
						{item.runningStatus ? (
							<RunningStatusIndicator status={item.runningStatus} id={statusId} />
						) : (
							<span aria-hidden className="size-4 flex items-center justify-center">
								<span
									data-testid="subtask-bullet"
									className="h-0.5 w-2 bg-current opacity-50 group-hover:opacity-100 group-hover:bg-vscode-focusBorder transition-colors"
								/>
							</span>
						)}
					</span>
					<span className="flex min-w-0 flex-col gap-0.5">
						<StandardTooltip content={item.task} delay={600}>
							<span className="text-sm line-clamp-1">{item.task}</span>
						</StandardTooltip>
						<TaskDetails item={item} id={detailsId} />
					</span>
				</span>
				<ArrowRight className="size-3 mt-1 shrink-0" />
			</button>

			{/* Nested subtask collapsible section */}
			{hasChildren && (
				<div style={{ paddingLeft: `${depth * 16}px` }}>
					<SubtaskCollapsibleRow
						count={countAllSubtasks(children)}
						isExpanded={isExpanded}
						onToggle={() => onToggleExpand(item.id)}
					/>
				</div>
			)}

			{/* Expanded nested subtasks. Collapsed ones stay mounted for the
			    height animation, so `inert` keeps Tab off the clipped rows. */}
			{hasChildren && (
				<div
					inert={!isExpanded}
					className={cn(
						"overflow-clip transition-all duration-300",
						isExpanded ? "max-h-[2000px]" : "max-h-0",
					)}>
					{children.map((child) => (
						<SubtaskRow
							key={child.item.id}
							node={child}
							depth={depth + 1}
							onToggleExpand={onToggleExpand}
						/>
					))}
				</div>
			)}
		</div>
	)
}

export default memo(SubtaskRow)
