/**
 * Print mode's side of the transcript reader (D11: one event stream in the CLI).
 *
 * Print mode used to read the extension's messages a second time, in its own
 * way (the old OutputManager.outputMessage): only the last message of each
 * state push, deduplicated by ts, with its own prompt echo rule. The TUI
 * already reads them through the transcript reducer, which knows the core's
 * delivery quirks: a restarted stream arrives as a NEW partial under a new
 * ts, every state push replays the whole array, one command's output can be
 * split over two ts, and a model can repeat its answer inside
 * completion_result. This sink lets print mode take the same reading: the
 * reducer decides which rows exist, and the printer only writes their text.
 *
 * What it writes, row by row (the labels and line breaks print mode always
 * had):
 * - answer, completion text and reasoning rows, and command output, are
 *   streamed: a header and the text so far when the row first appears, then
 *   only what was appended, and a line break when the row is final;
 * - an error row is written to stderr once;
 * - the completion ask row writes `[task complete]` (with its text when no
 *   completion text was printed before it);
 * - everything else (tool rows, MCP responses, auto-approved asks) is left to
 *   the ask dispatcher, which prints asks as it answers them.
 *
 * The output cannot be rewritten once written, so a row that changes while
 * it is not the one at the end of the output is started again below (header
 * and its whole text), never appended in the wrong place.
 */

import type { TodoItem } from "@tumble-code/types"

import type { TUIMessage } from "../ui/types.js"

import type { OutputManager } from "./output-manager.js"
import type { TranscriptSink } from "./transcript-reader.js"
import { applyAddMessage, type TranscriptEffect, type TranscriptView } from "./transcript-reducer.js"

/** The header of a streamed row, or undefined when print mode does not stream the row. */
function streamHeaderOf(row: TUIMessage): string | undefined {
	switch (row.originalType) {
		case "text":
		case "completion_result":
			return row.role === "assistant" ? "[assistant]" : undefined
		case "reasoning":
			return "[reasoning]"
		case "command_output":
			return "[command output]"
		default:
			return undefined
	}
}

/** The completion ask's own text (the reducer keeps it as the row content, or in toolData when it is not JSON). */
function completionAskText(row: TUIMessage): string {
	try {
		JSON.parse(row.content)
		return row.content
	} catch {
		return row.toolData?.content ?? ""
	}
}

interface PrintedRow {
	/** The row's text as it stands in the output. */
	text: string
	/** The row was finished (final text and line break written); nothing more is written for it. */
	final: boolean
}

export class TranscriptPrinter implements TranscriptSink {
	private messages: readonly TUIMessage[] = []
	private currentTodos: readonly TodoItem[] = []
	private printed = new Map<string, PrintedRow>()
	/** The row whose text ends the output, so its growth can be appended in place. */
	private streamingId: string | null = null
	/** Completion text was printed, so `[task complete]` does not repeat it. */
	private completionTextPrinted = false
	/** A resumed task's history is being loaded; it is not printed again. */
	private replayingHistory = false

	constructor(
		private readonly out: OutputManager,
		private readonly isNonInteractive: () => boolean,
	) {}

	/**
	 * Print mode is always inside a turn: nothing it wrote can be taken back,
	 * so the reducer may route a restarted stream or a split command output to
	 * the row that already carries it at any time (the printer writes such a
	 * row again below when it is no longer at the end of the output).
	 */
	view(): TranscriptView {
		return { messages: this.messages, isLoading: true, isResumingTask: false, currentTodos: this.currentTodos }
	}

	nonInteractive(): boolean {
		return this.isNonInteractive()
	}

	/**
	 * The next messages are a resumed task's history: take them in without
	 * printing until the core asks to resume (the reducer's `setHasStartedTask`).
	 * The reducer still reads them, so the old prompt counts as the prompt echo
	 * and the old rows as seen.
	 */
	beginHistoryReplay(): void {
		this.replayingHistory = true
	}

	apply(effects: readonly TranscriptEffect[]): void {
		for (const effect of effects) {
			switch (effect.type) {
				case "addMessage": {
					this.messages = applyAddMessage(this.messages, effect.message)

					if (!this.replayingHistory) {
						this.print(this.messages.find((m) => m.id === effect.message.id) ?? effect.message)
					}
					break
				}
				case "setTodos":
					this.currentTodos = effect.todos
					break
				case "setHasStartedTask":
					this.replayingHistory = false
					break
			}
		}
	}

	private print(row: TUIMessage): void {
		if (row.originalType === "error" && row.role === "assistant") {
			if (!this.printed.has(row.id)) {
				this.out.outputError("\n[error]", row.content || "Unknown error")
				this.printed.set(row.id, { text: row.content, final: true })
			}
			return
		}

		if (row.toolName === "attempt_completion" && row.originalType === "completion_result") {
			if (!this.printed.has(row.id)) {
				this.out.output("\n[task complete]", this.completionTextPrinted ? undefined : completionAskText(row))
				this.printed.set(row.id, { text: row.content, final: true })
			}
			return
		}

		const header = streamHeaderOf(row)

		if (header) {
			this.printStreamed(row, header)
		}
	}

	private printStreamed(row: TUIMessage, header: string): void {
		const text = row.content
		const partial = row.partial === true
		const previous = this.printed.get(row.id)

		if (!text || previous?.final) {
			return
		}

		if (row.originalType === "completion_result") {
			this.completionTextPrinted = true
		}

		if (previous && this.streamingId === row.id) {
			// The row ends the output: append what grew, then end the line.
			if (text.length > previous.text.length && text.startsWith(previous.text)) {
				this.out.writeRaw(text.slice(previous.text.length))
				previous.text = text
			}

			if (!partial) {
				this.out.writeRaw("\n")
				this.streamingId = null
				previous.final = true
			}
			return
		}

		if (previous && previous.text.startsWith(text)) {
			// Nothing new for a row written further up (a replayed or older
			// delivery); a finalization only closes it.
			previous.final = !partial
			return
		}

		// A row seen for the first time, or one that grew while another row
		// ended the output: write it (again) below, whole.
		if (partial) {
			this.out.writeRaw(`\n${header} ${text}`)
			this.streamingId = row.id
		} else if (row.originalType === "command_output") {
			this.out.writeRaw(`\n${header} ${text}\n`)
		} else {
			this.out.output(`\n${header}`, text)
		}

		this.printed.set(row.id, { text, final: !partial })
	}
}
