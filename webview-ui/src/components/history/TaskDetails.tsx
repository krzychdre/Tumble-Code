import { memo } from "react"
import { Check, CircleDashed } from "lucide-react"

import { getModeBySlug } from "@shared/modes"
import { useExtensionSelector } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { formatDateTime, formatLargeNumber, formatTimestamp } from "@/utils/format"
import { ModeIcon, modeLabel } from "../chat/modeIcon"
import { StandardTooltip } from "../ui"
import TaskCost from "./TaskCost"
import type { DisplayHistoryItem } from "./types"

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

interface TaskDetailsProps {
	item: DisplayHistoryItem
	/** Lets the row button point `aria-describedby` at the details. */
	id?: string
}

/**
 * The summary line of a history row, the same for a task and a subtask: mode,
 * start time, outcome, cost and tokens. Cost and tokens cover the task's whole
 * subtree. Each part is left out when the history item lacks it. A working
 * task shows no outcome, its spinner already carries the live status.
 */
const TaskDetails = ({ item, id }: TaskDetailsProps) => {
	const { t } = useAppTranslation()
	const customModes = useExtensionSelector((s) => s.customModes)

	const modeName = item.mode ? modeLabel(getModeBySlug(item.mode, customModes)?.name ?? item.mode) : undefined
	// History saved before task status existed has none; claim no outcome for it.
	const outcome =
		item.runningStatus || !item.status ? undefined : item.status === "completed" ? "completed" : "unfinished"
	const tokensIn = item.subtree?.tokensIn ?? (item.tokensIn || 0)
	const tokensOut = item.subtree?.tokensOut ?? (item.tokensOut || 0)
	const tokensTooltip = item.subtree
		? t("history:tokensInOutWithSubtasks", {
				in: tokensIn.toLocaleString(),
				out: tokensOut.toLocaleString(),
				ownIn: (item.tokensIn || 0).toLocaleString(),
				ownOut: (item.tokensOut || 0).toLocaleString(),
			})
		: t("history:tokensInOut", { in: tokensIn.toLocaleString(), out: tokensOut.toLocaleString() })

	const parts = [
		modeName && (
			<span key="mode" className="flex items-center gap-1">
				<ModeIcon slug={item.mode!} className="size-3" />
				{modeName}
			</span>
		),
		<StandardTooltip key="time" content={new Date(item.ts).toLocaleString()}>
			<span className="tabular-nums">
				{sameDay(item.ts, Date.now()) ? formatTimestamp(item.ts) : formatDateTime(item.ts)}
			</span>
		</StandardTooltip>,
		outcome && (
			<span
				key="outcome"
				data-testid={`task-outcome-${outcome}`}
				className={
					outcome === "completed"
						? "flex items-center gap-1 text-vscode-charts-green"
						: "flex items-center gap-1"
				}>
				{outcome === "completed" ? (
					<Check className="size-3" aria-hidden />
				) : (
					<CircleDashed className="size-3" aria-hidden />
				)}
				{t(`history:taskOutcome.${outcome}`)}
			</span>
		),
		!!(item.subtree?.cost ?? item.totalCost) && <TaskCost key="cost" item={item} data-testid="task-cost" />,
		!!(tokensIn || tokensOut) && (
			<StandardTooltip key="tokens" content={tokensTooltip}>
				<span className="tabular-nums" data-testid="task-tokens">
					↑{formatLargeNumber(tokensIn)} ↓{formatLargeNumber(tokensOut)}
				</span>
			</StandardTooltip>
		),
	].filter(Boolean)

	return (
		<span
			id={id}
			data-testid="task-details"
			className="flex flex-wrap items-center gap-x-1.5 text-xs text-vscode-descriptionForeground/80">
			{parts.map((part, index) => (
				<span key={index} className="flex items-center gap-1.5">
					{index > 0 && <span aria-hidden>·</span>}
					{part}
				</span>
			))}
		</span>
	)
}

export default memo(TaskDetails)
