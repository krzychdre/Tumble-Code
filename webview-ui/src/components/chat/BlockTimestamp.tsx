import { memo, useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import { formatTimestamp, formatDuration } from "@src/utils/format"

interface BlockTimestampProps {
	/** Epoch-ms timestamp marking when the status block started. */
	startTs: number
	/** Epoch-ms timestamp marking when the status block finished, if known. */
	endTs?: number
	/**
	 * When `true` and no `endTs` is provided, render a live-ticking elapsed
	 * duration (refreshed every second) instead of omitting the duration. The
	 * live value uses the same span, font, and `formatDuration` helper as the
	 * static post-completion duration, so only one duration is ever rendered.
	 */
	live?: boolean
	className?: string
}

/**
 * Small, muted start timestamp shown beside a status block header.
 *
 * Rendering rules for the duration span (kept in one place so live and final
 * values are visually identical):
 *   - `endTs > startTs`              → static `formatDuration(endTs - startTs)`
 *   - `live` and no usable `endTs`   → live `formatDuration(now - startTs)`, ticks each second
 *   - otherwise                      → start time only (no duration shown)
 *
 * Styling intentionally uses the VS Code `descriptionForeground` token so the
 * metadata stays non-intrusive.
 */
export const BlockTimestamp = memo(({ startTs, endTs, live = false, className }: BlockTimestampProps) => {
	const hasFinalDuration = typeof endTs === "number" && endTs > startTs
	const shouldTick = live && !hasFinalDuration

	const [now, setNow] = useState<number>(() => Date.now())

	useEffect(() => {
		if (!shouldTick) return
		// 1 Hz is enough for visible progress and avoids needless re-renders.
		// formatDuration shows `X.Ys` sub-minute / `Xm YYs` longer, so a 1s
		// cadence advances the displayed value on every tick.
		setNow(Date.now())
		const id = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(id)
	}, [shouldTick, startTs])

	const durationMs = hasFinalDuration ? (endTs as number) - startTs : shouldTick ? Math.max(0, now - startTs) : null

	return (
		<span
			className={cn(
				"text-[10px] leading-none text-vscode-descriptionForeground select-none whitespace-nowrap",
				className,
			)}>
			{formatTimestamp(startTs)}
			{durationMs !== null && (
				<>
					<span className="mx-1 opacity-60" aria-hidden="true">
						·
					</span>
					<span className="opacity-80">{formatDuration(durationMs)}</span>
				</>
			)}
		</span>
	)
})

BlockTimestamp.displayName = "BlockTimestamp"
