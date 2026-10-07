import { memo, useId } from "react"
import { ArrowRight } from "lucide-react"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import type { SubtaskTreeNode } from "./types"
import { countAllSubtasks } from "./types"
import { StandardTooltip } from "../ui"
import SubtaskCollapsibleRow from "./SubtaskCollapsibleRow"
import RunningStatusIndicator from "./RunningStatusIndicator"

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
				aria-describedby={item.runningStatus ? statusId : undefined}
				className={cn(
					"group flex w-full items-center justify-between gap-2 pr-4 py-1 cursor-pointer",
					"text-left bg-transparent border-none p-0 font-inherit",
					"text-vscode-foreground/60 hover:text-vscode-foreground transition-colors",
					"focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-focusBorder",
				)}
				style={{ paddingLeft: `${depth * 16}px` }}
				onClick={handleClick}>
				<span className="flex min-w-0 items-center gap-1.5">
					<RunningStatusIndicator status={item.runningStatus} id={statusId} />
					<StandardTooltip content={item.task} delay={600}>
						<span className="text-sm line-clamp-1">{item.task}</span>
					</StandardTooltip>
				</span>
				<ArrowRight className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity shrink-0" />
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

			{/* Expanded nested subtasks */}
			{hasChildren && (
				<div
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
