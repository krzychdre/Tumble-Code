import type { TUIMessage } from "./types.js"
import type { WelcomeBannerProps } from "./components/WelcomeBanner.js"

/**
 * Promotion rule for the static scrollback (plan §3).
 *
 * Returns how many leading messages from `messages` should be promoted into
 * ink's `<Static>` region — i.e. printed once into native terminal scrollback
 * and never re-rendered.
 *
 * Rules (applied in order):
 *  1. Start with all messages.
 *  2. When the agent is idle (not loading and no pending ask) nothing can send
 *     another update, so promote everything and ignore the `partial` flags
 *     entirely. See the idle safety net below.
 *  3. While the agent is loading or waiting on a pending ask, hold back the
 *     trailing message, because it may still receive in-place updates
 *     (finalization streaming, or the ask answer being recorded).
 *  4. While loading or waiting on an ask, anything from the first `partial`
 *     (streaming) message onward stays dynamic, so the streaming tail never
 *     gets baked into scrollback.
 *
 * Idle safety net (rule 2): a message can stay flagged `partial` forever when
 * its finalization never arrives, for example after Escape cancels the task mid
 * stream, when a resumed task replays an aborted partial from history, or when
 * the core appends a new message instead of finalizing the old one in place.
 * Without rule 2 that one stuck flag would pin every later message of the
 * session in the height-clamped dynamic tail, which is exactly the "answer
 * collapsed behind `… +N lines`" failure this rule exists to prevent. Nothing
 * is lost by promoting while idle, because `setLoading(false)` first flushes
 * the debounced partial queue (`flushPendingStreamUpdates` in `store.ts`), so
 * the promoted text is the latest text the CLI ever received.
 *
 * The result is clamped to `[0, messages.length]`.
 */
export function getStaticCount(messages: TUIMessage[], isLoading: boolean, hasPendingAsk: boolean): number {
	let count = messages.length
	// idle: no stream and no ask can touch any message any more, promote all of them
	if (!isLoading && !hasPendingAsk) return count
	// trailing message may still receive in-place updates (finalization, ask answer)
	if (count > 0) count -= 1
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

/**
 * Discriminated item type for the `<Static>` region.
 *
 * The welcome banner and the reprint divider are synthetic items so they print
 * once into native scrollback and scroll away naturally as the conversation
 * grows. Message items delegate to `ChatHistoryItem`.
 */
export type StaticItem =
	| { id: string; kind: "welcome"; welcomeProps: WelcomeBannerProps }
	| { id: string; kind: "divider"; label: string }
	| { id: string; kind: "message"; message: TUIMessage; expanded: boolean }

interface BuildStaticItemsArgs {
	/** The promoted prefix of the transcript (see `getStaticMessages`). */
	messages: TUIMessage[]
	welcomeProps: WelcomeBannerProps
	/** Verbose rendering for every message item in this batch. */
	expanded: boolean
	/** `useUIStateStore.transcriptReprintEpoch`; 0 is the original printing. */
	reprintEpoch: number
}

/**
 * Build the `<Static>` item list.
 *
 * Epoch 0 is the original printing and opens with the welcome banner. Every
 * later epoch is a reprint triggered by ctrl+o, so it opens with a divider
 * instead: the banner already sits in scrollback above and repeating it would
 * read as a second session start. The divider id carries the epoch so React
 * keys stay unique across reprints.
 *
 * The divider stays for an epoch even after verbose is switched back off,
 * because it describes a batch that is already in scrollback and `<Static>`
 * never rewrites what it printed (I2).
 */
export function buildStaticItems({
	messages,
	welcomeProps,
	expanded,
	reprintEpoch,
}: BuildStaticItemsArgs): StaticItem[] {
	const head: StaticItem =
		reprintEpoch > 0
			? {
					id: `__divider__:${reprintEpoch}`,
					kind: "divider",
					// Hyphens only, deliberately: no dash characters beyond "-".
					label: "-- expanded transcript (ctrl+o to collapse) --",
				}
			: { id: "__welcome__", kind: "welcome", welcomeProps }

	return [head, ...messages.map((message): StaticItem => ({ id: message.id, kind: "message", message, expanded }))]
}
