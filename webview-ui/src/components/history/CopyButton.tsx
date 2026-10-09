import { useCallback } from "react"

import { useClipboard } from "@/components/ui/hooks"
import { Button, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

type CopyButtonProps = {
	itemTask: string
}

export const CopyButton = ({ itemTask }: CopyButtonProps) => {
	const { isCopied, copy } = useClipboard()
	const { t } = useAppTranslation()

	const onCopy = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()

			if (!isCopied) {
				copy(itemTask)
			}
		},
		[isCopied, copy, itemTask],
	)

	return (
		<StandardTooltip content={t("history:copyPrompt")}>
			<Button
				aria-label={t("history:copyPrompt")}
				variant="ghost"
				size="icon"
				onClick={onCopy}
				className="h-[22px] w-[22px] text-vscode-descriptionForeground hover:text-vscode-foreground"
				data-testid="copy-prompt-button">
				<span className={cn("codicon scale-80", { "codicon-check": isCopied, "codicon-copy": !isCopied })} />
			</Button>
		</StandardTooltip>
	)
}
