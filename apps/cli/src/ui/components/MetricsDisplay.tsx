import { memo } from "react"
import { Text, Box } from "ink"

import type { TokenUsage } from "@roo-code/types"

import * as theme from "../theme.js"

interface MetricsDisplayProps {
	tokenUsage: TokenUsage
	contextWindow: number
}

/**
 * Formats a large number with K (thousands) or M (millions) suffix.
 *
 * Examples:
 * - 1234 -> "1.2K"
 * - 1234567 -> "1.2M"
 * - 500 -> "500"
 */
function formatNumber(num: number): string {
	if (num >= 1_000_000) {
		return `${(num / 1_000_000).toFixed(1)}M`
	}
	if (num >= 1_000) {
		return `${(num / 1_000).toFixed(1)}K`
	}
	return num.toString()
}

/**
 * Formats cost as currency with $ prefix.
 *
 * Examples:
 * - 0.12345 -> "$0.12"
 * - 1.5 -> "$1.50"
 */
function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`
}

/**
 * Condensed one-line metrics display: `$cost · ↓in · ↑out · ctx%`.
 * The full progress-bar variant was removed during the Claude-style UI
 * redesign (see ai_plans/2026-08-05_cli-claude-code-style-ui-redesign.md,
 * WP-C). The `formatNumber`/`formatCost` helpers remain the canonical
 * exports used by InputFooter and other consumers.
 */
function MetricsDisplay({ tokenUsage, contextWindow }: MetricsDisplayProps) {
	const { totalCost, totalTokensIn, totalTokensOut, contextTokens } = tokenUsage
	const ctxPercent = contextWindow > 0 ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : 0
	const ctxColor = ctxPercent >= 80 ? theme.warning : theme.subtle

	return (
		<Box>
			<Text color={theme.text}>{formatCost(totalCost)}</Text>
			<Text color={theme.subtle}> · </Text>
			<Text color={theme.subtle}>
				↓ <Text color={theme.text}>{formatNumber(totalTokensIn)}</Text>
			</Text>
			<Text color={theme.subtle}> · </Text>
			<Text color={theme.subtle}>
				↑ <Text color={theme.text}>{formatNumber(totalTokensOut)}</Text>
			</Text>
			<Text color={theme.subtle}> · </Text>
			<Text color={ctxColor}>{ctxPercent}%</Text>
		</Box>
	)
}

export default memo(MetricsDisplay)
export { formatNumber, formatCost }
