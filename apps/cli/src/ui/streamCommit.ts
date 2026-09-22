/**
 * Streaming an answer into scrollback line by line (plan: 2026-09-22 cli
 * stream answer into scrollback).
 *
 * While a message streams it lives in the dynamic tail, which is clamped to a
 * few rows so the tail never outgrows the terminal. Holding the whole answer
 * there meant the user watched its last line fill up, slide up and vanish,
 * and only saw the text once the message completed. Instead, every line the
 * model has finished (followed by a newline) is printed into `<Static>` right
 * away, as a chunk; the tail only keeps the line still being written. When
 * the message is finally promoted, only what follows the chunks is printed.
 *
 * Chunks are append-only, like everything else in `<Static>`: ink prints an
 * item once and can never take it back.
 */

import type { TUIMessage } from "./types.js"

export interface StreamCommit {
	/** Texts already printed, in order. Joined with "\n" they are the committed prefix. */
	chunks: string[]
	/** Number of complete lines the chunks cover. */
	lines: number
}

/** Message id -> what has been printed of it so far. */
export type StreamCommits = Record<string, StreamCommit>

const FENCE_RE = /^\s*(```|~~~)/

/**
 * How many leading lines of `content` can be printed for good: the complete
 * ones (the last line is still being written), cut before a fenced code block
 * that is not closed yet, because `Markdown` renders a fence as one block and
 * a block split across two chunks would lose its code styling.
 */
export function committableLines(content: string): number {
	const lines = content.split("\n")
	const complete = lines.length - 1
	let openFence: { marker: string; index: number } | null = null

	for (let i = 0; i < complete; i++) {
		const match = (lines[i] ?? "").match(FENCE_RE)
		if (!match) {
			continue
		}
		const marker = match[1] ?? "```"
		if (!openFence) {
			openFence = { marker, index: i }
		} else if (marker === openFence.marker) {
			openFence = null
		}
	}

	return openFence ? openFence.index : complete
}

/** The committed prefix as one string (without its trailing newline). */
export function committedText(commit: StreamCommit): string {
	return commit.chunks.join("\n")
}

/**
 * What is left of `content` after the committed prefix, or `null` when the
 * content no longer starts with it. The core only ever appends to a streaming
 * message, so `null` means something rewrote it; the caller then prints the
 * message in full, because repeating text is better than losing it.
 */
export function remainderAfterCommit(content: string, commit: StreamCommit): string | null {
	if (commit.lines === 0) {
		return content
	}
	const prefix = `${committedText(commit)}\n`
	return content.startsWith(prefix) ? content.slice(prefix.length) : null
}

/**
 * The next commit for a streaming message, or `undefined` when there is
 * nothing new to print (no new complete line, or the content diverged from
 * what was printed).
 */
export function advanceStreamCommit(content: string, commit: StreamCommit | undefined): StreamCommit | undefined {
	const previous = commit ?? { chunks: [], lines: 0 }
	const target = committableLines(content)
	if (target <= previous.lines || remainderAfterCommit(content, previous) === null) {
		return undefined
	}

	const chunk = content.split("\n").slice(previous.lines, target).join("\n")
	return { chunks: [...previous.chunks, chunk], lines: target }
}

/**
 * The two roles the first message of the dynamic tail can play:
 *
 * - `streaming`: an assistant message still streaming, whose finished lines
 *   may be printed now. Only the first message of the tail qualifies:
 *   everything above it is already printed, so its lines can follow without
 *   breaking the order of the transcript.
 * - `committed`: a message part of which is already printed. Keyed on the
 *   commit, not on `partial`: between its finalization and its promotion (the
 *   trailing message is held back while loading) the message is no longer
 *   partial, and dropping its chunks from the `<Static>` item list for that
 *   window would make ink print them a second time on promotion.
 */
export function tailHeads(
	tailHead: TUIMessage | undefined,
	commits: StreamCommits,
): { streaming?: TUIMessage; committed?: TUIMessage } {
	return {
		streaming: tailHead?.role === "assistant" && tailHead.partial === true ? tailHead : undefined,
		committed: tailHead && commits[tailHead.id] ? tailHead : undefined,
	}
}
