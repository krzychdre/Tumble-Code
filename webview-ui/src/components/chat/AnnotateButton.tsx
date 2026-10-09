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
				type="button"
				onClick={handleClick}
				className={`inline-flex items-center justify-center size-[22px] p-0 bg-transparent border-none rounded-control text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-surface-hover transition-colors cursor-pointer focus-ring ${className ?? ""}`}
				aria-label={t("chat:planReview.annotateTooltip")}>
				<MessageSquarePlus className="w-4 h-4" />
			</button>
		</StandardTooltip>
	)
})
