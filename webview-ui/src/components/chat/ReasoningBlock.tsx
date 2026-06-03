import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import MarkdownBlock from "../common/MarkdownBlock"
import { Lightbulb, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { BlockTimestamp } from "./BlockTimestamp"

interface ReasoningBlockProps {
	content: string
	/** Epoch-ms timestamp marking when the thinking block started. */
	ts: number
	/**
	 * Epoch-ms timestamp marking when the thinking block finished — the `ts` of
	 * the next message in the conversation. Undefined while thinking is still
	 * the latest message, in which case no duration is shown yet. Using the
	 * next message's timestamp keeps the duration consistent with every other
	 * status block and correct for reopened (historical) tasks.
	 */
	endTs?: number
	metadata?: any
}

export const ReasoningBlock = ({ content, ts, endTs }: ReasoningBlockProps) => {
	const { t } = useTranslation()
	const { reasoningBlockCollapsed } = useExtensionState()

	const [isCollapsed, setIsCollapsed] = useState(reasoningBlockCollapsed)
	const contentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setIsCollapsed(reasoningBlockCollapsed)
	}, [reasoningBlockCollapsed])

	const handleToggle = () => {
		setIsCollapsed(!isCollapsed)
	}

	return (
		<div className="group">
			<div
				className="flex items-center justify-between mb-2.5 pr-2 cursor-pointer select-none"
				onClick={handleToggle}>
				<div className="flex items-center gap-2">
					<Lightbulb className="w-4" />
					<span className="font-bold text-vscode-foreground">{t("chat:reasoning.thinking")}</span>
					<BlockTimestamp startTs={ts} endTs={endTs} live />
				</div>
				<div className="flex items-center gap-2">
					<ChevronUp
						className={cn(
							"w-4 transition-all opacity-0 group-hover:opacity-100",
							isCollapsed && "-rotate-180",
						)}
					/>
				</div>
			</div>
			{(content?.trim()?.length ?? 0) > 0 && !isCollapsed && (
				<div
					ref={contentRef}
					className="border-l border-vscode-descriptionForeground/20 ml-2 pl-4 pb-1 text-vscode-descriptionForeground break-words">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
