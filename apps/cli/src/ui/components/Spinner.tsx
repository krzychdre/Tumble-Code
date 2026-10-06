import { memo, useEffect, useRef, useState } from "react"
import { Box, Text } from "ink"

import { SPINNER_FRAMES } from "../figures.js"
import { pickSound } from "../spinnerSounds.js"
import * as theme from "../theme.js"

/**
 * Formats a number with K (thousands) or M (millions) suffix, e.g. 1234 -> "1.2K".
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
 * Whole seconds as a short duration: `42s`, `16m 16s`, `1h 05m`. A bare count
 * stops being readable past a minute (`976s`), and hours drop the seconds so
 * the line does not grow for a digit nobody reads at that scale.
 */
export function formatElapsed(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	if (seconds < 60) {
		return `${seconds}s`
	}
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
	}
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** ` · ↑ 120.4K ↓ ~3.2K tokens`, or nothing before the first token. */
export function formatTokens({
	tokensIn = 0,
	tokensOut = 0,
	liveTokensOut = 0,
}: {
	tokensIn?: number
	tokensOut?: number
	liveTokensOut?: number
}): string {
	const parts: string[] = []
	if (tokensIn > 0) {
		parts.push(`↑ ${formatNumber(tokensIn)}`)
	}
	const received = tokensOut + liveTokensOut
	if (received > 0) {
		parts.push(`↓ ${liveTokensOut > 0 ? "~" : ""}${formatNumber(received)}`)
	}
	return parts.length > 0 ? ` · ${parts.join(" ")} tokens` : ""
}

interface Props {
	/** When the turn began: the whole time the agent has been working since the user handed it over. */
	startTime: number
	/** When the current step began (the latest request to the model); defaults to startTime. */
	stepStartTime?: number
	/** Input tokens of the task so far, as the server reported them. */
	tokensIn?: number
	/** Output tokens of the task so far, as the server reported them. */
	tokensOut?: number
	/** Estimated output tokens of the request still streaming, not yet in tokensOut. */
	liveTokensOut?: number
	sound?: string
	isActive?: boolean
}

/**
 * Loading spinner: brand-colored droplet animation cycling forward through
 * the spinner frames at ~120ms (a drop falls, ripples, fades — direction
 * matters, so no ping-pong), a sound picked deterministically from the
 * loading-start timestamp, and a faint suffix with the time of the whole turn,
 * the time of the current step and the tokens sent (↑) and received (↓). The
 * received count of a request still streaming is an estimate, marked `~`,
 * until the server reports the real one at its end. The token counts follow
 * the once-a-second clock rather than every streamed chunk. Frames stop when
 * isActive is false (e.g. when a dialog steals the frame).
 */
function Spinner({
	startTime,
	stepStartTime = startTime,
	tokensIn,
	tokensOut,
	liveTokensOut,
	sound,
	isActive = true,
}: Props) {
	const [frameIndex, setFrameIndex] = useState(0)
	const [now, setNow] = useState(() => Date.now())
	const latestTokens = useRef({ tokensIn, tokensOut, liveTokensOut })
	const [shownTokens, setShownTokens] = useState(latestTokens.current)

	useEffect(() => {
		latestTokens.current = { tokensIn, tokensOut, liveTokensOut }
	}, [tokensIn, tokensOut, liveTokensOut])

	useEffect(() => {
		if (!isActive) {
			return
		}
		const timer = setInterval(() => {
			// Forward cycle — the droplet animation is directional.
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, 120)
		return () => clearInterval(timer)
	}, [isActive])

	useEffect(() => {
		if (!isActive) {
			return
		}
		// One clock for both timers and the token counts, so they always tick together.
		const timer = setInterval(() => {
			setNow(Date.now())
			setShownTokens(latestTokens.current)
		}, 1000)
		return () => clearInterval(timer)
	}, [isActive])

	const chosenSound = sound ?? pickSound(startTime)
	const frame = SPINNER_FRAMES[frameIndex]

	const total = formatElapsed((now - startTime) / 1000)
	const step = formatElapsed((now - stepStartTime) / 1000)
	const tokensSuffix = formatTokens(shownTokens)

	return (
		<Box>
			<Text color={theme.brand}>{frame}</Text>
			<Text> {chosenSound}…</Text>
			<Text color={theme.faint}>{` (esc to interrupt · total ${total} · step ${step}${tokensSuffix})`}</Text>
		</Box>
	)
}

export default memo(Spinner)
