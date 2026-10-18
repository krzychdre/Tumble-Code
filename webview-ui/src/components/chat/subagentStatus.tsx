import { CheckCircle2, CircleSlash, Clock, MessageCircleQuestion, XCircle } from "lucide-react"

import type { SubagentSummary } from "@tumble-code/types"

import { ProgressIndicator } from "./ProgressIndicator"

const LIVE_STATUSES = new Set(["queued", "running", "awaiting_input"])

export const isLive = (summary: Pick<SubagentSummary, "status">) => LIVE_STATUSES.has(summary.status)
export const isQueuedPlaceholder = (summary: Pick<SubagentSummary, "taskId">) => summary.taskId.startsWith("queued:")

/** The icon of a subagent status, shared by the panel rows and the transcript header. */
export const StatusIcon = ({ status }: { status: SubagentSummary["status"] }) => {
	switch (status) {
		case "queued":
			return <Clock className="size-4 shrink-0 text-vscode-descriptionForeground" aria-hidden />
		case "running":
			return (
				<span className="size-4 shrink-0 flex items-center justify-center">
					<ProgressIndicator />
				</span>
			)
		case "awaiting_input":
			return <MessageCircleQuestion className="size-4 shrink-0 text-vscode-charts-yellow" aria-hidden />
		case "completed":
			return <CheckCircle2 className="size-4 shrink-0 text-vscode-charts-green" aria-hidden />
		case "failed":
			return <XCircle className="size-4 shrink-0 text-vscode-charts-red" aria-hidden />
		case "cancelled":
			return <CircleSlash className="size-4 shrink-0 text-vscode-descriptionForeground" aria-hidden />
	}
}
