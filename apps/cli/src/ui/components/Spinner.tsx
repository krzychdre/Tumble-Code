import { memo, useEffect, useState } from "react"
import { Box, Text } from "ink"

import { SPINNER_FRAMES } from "../figures.js"
import { pickVerb } from "../spinnerVerbs.js"
import * as theme from "../theme.js"

/**
 * Formats a number with K (thousands) or M (millions) suffix.
 * Local copy — deliberately not imported from MetricsDisplay (WP-C consolidates).
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

interface Props {
	startTime: number
	tokensOut?: number
	verb?: string
	isActive?: boolean
}

/**
 * Loading spinner: brand-colored frame cycling ping-pong through the spinner
 * frames at ~120ms, a verb picked deterministically from the loading-start
 * timestamp, and a dim elapsed/token suffix. Frames stop when isActive is
 * false (e.g. when a dialog steals the frame).
 */
function Spinner({ startTime, tokensOut, verb, isActive = true }: Props) {
	const [frameIndex, setFrameIndex] = useState(0)
	const [elapsed, setElapsed] = useState(0)

	useEffect(() => {
		if (!isActive) {
			return
		}
		const timer = setInterval(() => {
			setFrameIndex((prev) => {
				// Ping-pong through the frames
				const frameCount = SPINNER_FRAMES.length
				const period = frameCount * 2 - 2
				const step = (prev + 1) % period
				return step < frameCount ? step : period - step
			})
		}, 120)
		return () => clearInterval(timer)
	}, [isActive])

	useEffect(() => {
		if (!isActive) {
			return
		}
		const timer = setInterval(() => {
			setElapsed(Math.floor((Date.now() - startTime) / 1000))
		}, 1000)
		return () => clearInterval(timer)
	}, [isActive, startTime])

	const chosenVerb = verb ?? pickVerb(startTime)
	const frame = SPINNER_FRAMES[frameIndex]

	const tokensSuffix = tokensOut && tokensOut > 0 ? ` · ↓ ${formatNumber(tokensOut)} tokens` : ""

	return (
		<Box>
			<Text color={theme.brand}>{frame}</Text>
			<Text> {chosenVerb}…</Text>
			<Text dimColor color={theme.secondaryText}>
				{` (esc to interrupt · ${elapsed}s${tokensSuffix})`}
			</Text>
		</Box>
	)
}

export default memo(Spinner)
