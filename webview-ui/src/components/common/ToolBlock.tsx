import { useId } from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * ToolBlock (§2.2, ai_plans/2026-09-27_ui-modernization.md): the one shared
 * collapsible header primitive for tool blocks.
 *
 * - The header is a real `<button>` with `aria-expanded` / `aria-controls`, so
 *   it is reachable with Tab and announced by screen readers (§1.4).
 * - The chevron sits at 60% opacity by default and reaches 100% on hover or
 *   `:focus-visible`; it is never fully hidden, so keyboard users can see it
 *   (the old `opacity-0`-until-hover chevron was invisible to them).
 * - The container carries a `--border-status`-wide left border in the status
 *   color, which is the one accent line that encodes status (§1.1). Status is
 *   never color alone: `failed` also renders a textual "failed" label.
 * - Corners are square: no radius classes, tokens set `--radius: 0`.
 */

export type ToolBlockStatus = "running" | "done" | "failed" | "waiting"

const STATUS_BORDER_COLOR: Record<ToolBlockStatus, string> = {
	running: "var(--status-running)",
	done: "var(--status-done)",
	failed: "var(--status-failed)",
	waiting: "var(--status-waiting)",
}

export interface ToolBlockProps {
	/** Collapsed by default; the owner (chat row) keeps the state so it survives remounts. */
	isExpanded?: boolean
	onToggleExpand?: () => void
	/** Status of the underlying tool call; drives the left border color. */
	status?: ToolBlockStatus
	/** Codicon name rendered before the tool name. */
	icon?: React.ReactNode
	/** Mono tool name, e.g. `read_file`. */
	toolName?: React.ReactNode
	/** Optional path chip; callers pass a button/link that opens the file. */
	path?: React.ReactNode
	/** Right-aligned meta (a BlockTimestamp and/or a duration). */
	meta?: React.ReactNode
	/** Collapsed state is only valid when there is a body to fold away. */
	children?: React.ReactNode
	className?: string
}

export const ToolBlock = ({
	isExpanded = false,
	onToggleExpand,
	status,
	icon,
	toolName,
	path,
	meta,
	children,
	className,
}: ToolBlockProps) => {
	const bodyId = useId()
	const hasBody = children !== undefined && children !== null
	const collapsible = hasBody && Boolean(onToggleExpand)

	return (
		<div
			className={cn("bg-vscode-editor-background font-mono", className)}
			style={
				status
					? {
							borderLeft: `var(--border-status) solid ${STATUS_BORDER_COLOR[status]}`,
						}
					: undefined
			}>
			<button
				type="button"
				className="group flex w-full flex-row items-center gap-2 px-2 py-1 text-left cursor-pointer bg-transparent border-none focus-ring"
				aria-expanded={collapsible ? isExpanded : undefined}
				aria-controls={collapsible ? bodyId : undefined}
				disabled={!collapsible}
				onClick={collapsible ? onToggleExpand : undefined}>
				{icon}
				{toolName && <span className="truncate">{toolName}</span>}
				{path}
				<span className="flex-grow" />
				{meta}
				{collapsible && (
					<ChevronDown
						className={cn(
							"size-4 shrink-0 transition-transform duration-300 opacity-60 group-hover:opacity-100",
							"group-focus-visible:opacity-100",
							isExpanded && "rotate-180",
						)}
						aria-hidden="true"
					/>
				)}
			</button>
			{status === "failed" && (
				<div className="px-2 pb-1 text-xs text-vscode-errorForeground font-mono">
					{/* Status is never color alone (§1.3). */}
					failed
				</div>
			)}
			{hasBody && (
				<div id={bodyId} className="overflow-y-auto max-h-[300px] font-mono" hidden={!isExpanded}>
					{children}
				</div>
			)}
		</div>
	)
}
