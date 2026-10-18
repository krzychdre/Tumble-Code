import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bot, ChevronDown, ChevronRight, Square } from "lucide-react"

import type { SubagentSummary } from "@tumble-code/types"

import { Collapsible, CollapsibleContent, CollapsibleTrigger, StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"
import { formatTimestamp } from "@src/utils/format"

import { useOpenSubagentTranscript } from "./SubagentTranscriptContext"
import { StatusIcon, isLive, isQueuedPlaceholder } from "./subagentStatus"

interface SubagentsPanelProps {
	subagents: SubagentSummary[] | undefined
	/** The task open in the chat. Only its own fan-out is listed. */
	taskId: string | undefined
	className?: string
}

/**
 * One subagent: status, mode, profile, what it does now, tokens and cost.
 * Clicking it opens its whole transcript (SubagentTranscriptView), where a
 * running one can also be answered and guided. A queued one has no task yet,
 * so there is nothing to open.
 */
const SubagentRow = ({ summary }: { summary: SubagentSummary }) => {
	const { t } = useTranslation()
	const openTranscript = useOpenSubagentTranscript()

	const cancel = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			vscode.postMessage({ type: "cancelSubagent", taskId: summary.taskId })
		},
		[summary.taskId],
	)

	const tokens = summary.tokensIn + summary.tokensOut
	const showCost = summary.totalCost > 0
	const queued = isQueuedPlaceholder(summary)
	const cancellable = isLive(summary) && !queued
	// While it works the row says what it does; once it stopped without
	// finishing, why.
	const detail = isLive(summary)
		? summary.activity
		: summary.status === "failed" || summary.status === "cancelled"
			? summary.finalMessage
			: undefined

	return (
		// shrink-0: overflow-hidden drops a flex item's content-based minimum
		// height, so in the height-capped list the rows were squashed into slivers
		// instead of the list scrolling.
		<div className="shrink-0 border border-frame bg-surface rounded-control overflow-hidden">
			<div className="flex items-center">
				<button
					type="button"
					disabled={queued}
					onClick={() => openTranscript(summary.taskId)}
					title={queued ? undefined : t("chat:subagents.openTranscript")}
					className={cn(
						"flex flex-col gap-0.5 grow min-w-0 min-h-[28px] px-2 py-1 text-left bg-transparent border-0",
						"text-vscode-foreground transition-colors",
						!queued && "cursor-pointer hover:bg-surface-hover",
						"focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder",
					)}>
					<span className="flex items-center gap-2 w-full min-w-0">
						<StatusIcon status={summary.status} />
						<span className="text-xs px-1 py-0.5 bg-vscode-badge-background text-vscode-badge-foreground rounded-control shrink-0">
							{summary.mode}
						</span>
						{summary.apiConfigName && (
							<span
								className="text-xs text-vscode-descriptionForeground shrink-0 max-w-24 truncate"
								title={t("chat:subagents.apiConfig", { name: summary.apiConfigName })}>
								{summary.apiConfigName}
							</span>
						)}
						<span className="text-sm truncate grow" title={summary.description}>
							{summary.description}
						</span>
						<span
							className="text-xs text-vscode-descriptionForeground shrink-0"
							title={t("chat:subagents.tokens")}>
							{tokens > 0 ? `${(tokens / 1000).toFixed(1)}k` : ""}
							{showCost ? ` · $${summary.totalCost.toFixed(2)}` : ""}
						</span>
						<span
							className={cn(
								"text-xs shrink-0",
								summary.status === "awaiting_input"
									? "text-vscode-charts-yellow"
									: "text-vscode-descriptionForeground",
							)}>
							{t(`chat:subagents.status.${summary.status}`)}
						</span>
					</span>
					{detail && (
						<span
							data-testid="subagent-row-detail"
							className={cn(
								"block w-full pl-6 text-xs truncate",
								isLive(summary)
									? "font-mono text-vscode-descriptionForeground"
									: "text-vscode-errorForeground",
							)}
							title={detail}>
							{detail}
						</span>
					)}
				</button>
				{cancellable && (
					<StandardTooltip content={t("chat:subagents.cancel")}>
						<button
							aria-label={t("chat:subagents.cancel")}
							type="button"
							onClick={cancel}
							className={cn(
								"flex items-center justify-center size-[22px] p-0 mr-1 border-0 rounded-control cursor-pointer bg-transparent shrink-0",
								"text-vscode-descriptionForeground hover:text-vscode-errorForeground hover:bg-surface-hover focus-ring",
							)}>
							<Square className="size-3.5" aria-hidden />
						</button>
					</StandardTooltip>
				)}
			</div>
		</div>
	)
}

/** The rows of one `run_parallel_tasks` call, in panel order. */
interface SubagentRun {
	/** SubagentSummary.runId, "" for rows whose run is unknown. */
	runId: string
	rows: SubagentSummary[]
}

/** Split the panel-ordered rows (run, then index) into their runs. */
function groupByRun(subagents: SubagentSummary[]): SubagentRun[] {
	const runs: SubagentRun[] = []
	for (const summary of subagents) {
		const runId = summary.runId ?? ""
		const last = runs.at(-1)
		if (last?.runId === runId) {
			last.rows.push(summary)
		} else {
			runs.push({ runId, rows: [summary] })
		}
	}
	return runs
}

const rowKey = (summary: SubagentSummary) => `${summary.runId ?? ""}:${summary.index}`

