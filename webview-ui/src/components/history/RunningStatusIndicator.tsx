import { memo } from "react"
import { MessageCircleQuestion } from "lucide-react"
import type { RunningTaskStatus } from "@tumble-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { ProgressIndicator } from "../chat/ProgressIndicator"
import { StandardTooltip } from "../ui"

interface RunningStatusIndicatorProps {
	/** The task's live status; nothing is rendered for a task at rest. */
	status?: RunningTaskStatus
	/** Lets the row button point `aria-describedby` at the indicator. */
	id?: string
}

/**
 * The live status of a history row: the chat's progress spinner while the task
 * works, the subagents panel's question icon while it waits for the user.
 */
const RunningStatusIndicator = ({ status, id }: RunningStatusIndicatorProps) => {
	const { t } = useAppTranslation()

	if (!status) {
		return null
	}

	const label =
		status === "awaiting_input"
			? t("history:runningIndicator.awaitingInput")
			: t("history:runningIndicator.running")

	return (
		<StandardTooltip content={label}>
			<span
				id={id}
				role="img"
				aria-label={label}
				data-testid={`running-indicator-${status}`}
				className="size-4 shrink-0 flex items-center justify-center">
				{status === "awaiting_input" ? (
					<MessageCircleQuestion className="size-4 shrink-0 text-vscode-charts-yellow" aria-hidden />
				) : (
					<ProgressIndicator />
				)}
			</span>
		</StandardTooltip>
	)
}

export default memo(RunningStatusIndicator)
