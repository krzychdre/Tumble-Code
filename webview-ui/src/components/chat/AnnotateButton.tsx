import React, { memo } from "react"
import { MessageSquarePlus } from "lucide-react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { StandardTooltip } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

interface AnnotateButtonProps {
	markdown: string | undefined
	className?: string
}

export const AnnotateButton = memo(({ markdown, className }: AnnotateButtonProps) => {
	const { t } = useAppTranslation()

	// Only show on non-trivial (>= 100 chars) completed messages.
	if (!markdown || markdown.length < 100) {
		return null
	}

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "openPlanReview", values: { markdown } })
	}

	return (
		<StandardTooltip content={t("chat:planReview.annotateTooltip")}>
			<button
				onClick={handleClick}
				className={`opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${className ?? ""}`}
				aria-label={t("chat:planReview.annotateTooltip")}>
				<MessageSquarePlus className="w-4 h-4" />
			</button>
		</StandardTooltip>
	)
})
