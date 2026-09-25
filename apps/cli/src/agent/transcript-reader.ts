/**
 * Transcript reader: the one place that reads extension messages into
 * transcript rows (CLI-9 step 3).
 *
 * It owns the reducer's bookkeeping (`TranscriptCursor`) and runs
 * `reduceExtensionMessage` on every message it is fed. What it produces goes
 * to a single sink, the consumer that shows the transcript (the TUI store):
 * the sink supplies the transcript as it is shown now and applies the
 * resulting changes. The reducer's answers depend on that view (which rows
 * exist, whether a turn is running), so one reader serves one sink.
 *
 * Without a sink the reader does nothing, so print and JSON runs pay nothing.
 */

import type { ExtensionMessage } from "@roo-code/types"

import {
	createTranscriptCursor,
	reduceExtensionMessage,
	resetTranscriptCursor,
	type TranscriptCursor,
	type TranscriptEffect,
	type TranscriptView,
} from "./transcript-reducer.js"

export interface TranscriptSink {
	/** The transcript as it is shown right now. */
	view(): TranscriptView
	/** Whether actions are auto-approved right now (it can change at runtime). */
	nonInteractive(): boolean
	/** Apply the changes of one message, in order. */
	apply(effects: readonly TranscriptEffect[]): void
}

export class TranscriptReader {
	private cursor: TranscriptCursor = createTranscriptCursor()
	private sink: TranscriptSink | undefined

	/** Send the transcript of every following message to `sink`; returns the detach function. */
	attach(sink: TranscriptSink): () => void {
		this.sink = sink

		return () => {
			if (this.sink === sink) {
				this.sink = undefined
			}
		}
	}

	handleMessage(message: ExtensionMessage): void {
		const sink = this.sink

		if (!sink) {
			return
		}

		const result = reduceExtensionMessage(this.cursor, sink.view(), message, {
			nonInteractive: sink.nonInteractive(),
		})

		this.cursor = result.cursor

		if (result.effects.length > 0) {
			sink.apply(result.effects)
		}
	}

	/** Forget the current task (/new, /clear, switching to another task). */
	reset(): void {
		this.cursor = resetTranscriptCursor()
	}
}
