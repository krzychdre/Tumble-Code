import { memo } from "react"

import { cn } from "@/lib/utils"
import { formatTimestamp, formatDuration } from "@src/utils/format"

interface BlockTimestampProps {
	/** Epoch-ms timestamp marking when the status block started. */
	startTs: number
	/** Epoch-ms timestamp marking when the status block finished, if known. */
	endTs?: number
	className?: string
}

/**
 * Small, muted start timestamp shown beside a status block header.
 * When the block has finished (a valid `endTs` after `startTs` is supplied)
 * it additionally renders the block's duration. Styling intentionally uses the
 * VS Code `descriptionForeground` token so the metadata stays non-intrusive.
 */
export const BlockTimestamp = memo(({ startTs, endTs, className }: BlockTimestampProps) => {
	const hasDuration = typeof endTs === "number" && endTs > startTs

	return (
		<span
			className={cn(
				"text-[10px] leading-none text-vscode-descriptionForeground select-none whitespace-nowrap",
				className,
			)}>
			{formatTimestamp(startTs)}
			{hasDuration && (
				<>
					<span className="mx-1 opacity-60" aria-hidden="true">
						·
					</span>
					<span className="opacity-80">{formatDuration(endTs - startTs)}</span>
				</>
			)}
		</span>
	)
})

BlockTimestamp.displayName = "BlockTimestamp"