/**
 * One run of a task that fanned out several times: a header with the run's
 * number, start time and progress, over its rows. Starts open when it is the
 * latest run or still has live rows; earlier finished runs start closed.
 */
const SubagentRunGroup = ({ run, number, isLatest }: { run: SubagentRun; number: number; isLatest: boolean }) => {
	const { t } = useTranslation()
	const anyLive = run.rows.some(isLive)
	const [open, setOpen] = useState(isLatest || anyLive)
	const finished = run.rows.filter((summary) => !isLive(summary)).length
	const startedAt = Math.min(...run.rows.map((summary) => summary.startedAt))
	const counts = { finished, total: run.rows.length }

	return (
		<div className="shrink-0 flex flex-col gap-1">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				aria-expanded={open}
				className={cn(
					"flex items-center gap-1 min-h-[22px] px-1 text-left text-xs text-vscode-descriptionForeground",
					"bg-transparent border-0 rounded-control cursor-pointer hover:bg-surface-hover focus-ring",
				)}>
				{open ? (
					<ChevronDown className="size-3 shrink-0" aria-hidden />
				) : (
					<ChevronRight className="size-3 shrink-0" aria-hidden />
				)}
				{run.runId
					? t("chat:subagents.runHeader", { number, time: formatTimestamp(startedAt), ...counts })
					: t("chat:subagents.runEarlier", counts)}
			</button>
			{open && run.rows.map((summary) => <SubagentRow key={rowKey(summary)} summary={summary} />)}
		</div>
	)
}

/**
 * Panel above the chat input listing the parallel background subagents of
 * every `run_parallel_tasks` fan-out of the open task (grouped by run when
 * there are several): live status and current activity per child, its whole
 * transcript one click away, and per-child cancel.
 * Renders nothing when the open task has no fan-out.
 *
 * The panel belongs to the task that fanned out, like the edited-files bar
 * belongs to its task. The host registry keeps a parent's rows while the
 * parent hands work to a `new_task` subtask (the parent is not reset, it
 * resumes later), so the list is filtered by `parentTaskId` here: a subtask,
 * or any other task opened meanwhile, never shows its parent's subagents.
 *
 * The list starts collapsed: a wide fan-out would otherwise cover the chat
 * every time the task is opened. ChatView keys the panel by task id, so
 * entering another task collapses it again.
 */
const SubagentsPanel = memo(({ subagents: allSubagents, taskId, className }: SubagentsPanelProps) => {
	const { t } = useTranslation()
	const [panelExpanded, setPanelExpanded] = useState(false)

	const subagents = useMemo(
		() => (allSubagents ?? []).filter((summary) => summary.parentTaskId === taskId),
		[allSubagents, taskId],
	)
	// "Active" used to count queued children too, so a fan-out with 4 running
	// and 16 waiting for a slot read "20/20 active". Each live state is
	// counted on its own; the header names only the non-zero ones.
	const counts = useMemo(() => {
		const byStatus = { running: 0, queued: 0, awaiting_input: 0 }
		for (const summary of subagents) {
			if (summary.status in byStatus) {
				byStatus[summary.status as keyof typeof byStatus]++
			}
		}
		return byStatus
	}, [subagents])
	const anyLive = counts.running + counts.queued + counts.awaiting_input > 0
	const runs = useMemo(() => groupByRun(subagents), [subagents])
	// Runs with a known id are numbered in start order; rows of an unknown
	// run (saved before runs were told apart) come first and get no number.
	const firstNumbered = runs[0]?.runId ? 0 : 1

	const handleOpenChange = useCallback((open: boolean) => setPanelExpanded(open), [])

	if (!taskId || subagents.length === 0) {
		return null
	}

	return (
		<Collapsible open={panelExpanded} onOpenChange={handleOpenChange} className={cn("px-3", className)}>
			<CollapsibleTrigger
				className={cn(
					"flex items-center gap-2 w-full min-h-[28px] px-1 py-1 text-left text-vscode-foreground rounded-control",
					"hover:bg-surface-hover transition-colors focus-ring",
				)}>
				{panelExpanded ? (
					<ChevronDown className="size-4 shrink-0" aria-hidden />
				) : (
					<ChevronRight className="size-4 shrink-0" aria-hidden />
				)}
				<Bot className="size-4 shrink-0" aria-hidden />
				<span className="text-sm font-medium">
					{anyLive
						? [
								t("chat:subagents.headerRunning", { running: counts.running, total: subagents.length }),
								counts.queued > 0 && t("chat:subagents.headerQueued", { count: counts.queued }),
								counts.awaiting_input > 0 &&
									t("chat:subagents.headerAwaitingInput", { count: counts.awaiting_input }),
							]
								.filter(Boolean)
								.join(" · ")
						: t("chat:subagents.headerDone", { total: subagents.length })}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{/* Several expanded rows must not push the chat and the composer
				    out of view: the list scrolls once it fills half the height. */}
				<div
					data-testid="subagents-list"
					className="flex flex-col gap-1 pb-2 pl-6 max-h-[50vh] overflow-y-auto">
					{runs.length === 1
						? runs[0].rows.map((summary) => <SubagentRow key={rowKey(summary)} summary={summary} />)
						: runs.map((run, i) => (
								<SubagentRunGroup
									key={run.runId}
									run={run}
									number={i - firstNumbered + 1}
									isLatest={i === runs.length - 1}
								/>
							))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
})

SubagentsPanel.displayName = "SubagentsPanel"

export default SubagentsPanel
