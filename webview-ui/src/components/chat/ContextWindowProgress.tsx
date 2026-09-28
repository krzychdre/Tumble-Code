import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { formatLargeNumber } from "@/utils/format"
import { calculateTokenDistribution } from "@/utils/model-utils"
import { StandardTooltip } from "@/components/ui"

interface ContextWindowProgressProps {
	contextWindow: number
	contextTokens: number
	maxTokens?: number
}

export const ContextWindowProgress = ({ contextWindow, contextTokens, maxTokens }: ContextWindowProgressProps) => {
	const { t } = useTranslation()

	// Use the shared utility function to calculate all token distribution values
	const tokenDistribution = useMemo(
		() => calculateTokenDistribution(contextWindow, contextTokens, maxTokens),
		[contextWindow, contextTokens, maxTokens],
	)

	// Destructure the values we need
	const { currentPercent, reservedPercent, availableSize, reservedForOutput, availablePercent } = tokenDistribution

	// For display purposes
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)

	// Combine all tooltip content into a single tooltip
	const tooltipContent = (
		<div className="space-y-1">
			<div>
				{t("chat:tokenProgress.tokensUsed", {
					used: formatLargeNumber(safeContextTokens),
					total: formatLargeNumber(safeContextWindow),
				})}
			</div>
			{reservedForOutput > 0 && (
				<div>
					{t("chat:tokenProgress.reservedForResponse", {
						amount: formatLargeNumber(reservedForOutput),
					})}
				</div>
			)}
			{availableSize > 0 && (
				<div>
					{t("chat:tokenProgress.availableSpace", {
						amount: formatLargeNumber(availableSize),
					})}
				</div>
			)}
		</div>
	)

	// §2.4 (ai_plans/2026-09-27_ui-modernization.md): the used part turns
	// --status-waiting above 75% and --status-failed above 90%. Status is never
	// colour alone, so the percentage is rendered as text next to the bar.
	// The percentage is of the AVAILABLE input space (context window minus the
	// output reservation), matching the formula the task header has always
	// shown; the bar's filled width keeps the whole-window ratio so the
	// reserved segment stays visible.
	const availableInputSpace = safeContextWindow - reservedForOutput
	const usedPercent =
		availableInputSpace > 0 ? Math.min(100, (safeContextTokens / availableInputSpace) * 100) : 0
	const usedColor =
		usedPercent > 90
			? "var(--status-failed)"
			: usedPercent > 75
				? "var(--status-waiting)"
				: "var(--vscode-foreground)"

	return (
		<div className="flex items-center gap-2 flex-1 whitespace-nowrap">
			<div data-testid="context-tokens-count">{formatLargeNumber(safeContextTokens)}</div>
			<StandardTooltip content={tooltipContent} side="top" sideOffset={8}>
				<div
					// §2.4: 3px tall with square ends, announced as a progressbar.
					role="progressbar"
					aria-label={t("chat:tokenProgress.contextUsed")}
					aria-valuenow={Math.round(usedPercent)}
					aria-valuemin={0}
					aria-valuemax={100}
					data-testid="context-progressbar"
					className="flex-1 relative">
					{/* Main progress bar container: 3px, square ends */}
					<div className="flex items-center h-[3px] overflow-hidden w-full bg-[color-mix(in_srgb,var(--vscode-foreground)_20%,transparent)]">
						{/* Current tokens container */}
						<div
							className="relative h-full"
							style={{ width: `${currentPercent}%` }}
							data-testid="context-tokens-used">
							{/* Current tokens used - status colour above the thresholds */}
							<div
								className="h-full w-full transition-width duration-300 ease-out"
								style={{ backgroundColor: usedColor }}
							/>
						</div>

						{/* Container for reserved tokens */}
						<div
							className="relative h-full"
							style={{ width: `${reservedPercent}%` }}
							data-testid="context-reserved-tokens">
							{/* Reserved for output section - medium gray */}
							<div className="h-full w-full bg-[color-mix(in_srgb,var(--vscode-foreground)_30%,transparent)] transition-width duration-300 ease-out" />
						</div>

						{/* Empty section (if any) */}
						{availablePercent > 0 && (
							<div
								className="relative h-full"
								style={{ width: `${availablePercent}%` }}
								data-testid="context-available-space-section">
								{/* Available space - transparent */}
							</div>
						)}
					</div>
				</div>
			</StandardTooltip>
			{/* The percentage as text (§1.3: status never colour alone). */}
			<span data-testid="context-used-percent" className="text-[var(--text-meta)]">
				{Math.round(usedPercent)}%
			</span>
			<div data-testid="context-window-size">{formatLargeNumber(safeContextWindow)}</div>
		</div>
	)
}
