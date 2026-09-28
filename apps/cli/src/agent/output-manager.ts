/**
 * OutputManager: the lines print mode writes to the terminal.
 *
 * It only writes. Which messages print mode shows, and when, is read by the
 * transcript reducer and printed by `TranscriptPrinter` (transcript-printer.ts);
 * the ask dispatcher and the host use the same writer for their own lines
 * (approval prompts, MCP failures). Disabled for the TUI, where ink owns the
 * terminal, and for JSON output.
 */

export interface OutputManagerOptions {
	/** When true, nothing is written (TUI and JSON output). */
	disabled?: boolean

	/** Stream for normal output (default: process.stdout). */
	stdout?: NodeJS.WriteStream

	/** Stream for error output (default: process.stderr). */
	stderr?: NodeJS.WriteStream
}

export class OutputManager {
	private disabled: boolean
	private stdout: NodeJS.WriteStream
	private stderr: NodeJS.WriteStream

	constructor(options: OutputManagerOptions = {}) {
		this.disabled = options.disabled ?? false
		this.stdout = options.stdout ?? process.stdout
		this.stderr = options.stderr ?? process.stderr
	}

	/** Write a line: the label, then the text after a space when there is one. */
	output(label: string, text?: string): void {
		if (this.disabled) return
		this.stdout.write(text ? `${label} ${text}\n` : `${label}\n`)
	}

	/** Write a line to stderr, formatted like `output`. */
	outputError(label: string, text?: string): void {
		if (this.disabled) return
		this.stderr.write(text ? `${label} ${text}\n` : `${label}\n`)
	}

	/** Write text as is (the pieces of a stream). */
	writeRaw(text: string): void {
		if (this.disabled) return
		this.stdout.write(text)
	}
}
