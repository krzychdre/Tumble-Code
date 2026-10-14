/** Fenced code blocks (``` or ~~~, closed or running to the end) and inline code spans. */
const MARKDOWN_CODE = /(`{3,}[\s\S]*?(?:`{3,}|$)|~{3,}[\s\S]*?(?:~{3,}|$)|`[^`\n]+`)/

/** A run of literal `\uXXXX` escapes whose backslash is not itself escaped. */
const ESCAPE_RUN = /(?<!\\)(?:\\u[0-9a-fA-F]{4})+/g

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

function decodeRun(run: string): string {
	let out = ""
	// Hex of a high surrogate waiting for its low half.
	let pendingHigh: string | undefined
	for (const hex of run.split("\\u").slice(1)) {
		const unit = parseInt(hex, 16)
		if (pendingHigh !== undefined) {
			if (isLowSurrogate(unit)) {
				out += String.fromCharCode(parseInt(pendingHigh, 16), unit)
				pendingHigh = undefined
				continue
			}
			out += `\\u${pendingHigh}`
			pendingHigh = undefined
		}
		if (isHighSurrogate(unit)) {
			pendingHigh = hex
			continue
		}
		// ASCII (\u0022, \u005c) and lone surrogates stay as written: a model does not
		// produce them for prose, and decoding them could change the meaning.
		out += unit < 0x80 || isLowSurrogate(unit) ? `\\u${hex}` : String.fromCharCode(unit)
	}
	return pendingHigh === undefined ? out : `${out}\\u${pendingHigh}`
}

/**
 * Turns literal `\uXXXX` text (a backslash, `u` and four hex digits, as left after
 * JSON parsing when a model escaped the backslash of an escape) back into the
 * character, for code points outside ASCII only. Markdown code (fenced blocks and
 * inline spans) is left as written, so an example such as `"\u0142"` survives.
 *
 * Meant for prose a person reads (a completion summary, a question, a todo list),
 * never for file content or commands, where an escape may be intended.
 */
export function decodeLiteralUnicodeEscapes(text: string): string {
	if (!text.includes("\\u")) {
		return text
	}
	return text
		.split(MARKDOWN_CODE)
		.map((part, index) => (index % 2 === 1 ? part : part.replace(ESCAPE_RUN, decodeRun)))
		.join("")
}
