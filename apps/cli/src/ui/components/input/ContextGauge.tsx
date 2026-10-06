import { memo } from "react"
import { Text } from "ink"

import * as theme from "../../theme.js"

/** Cells in the bar, so one cell is ten percent. */
const GAUGE_CELLS = 10

const FILLED_CELL = "█"
const EMPTY_CELL = "░"

/** Percentage at which the gauge stops being decorative and starts warning. */
const WARN_AT = 80
const ALARM_AT = 95

/**
 * Cells to light for a given fill percentage.
 *
 * Neither end rounds symmetrically, on purpose: any context at all lights the
 * first cell, so a fresh task does not look identical to an empty one, and only
 * a true 100 lights the last one, so a full bar is never a lie at 96%.
 */
export function fillCells(percent: number, cells: number = GAUGE_CELLS): number {
	if (percent >= 100) {
		return cells
	}
	if (percent <= 0) {
		return 0
	}
	return Math.min(cells - 1, Math.max(1, Math.round((percent / 100) * cells)))
}

/** Colour of the filled cells and of the percentage, by how full the window is. */
export function gaugeColor(percent: number): string {
	if (percent >= ALARM_AT) {
		return theme.error
	}
	if (percent >= WARN_AT) {
		return theme.warning
	}
	return theme.secondaryText
}

/**
 * A token count short enough for the footer: `850`, `12.4K`, `262K`, `1.0M`.
 * Above 100K the decimal is dropped; nobody reads it at that size.
 */
export function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`
	}
	if (tokens >= 100_000) {
		return `${Math.round(tokens / 1_000)}K`
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}K`
	}
	return String(Math.round(tokens))
}

interface ContextGaugeProps {
	/** Context window usage, 0-100. */
	percent: number
	/** Tokens in the context now; shown with the window after the percentage. */
	tokens?: number
	/** Size of the context window in tokens. */
	window?: number
}

/**
 * Context-window fill gauge for the input footer: a ten-cell bar followed by
 * the percentage and, when known, the tokens in the context out of the
 * window (`45% 118K/262K`), all in the same colour so they read as one unit.
 */
function ContextGauge({ percent, tokens, window }: ContextGaugeProps) {
	const clamped = Math.max(0, Math.min(100, percent))
	const filled = fillCells(clamped)
	const color = gaugeColor(clamped)

	return (
		<Text>
			<Text color={color}>{FILLED_CELL.repeat(filled)}</Text>
			<Text color={theme.dimmed(theme.inactive)}>{EMPTY_CELL.repeat(GAUGE_CELLS - filled)}</Text>
			<Text color={color}> {clamped}%</Text>
			{tokens !== undefined && window !== undefined && window > 0 && (
				<Text color={color}>
					{" "}
					{formatTokenCount(tokens)}/{formatTokenCount(window)}
				</Text>
			)}
		</Text>
	)
}

export default memo(ContextGauge)
