import { useId } from "react"

import { cn } from "@/lib/utils"

/**
 * ToolBlock (§2.2, ai_plans/2026-09-27_ui-modernization.md): the one shared
 * collapsible header primitive for tool blocks.
 *
 * - The header holds a real `<button>` with `aria-expanded` / `aria-controls`,
 *   so it is reachable with Tab and announced by screen readers (§1.4). Its
 *   `::before` covers the whole header, so a click anywhere on the header
 *   toggles, as before, while the header can still hold other buttons
 *   (`actions`) without nesting them in the toggle.
 * - Content inside `title` that needs its own hover (a path tooltip) gets
 *   `relative` so it sits above that overlay; a click on it still toggles.
 * - The chevron sits at 60% opacity by default and reaches 100% on hover or
 *   when the toggle has keyboard focus; it is never fully hidden, so keyboard
 *   users can see it (the old `opacity-0`-until-hover chevron was invisible to
 *   them).
 * - The body is mounted only while expanded, so a collapsed block costs no
 *   highlighting or diff rendering.
 * - With `status`, the container carries a `--border-status`-wide left border
 *   in the status color, the one accent line that encodes status (§1.1).
 *   Status is never color alone: `failed` also renders a textual label.
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
	/** The toggle's content: icon, name, path. Must not contain buttons or links. */
	title: React.ReactNode
	/** Non-interactive text after the title (diff stats, progress); clicks on it toggle. */
	meta?: React.ReactNode
	/** Buttons on the header (open diff, open file); they sit above the toggle overlay. */
	actions?: React.ReactNode
	/** Collapsed state is only valid when there is a body to fold away. */
	children?: React.ReactNode
	className?: string
	headerClassName?: string
	bodyClassName?: string
	/** For specs and golden renders that look the header up. */
	headerTestId?: string
}

export const ToolBlock = ({
	isExpanded = false,
	onToggleExpand,
	status,
	title,
	meta,
	actions,
	children,
	className,
	headerClassName,
	bodyClassName,
	headerTestId,
}: ToolBlockProps) => {
	const bodyId = useId()
	const hasBody = children !== undefined && children !== null && children !== false && children !== ""
	const collapsible = hasBody && Boolean(onToggleExpand)
	const showBody = hasBody && (isExpanded || !onToggleExpand)

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
			<div
				data-testid={headerTestId}
				className={cn(
					"group relative flex items-center select-none text-sm text-vscode-descriptionForeground",
					headerClassName,
				)}>
				<button
					type="button"
					className={cn(
						"flex min-w-0 flex-1 items-center p-0 text-left bg-transparent border-none text-inherit",
						"before:absolute before:inset-0 before:content-['']",
						"focus-visible:outline-none focus-visible:before:outline focus-visible:before:outline-(--ring) focus-visible:before:-outline-offset-1",
						collapsible ? "cursor-pointer" : "cursor-default",
					)}
					aria-expanded={collapsible ? isExpanded : undefined}
					aria-controls={collapsible && isExpanded ? bodyId : undefined}
					disabled={!collapsible}
					onClick={collapsible ? onToggleExpand : undefined}>
					{title}
				</button>
				{meta}
				{actions && <div className="relative flex items-center">{actions}</div>}
				{collapsible && (
					<span
						className={cn(
							"codicon shrink-0 opacity-60 group-hover:opacity-100 group-has-[button[aria-expanded]:focus-visible]:opacity-100",
							isExpanded ? "codicon-chevron-up" : "codicon-chevron-down",
						)}
						aria-hidden="true"
					/>
				)}
			</div>
			{status === "failed" && (
				<div className="px-2 pb-1 text-xs text-vscode-errorForeground font-mono">
					{/* Status is never color alone (§1.3). */}
					failed
				</div>
			)}
			{showBody && (
				<div id={bodyId} className={cn("overflow-y-auto max-h-[300px] font-mono", bodyClassName)}>
					{children}
				</div>
			)}
		</div>
	)
}
