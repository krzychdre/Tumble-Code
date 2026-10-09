import React, { memo } from "react"
import { SquareArrowOutUpRight } from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { hasComplexMarkdown } from "@src/utils/markdown"
import { StandardTooltip } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"

interface OpenMarkdownPreviewButtonProps {
	markdown: string | undefined
	className?: string
}

export const OpenMarkdownPreviewButton = memo(({ markdown, className }: OpenMarkdownPreviewButtonProps) => {
	const { t } = useAppTranslation()

	if (!hasComplexMarkdown(markdown)) {
		return null
	}

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (markdown) {
			vscode.postMessage({
				type: "openMarkdownPreview",
				text: markdown,
			})
		}
	}

	return (
		<StandardTooltip content={t("chat:markdownPreview.open")}>
			<button
				type="button"
				onClick={handleClick}
				className={`inline-flex items-center justify-center size-[22px] p-0 bg-transparent border-none rounded-control text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-surface-hover transition-colors cursor-pointer focus-ring ${className ?? ""}`}
				aria-label={t("chat:markdownPreview.openAriaLabel")}>
				<SquareArrowOutUpRight className="w-4 h-4" />
			</button>
		</StandardTooltip>
	)
})
