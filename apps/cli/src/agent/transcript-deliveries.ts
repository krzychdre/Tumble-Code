/**
 * Transcript deliveries: the first stage of reading the extension's messages
 * (D11, one event stream in the CLI).
 *
 * The CLI view never takes the single-message post, so the core delivers
 * every NEW message as a "state" push carrying the WHOLE clineMessages array,
 * and every change of an existing message (a partial growing, a partial
 * finalized in place, a price written into api_req_started) as a
 * "messageUpdated" carrying that one message. Every push therefore delivers
 * every old message again.
 *
 * Two readers are built on this stage:
 *
 * - `deliveriesOf` walks a push or an update into one delivery per message,
 *   in order, the last one of the push marked. The transcript reducer's rows
 *   stage (the TUI and print mode) reads it; its rules decide per message with
 *   the transcript it shows (whether a row exists and is still partial, whether
 *   a turn is running), and some of them need the replays too (see
 *   `reduceSay`), so it gets every delivery.
 * - `DeliveryReader` keeps what each ts looked like when it was last
 *   delivered and hands out only the news: a message the first time it
 *   arrives, and again only when it changed. It also marks a resumed task's
 *   history, which arrives as news but happened before this run. The client
 *   publishes its output as the `delivery` event; the JSON output reads it
 *   (with the message's ts as the event id, its protocol) and so does the
 *   `--exit-on-error` hook. It also keeps the transcript itself (the
 *   client's copy of the task's messages): the agent loop state is read from
 *   it, and so is the JSON result's cost.
 *
 * Before this stage those two read only the LAST message of each push, so a
 * message that was not the last one of the push that brought it, and was never
 * updated afterwards, was never seen, and a resumed task emitted whatever
 * message happened to end its history.
 */

import type { ClineMessage, ExtensionMessage } from "@roo-code/types"

/** One message as the extension delivered it. */
export interface Delivery {
	readonly message: ClineMessage
	/** The message is the last one of the transcript it arrived in (always true for messageUpdated). */
	readonly isLast: boolean
	/** It arrived as a messageUpdated, not in a state push. */
	readonly update: boolean
}

/** A delivery that is news: its message is new, or changed since it was last delivered. */
export interface MessageDelivery extends Delivery {
	/**
	 * It belongs to a resumed task's history: it happened before this run and
	 * is shown by nobody who only follows what the task does now.
	 */
	readonly history: boolean
}

/** Every message a state push or a messageUpdated carries, in order. */
export function deliveriesOf(message: ExtensionMessage): Delivery[] {
	if (message.type === "state") {
		const messages = message.state?.clineMessages ?? []

		return messages.map((clineMessage, index) => ({
			message: clineMessage,
			isLast: index === messages.length - 1,
			update: false,
		}))
	}

	if (message.type === "messageUpdated" && message.clineMessage) {
		return [{ message: message.clineMessage, isLast: true, update: true }]
	}

	return []
}

/**
 * What a delivery can change in place, as consumers read it: the text (a
 * stream growing, a price in api_req_started), the partial flag, the
 * reasoning, and a condensing cost (not in the text).
 */
interface DeliveredContent {
	text: string | undefined
	partial: boolean
	reasoning: string | undefined
	condenseCost: number | undefined
}

function contentOf(message: ClineMessage): DeliveredContent {
	return {
		text: message.text,
		partial: message.partial === true,
		reasoning: message.reasoning,
		condenseCost: message.contextCondense?.cost,
	}
}

function sameContent(a: DeliveredContent, b: DeliveredContent): boolean {
	return (
		a.text === b.text && a.partial === b.partial && a.reasoning === b.reasoning && a.condenseCost === b.condenseCost
	)
}

function isResumeAsk(message: ClineMessage): boolean {
	return (
		message.type === "ask" &&
		message.partial !== true &&
		(message.ask === "resume_task" || message.ask === "resume_completed_task")
	)
}

/** The transcript with one updated message: replaced in place by ts, or appended if it is new. */
function withUpdate(transcript: ClineMessage[], message: ClineMessage): ClineMessage[] {
	const index = transcript.findIndex((m) => m.ts === message.ts)
	return index === -1 ? [...transcript, message] : transcript.map((m, i) => (i === index ? message : m))
}

export class DeliveryReader {
	/** What each ts of the current transcript looked like when it was last delivered. */
	private delivered = new Map<number, DeliveredContent>()
	private historyReplay = false
	/**
	 * The current transcript: the last push's array, a messageUpdated
	 * replacing its message in place (by ts) or appending a ts it does not
	 * have. Undefined until the first push or update.
	 */
	private current: ClineMessage[] | undefined

	/** The current transcript (empty before anything arrived). */
	get transcript(): ClineMessage[] {
		return this.current ?? []
	}

	/** Whether a push or an update has arrived (a transcript exists, possibly empty). */
	get hasTranscript(): boolean {
		return this.current !== undefined
	}

	/**
	 * A task is being resumed: what arrives from now on up to and including
	 * the push that ends with its resume ask is the task's history.
	 */
	beginHistoryReplay(): void {
		this.historyReplay = true
	}

	/** Forget everything (the client starts from scratch). */
	reset(): void {
		this.delivered = new Map()
		this.historyReplay = false
		this.current = undefined
	}

	/** The news in one extension message, in order. */
	read(message: ExtensionMessage): MessageDelivery[] {
		const deliveries = deliveriesOf(message)
		// A push carries the whole transcript (an empty one too, once a task is
		// cleared): remember exactly its messages, so a message that left it (a
		// new task, a deleted request) is not remembered forever.
		const isPush = message.type === "state" && Array.isArray(message.state?.clineMessages)

		if (!isPush && deliveries.length === 0) {
			return []
		}

		const previous = this.delivered
		const next = isPush ? new Map<number, DeliveredContent>() : previous
		const history = this.historyReplay
		const news: MessageDelivery[] = []

		for (const delivery of deliveries) {
			const content = contentOf(delivery.message)
			const before = previous.get(delivery.message.ts)
			next.set(delivery.message.ts, content)

			if (before && sameContent(before, content)) {
				continue
			}

			news.push({ ...delivery, history })
		}

		this.delivered = next
		this.current = isPush
			? (message.state?.clineMessages ?? [])
			: withUpdate(this.transcript, deliveries[0]!.message)

		// The resumed task asks its resume ask once its history is loaded; the
		// push that ends with it closes the history (the ask included: it only
		// asks whether to go on). A stale resume ask at the end of the history
		// push closes it too, which is right: everything older is in that push.
		const last = deliveries[deliveries.length - 1]

		if (history && isPush && last && isResumeAsk(last.message)) {
			this.historyReplay = false
		}

		return news
	}
}
