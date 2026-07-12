import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Brain } from "lucide-react"

import { cn } from "@/lib/utils"

import { ProgressIndicator } from "./ProgressIndicator"

interface MemoryActivityBadgeProps {
	memoryActivity: { recall: number; write: number } | undefined
	className?: string
}

/**
 * Small status line shown while the memory system is busy: recall prefetches
 * (reading/ranking memories for the current turn) and background writers
 * (extraction/dream) can take noticeable time — the user should see that it
 * is happening. Renders nothing when idle.
 */
const MemoryActivityBadge = memo(({ memoryActivity, className }: MemoryActivityBadgeProps) => {
	const { t } = useTranslation()

	const recalling = (memoryActivity?.recall ?? 0) > 0
	const writing = (memoryActivity?.write ?? 0) > 0

	if (!recalling && !writing) {
		return null
	}

	const label =
		recalling && writing
			? t("chat:memoryActivity.both")
			: writing
				? t("chat:memoryActivity.writing")
				: t("chat:memoryActivity.recalling")

	return (
		<div className={cn("flex items-center gap-2 px-3 py-1 text-xs text-vscode-descriptionForeground", className)}>
			<span className="size-3.5 flex items-center justify-center">
				<ProgressIndicator />
			</span>
			<Brain className="size-3.5 shrink-0" aria-hidden />
			<span>{label}</span>
		</div>
	)
})

MemoryActivityBadge.displayName = "MemoryActivityBadge"

export default MemoryActivityBadge
