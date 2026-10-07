import { memo } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { StandardTooltip } from "../ui"
import type { DisplayHistoryItem } from "./types"

const usd = (cost: number) => "$" + cost.toFixed(2)

interface TaskCostProps {
	item: DisplayHistoryItem
	"data-testid"?: string
}

/**
 * The cost of a history row. A task with subtasks shows the cost of its whole
 * tree, the figure the cloud reports too; the tooltip splits off its own part.
 * Renders nothing for a task that has cost nothing yet.
 */
const TaskCost = ({ item, "data-testid": testId }: TaskCostProps) => {
	const { t } = useAppTranslation()
	const own = item.totalCost || 0
	const total = item.subtreeCost ?? own

	if (!total) {
		return null
	}

	const amount = (
		<span className="tabular-nums" data-testid={testId}>
			{usd(total)}
		</span>
	)

	if (item.subtreeCost === undefined) {
		return amount
	}

	return (
		<StandardTooltip content={t("history:costWithSubtasks", { total: usd(total), own: usd(own) })}>
			{amount}
		</StandardTooltip>
	)
}

export default memo(TaskCost)
