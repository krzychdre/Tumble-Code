/**
 * Display formatting of streamed reasoning (API P3).
 *
 * Reasoning models often run a section title into the previous sentence
 * ("...end of sentence.**Title Here**"). The chat shows it with a blank line
 * before the title.
 */

/** Section titles glued to a sentence end: `.`, `!` or `?`, then `**Title**` on the same line. */
const GLUED_TITLE = /([.!?])\*\*([^*\n]+)\*\*/g

/** Puts a blank line before every bold title that directly follows a sentence end. */
export function formatReasoningText(text: string): string {
	return text.includes("**") ? text.replace(GLUED_TITLE, "$1\n\n**$2**") : text
}

/**
 * Formats reasoning as it streams, with the same result as
 * {@link formatReasoningText} over the whole text after every chunk.
 *
 * Before API P3 the whole accumulated text was formatted on every chunk, which
 * is quadratic in the reasoning length (a 74 KB reasoning, the 99th percentile
 * of local tasks, in 4-character chunks scanned about 690 million characters).
 * A title never spans a line break, so each finished line is formatted once and
 * only the open last line is formatted per chunk.
 */
export class IncrementalReasoningFormatter {
	private text = ""
	/** Formatted form of `text` up to and including its last line break. */
	private formattedLines = ""
	/** Length of the part of `text` that `formattedLines` covers. */
	private linesEnd = 0
	private scanned = 0

	/** Characters handed to the formatter so far (a work measure for tests and profiling). */
	get scannedCharacters(): number {
		return this.scanned
	}

	/** Appends a chunk and returns the formatted reasoning so far. */
	append(chunk: string): string {
		this.text += chunk

		// Only the new chunk can hold a new line break.
		const breakInChunk = chunk.lastIndexOf("\n")
		if (breakInChunk !== -1) {
			const lastBreak = this.text.length - chunk.length + breakInChunk
			const finishedLines = this.text.slice(this.linesEnd, lastBreak + 1)
			this.scanned += finishedLines.length
			this.formattedLines += formatReasoningText(finishedLines)
			this.linesEnd = lastBreak + 1
		}

		const openLine = this.text.slice(this.linesEnd)
		this.scanned += openLine.length
		return this.formattedLines + formatReasoningText(openLine)
	}

	/** Forgets everything (a new API request starts a new reasoning message). */
	reset(): void {
		this.text = ""
		this.formattedLines = ""
		this.linesEnd = 0
		this.scanned = 0
	}
}
