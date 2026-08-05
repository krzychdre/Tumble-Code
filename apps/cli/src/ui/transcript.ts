import type { TUIMessage } from "./types.js"

/**
 * Promotion rule for the static scrollback (plan §3).
 *
 * Returns how many leading messages from `messages` should be promoted into
 * ink's `<Static>` region — i.e. printed once into native terminal scrollback
 * and never re-rendered.
 *
 * Rules (applied in order):
 *  1. Start with all messages.
 *  2. While the agent is loading or waiting on a pending ask, hold back the
 *     trailing message — it may still receive in-place updates (finalization
 *     streaming, or the ask answer being recorded).
 *  3. Anything from the first `partial` (streaming) message onward stays
 *     dynamic, so the streaming tail never gets baked into scrollback.
 *
 * The result is clamped to `[0, messages.length]`.
 */
export function getStaticCount(messages: TUIMessage[], isLoading: boolean, hasPendingAsk: boolean): number {
	let count = messages.length
	// trailing message may still receive in-place updates (finalization, ask answer)
	if ((isLoading || hasPendingAsk) && count > 0) count -= 1
	// anything from the first streaming message onward stays dynamic
	const firstPartial = messages.findIndex((m) => m.partial === true)
	if (firstPartial !== -1) count = Math.min(count, firstPartial)
	return count
}

/**
 * Convenience wrapper: returns the promoted prefix slice of `messages`.
 * Useful when a caller needs both the count and the slice without slicing
 * twice. `getStaticCount` remains the canonical export.
 */
export function getStaticMessages(messages: TUIMessage[], isLoading: boolean, hasPendingAsk: boolean): TUIMessage[] {
	const count = getStaticCount(messages, isLoading, hasPendingAsk)
	return messages.slice(0, Math.max(0, count))
}
