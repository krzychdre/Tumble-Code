/**
 * @fileoverview Transport that writes log entries as readable lines to an output channel
 */

import { CompactLogEntry, ICompactTransport, LOG_LEVELS, LogLevel } from "./types"

/** Serializes metadata on one line; logging must never throw because of what it was given. */
function formatData(data: unknown): string {
	try {
		return JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? `${value}n` : value))
	} catch {
		return "[unserializable metadata]"
	}
}

/**
 * Writes one line per entry, for example
 * `2026-09-24T14:05:31.123Z [warn] [bedrock] Request throttled {"retryAfter":2}`,
 * dropping entries below `level`. An error's stack follows on its own lines.
 *
 * It takes the channel's `appendLine` rather than the channel itself so this
 * module stays free of the `vscode` API (the CLI and the tests use it too).
 */
export class OutputChannelTransport implements ICompactTransport {
	private readonly minimumIndex: number

	constructor(
		private readonly appendLine: (line: string) => void,
		level: LogLevel = "info",
	) {
		this.minimumIndex = LOG_LEVELS.indexOf(level)
	}

	write(entry: CompactLogEntry): void {
		if (LOG_LEVELS.indexOf(entry.l as LogLevel) < this.minimumIndex) {
			return
		}

		const context = entry.c ? ` [${entry.c}]` : ""
		let stack: string | undefined
		let data = entry.d

		if (data && typeof data === "object" && "error" in data) {
			const { error, ...rest } = data as { error?: { stack?: string } }
			stack = error?.stack
			data = Object.keys(rest).length > 0 ? rest : undefined
		}

		const details = data === undefined ? "" : ` ${formatData(data)}`
		this.appendLine(`${new Date(entry.t).toISOString()} [${entry.l}]${context} ${entry.m}${details}`)

		if (stack) {
			this.appendLine(stack)
		}
	}

	close(): void {
		// The channel belongs to the extension, which disposes it.
	}
}
