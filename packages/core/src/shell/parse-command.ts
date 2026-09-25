import { scanShellCommand, type ScannedCommand } from "./shell-command-scanner.js"

/**
 * The style of quoting that opened a region.
 *
 * - `posix-single` and `ansi-c` share the `'` delimiter but follow different
 *   escaping rules, so they must be distinguished.
 * - `locale` and `double` share the `"` delimiter but `locale` is prefixed with
 *   `$` (like ANSI-C), making `$"..."` a distinct token for accurate restoration.
 * - `heredoc` covers `<<WORD`, `<<'WORD'`, `<<"WORD"`, and `<<\WORD` openers
 *   whose body extends through the terminator line.
 */
export type QuoteType = "posix-single" | "ansi-c" | "double" | "locale" | "heredoc"

/**
 * The result of parsing a command string.
 *
 * `commands` is the list of individual sub-commands produced by splitting on
 * unquoted newlines and chain operators. When `parseError` is non-null the
 * command string is syntactically malformed (e.g. an unterminated quote) and
 * `commands` contains the raw input as a single opaque token so callers can
 * surface the error without splitting unsafe fragments.
 *
 * Callers that only need the sub-command list can destructure `{ commands }`.
 * Callers that need to distinguish a parse error from a normal single-command
 * result should also inspect `parseError`.
 */
export interface ParseResult {
	commands: string[]
	parseError: UnterminatedQuote | null
	/**
	 * Non-null when the command uses syntax the parser cannot split with
	 * certainty (for example a `case` statement or an unmatched `)`). `commands`
	 * is still a best effort, but callers must not auto-approve the command.
	 */
	uncertainty: string | null
}

/** A sub-command prepared for matching against the allow and deny lists. */
export interface AnalyzedCommand {
	/** The command as displayed: its words joined by single spaces, then its heredoc bodies. */
	text: string
	/**
	 * The words bash will see after quote removal, without leading variable
	 * assignments, so `'r'm -rf x` and `FOO=1 rm -rf x` both read `rm -rf x`.
	 * Words whose value is only known after expansion stay as written.
	 */
	matchText: string
	/** False when the command word is quoted, escaped or expanded, so its identity is not proven. */
	commandIsLiteral: boolean
}

export interface CommandAnalysis {
	commands: AnalyzedCommand[]
	parseError: UnterminatedQuote | null
	uncertainty: string | null
}

/**
 * Describes the opening of a quoted region that is never closed.
 *
 * - `quoteType`: the style of the unterminated quote. `"heredoc"` means a
 *   `<<WORD` opener whose terminator line was never found.
 * - `openIndex`: the index in the original command string of the character that
 *   opened the region. For ANSI-C and locale quoting this points at the leading
 *   `$`. For heredocs this points at the first `<`. This position lets a future
 *   caller emit a located error (e.g. "unterminated heredoc near ...") instead
 *   of a generic message.
 */
export interface UnterminatedQuote {
	quoteType: QuoteType
	openIndex: number
	/** Human-readable description suitable for surfacing to an agent as a tool error. */
	message: string
}

/**
 * Build the human-readable error message for an unterminated quote.
 * Includes a short excerpt of the command around the opening delimiter
 * so the agent has enough context to locate and fix the problem.
 */
function unterminatedQuoteMessage(quoteType: QuoteType, openIndex: number, command: string): string {
	const labels: Record<QuoteType, string> = {
		"posix-single": "single quote (')",
		"ansi-c": "ANSI-C quote ($')",
		double: 'double quote (")',
		locale: 'locale quote ($")',
		heredoc: "heredoc (<<)",
	}
	const snippetStart = Math.max(0, openIndex - 10)
	const snippetEnd = Math.min(command.length, openIndex + 20)
	const prefix = snippetStart > 0 ? "..." : ""
	const suffix = snippetEnd < command.length ? "..." : ""
	const excerpt = prefix + command.slice(snippetStart, snippetEnd).replace(/\r?\n/g, "\\n") + suffix
	return `Malformed command: unterminated ${labels[quoteType]} at position ${openIndex} -- near: \`${excerpt}\`. `
}

/**
 * Scan a command string left-to-right with a small state machine and report the
 * first quoted region that is never closed, or `null` when every quoted region
 * is properly terminated.
 *
 * A regex cannot reliably answer "is this command well-quoted?" because quoting
 * is context-sensitive: a backslash escapes the next character outside single
 * quotes, `#` may begin a comment that should be ignored, and an apostrophe
 * inside double quotes (or vice versa) is literal text rather than a delimiter.
 * This walk mirrors how a POSIX shell tokenizes quoting so that legitimate
 * multi-line quoted arguments are accepted while genuinely unterminated quotes
 * (a shell syntax error) are detected.
 *
 * Rules implemented:
 * - Outside any quote, a backslash escapes the following character, so `\'` and
 *   `\"` are literal and do not open a region.
 * - Outside any quote, `#` begins a comment when it is at the start of the input
 *   or preceded by whitespace; the remainder of that line is ignored. A `#` that
 *   is attached to a word (e.g. `foo#bar`) is an ordinary character.
 * - Single quotes are opaque: no escapes apply, and the region ends only at the
 *   next `'`.
 * - Double quotes honor backslash escapes, so `\"` does not close the region.
 * - ANSI-C quoting ($'...') behaves like a single-quoted region for delimiter
 *   purposes but honors backslash escapes, so `\'` does not close it.
 * - Locale quoting ($"...") behaves like double quotes but is opened by `$"` so
 *   the leading `$` is part of the token (same pattern as ANSI-C).
 * - Heredoc (`<<WORD`, `<<'WORD'`, `<<"WORD"`, `<<\WORD`, `<<-WORD`) is a
 *   multi-line quoted region. The body extends from the character after the
 *   opener line's newline through the line that is exactly the terminator word
 *   (after stripping leading tabs for `<<-`). If no terminator line is found the
 *   heredoc is unterminated.
 */
export function findUnterminatedQuote(command: string): UnterminatedQuote | null {
	return scanTopLevelQuotes(command)
}

/**
 * Parse a heredoc delimiter word starting at position `start` in `command`.
 * The delimiter may be:
 * - Unquoted:        `EOF`     -- bare identifier characters
 * - Single-quoted:   `'EOF'`   -- literal body, strip outer quotes
 * - Double-quoted:   `"EOF"`   -- expandable body, strip outer quotes
 * - Backslash-escaped: `\EOF`  -- literal body, strip leading backslash
 *
 * Returns the bare delimiter word (for terminator line matching) and the index
 * of the first character after the delimiter token.
 */
function parseHeredocDelimiter(command: string, start: number): { delimiter: string; endIndex: number } {
	let i = start
	let delimiter = ""

	if (command[i] === "'") {
		i++ // skip opening '
		while (i < command.length && command[i] !== "'" && command[i] !== "\n") {
			delimiter += command[i++]
		}
		if (command[i] === "'") i++ // consume closing '
	} else if (command[i] === '"') {
		i++ // skip opening "
		while (i < command.length && command[i] !== '"' && command[i] !== "\n") {
			delimiter += command[i++]
		}
		if (command[i] === '"') i++ // consume closing "
	} else if (command[i] === "\\") {
		i++ // skip backslash
		while (i < command.length && command[i] !== "\n" && command[i] !== " " && command[i] !== "\t") {
			delimiter += command[i++]
		}
	} else {
		while (i < command.length && command[i] !== "\n" && command[i] !== " " && command[i] !== "\t") {
			delimiter += command[i++]
		}
	}

	return { delimiter, endIndex: i }
}

/**
 * State-machine walk behind `findUnterminatedQuote`. Walks `command`
 * left-to-right over every top-level quoted region (outside any other quote
 * and outside `#` comments) and returns a descriptor of the first region that
 * is never closed, or null.
 *
 * Rules (match POSIX shell tokenization):
 * - Outside any quote, `\X` escapes the next character so a quote after `\`
 *   is literal and does not open a region.
 * - `#` that follows whitespace (or is at position 0) starts a comment to end
 *   of line; quotes inside a comment are ignored.
 * - `<<<` is a herestring (single-line redirect), not a heredoc -- skip it.
 * - `<<` opens a heredoc whose body runs through the terminator line.
 * - `$'...'` is ANSI-C quoting (escape-aware single quote).
 * - `$"..."` is locale quoting (escape-aware double quote with `$` prefix).
 * - `'...'` is POSIX single quoting (fully opaque, no escapes).
 * - `"..."` is double quoting (escape-aware).
 *
 * Supported quote styles reported:
 * - `ansi-c`       $'...'
 * - `locale`       $"..."
 * - `posix-single` '...'
 * - `double`       "..."
 * - `heredoc`      <<WORD...WORD
 */
function scanTopLevelQuotes(command: string): UnterminatedQuote | null {
	let i = 0

	while (i < command.length) {
		const char = command[i]

		// Outside any quoted region: handle backslash, comments, and quote openers.
		if (char === "\\") {
			// Backslash escapes the next character; a quote after it is literal.
			i += 2
			continue
		}

		if (char === "#" && (i === 0 || /\s/.test(command[i - 1]!))) {
			// Comment: skip to end of line. Quotes inside are not shell quoting.
			while (i < command.length && command[i] !== "\n" && command[i] !== "\r") {
				i++
			}
			continue
		}

		// Herestring (<<<): single-line stdin redirect -- no body or terminator.
		if (char === "<" && command[i + 1] === "<" && command[i + 2] === "<") {
			i += 3
			continue
		}

		// Heredoc opener: <<[-]? followed by an optional-quoted delimiter word.
		if (char === "<" && command[i + 1] === "<") {
			const start = i
			i += 2 // skip <<
			const stripTabs = command[i] === "-"
			if (stripTabs) i++
			// Skip horizontal whitespace between << and the delimiter word.
			while (i < command.length && (command[i] === " " || command[i] === "\t")) {
				i++
			}
			const { delimiter, endIndex } = parseHeredocDelimiter(command, i)
			i = endIndex
			// Advance past the remainder of the opener line.
			while (i < command.length && command[i] !== "\n") i++
			if (i < command.length) i++ // consume newline
			if (delimiter.length > 0) {
				let found = false
				while (i < command.length) {
					const lineStart = i
					while (i < command.length && command[i] !== "\n" && command[i] !== "\r") {
						i++
					}
					// Strip leading tabs only for <<- heredocs.
					const rawLine = command.slice(lineStart, i)
					const line = stripTabs ? rawLine.replace(/^\t*/, "") : rawLine
					// Do NOT advance past the terminator's newline -- leave it as a
					// separator for any command that follows the heredoc.
					if (line === delimiter) {
						found = true
						break
					}
					if (i < command.length) i++ // consume newline of a body line
				}
				if (!found) {
					return {
						quoteType: "heredoc",
						openIndex: start,
						message: unterminatedQuoteMessage("heredoc", start, command),
					}
				}
			}
			continue
		}

		// ANSI-C quoting: $'...', escape-aware.
		if (char === "$" && command[i + 1] === "'") {
			const start = i
			i += 2 // skip $'
			let closed = false
			while (i < command.length) {
				if (command[i] === "\\") {
					i += 2 // skip escaped char
				} else if (command[i] === "'") {
					i++ // consume closing '
					closed = true
					break
				} else {
					i++
				}
			}
			if (!closed) {
				return {
					quoteType: "ansi-c",
					openIndex: start,
					message: unterminatedQuoteMessage("ansi-c", start, command),
				}
			}
			continue
		}

		// Locale quoting: $"...", escape-aware like double quotes.
		if (char === "$" && command[i + 1] === '"') {
			const start = i
			i += 2 // skip $"
			let closed = false
			while (i < command.length) {
				if (command[i] === "\\") {
					i += 2 // skip escaped char
				} else if (command[i] === '"') {
					i++ // consume closing "
					closed = true
					break
				} else {
					i++
				}
			}
			if (!closed) {
				return {
					quoteType: "locale",
					openIndex: start,
					message: unterminatedQuoteMessage("locale", start, command),
				}
			}
			continue
		}

		// POSIX single quote: fully opaque, ends at the next literal '.
		if (char === "'") {
			const start = i
			i++ // skip opening '
			while (i < command.length && command[i] !== "'") {
				i++
			}
			if (i >= command.length) {
				// No closing quote found.
				return {
					quoteType: "posix-single",
					openIndex: start,
					message: unterminatedQuoteMessage("posix-single", start, command),
				}
			}
			i++ // consume closing '
			continue
		}

		// Double quote: escape-aware, ends at the next unescaped ".
		if (char === '"') {
			const start = i
			i++ // skip opening "
			let closed = false
			while (i < command.length) {
				if (command[i] === "\\") {
					i += 2 // skip escaped char
				} else if (command[i] === '"') {
					i++ // consume closing "
					closed = true
					break
				} else {
					i++
				}
			}
			if (!closed) {
				return {
					quoteType: "double",
					openIndex: start,
					message: unterminatedQuoteMessage("double", start, command),
				}
			}
			continue
		}

		// Ordinary character -- advance.
		i++
	}

	return null
}

/**
 * Split a command string into the individual commands bash would run: at
 * unquoted newlines and chain operators (`&&`, `||`, `;`, `|`, `|&`, `&`), and
 * into the commands nested in substitutions, groups and unquoted heredoc
 * bodies. A command is listed before the commands nested inside it; shell
 * keywords such as `then` or `do` are dropped from the front of a command.
 *
 * Newlines inside a quoted argument or a heredoc body belong to that command:
 *
 *   sh -c 'python3 -c "
 *   import sys
 *   print(sys.version)
 *   "'
 *
 * ...is a single command, not multiple commands split at each newline.
 *
 * When `parseError` is non-null (an unterminated quote or heredoc) the input
 * is returned as one opaque command and callers should surface the error.
 * When `uncertainty` is non-null the split may differ from bash's and callers
 * must not auto-approve.
 */
export function parseCommand(command: string): ParseResult {
	const { commands, parseError, uncertainty } = analyzeCommand(command)
	return { commands: commands.map((c) => c.text), parseError, uncertainty }
}

/** `parseCommand` plus the forms the allow and deny lists are matched against. */
export function analyzeCommand(command: string): CommandAnalysis {
	if (!command?.trim()) {
		return { commands: [], parseError: null, uncertainty: null }
	}

	// An unterminated quote is a shell syntax error. Return the raw input as
	// one opaque command so no fragment of it can be approved on its own.
	const unterminatedQuote = scanTopLevelQuotes(command)
	if (unterminatedQuote !== null) {
		return {
			commands: [{ text: command, matchText: command, commandIsLiteral: false }],
			parseError: unterminatedQuote,
			uncertainty: null,
		}
	}

	const scan = scanShellCommand(command)
	return { commands: scan.commands.map(toAnalyzedCommand), parseError: null, uncertainty: scan.uncertainty }
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/

function toAnalyzedCommand(command: ScannedCommand): AnalyzedCommand {
	const text = [command.words.map((w) => w.raw).join(" "), ...command.heredocs].join("\n")
	const firstCommandWord = command.words.findIndex((w) => !ASSIGNMENT.test(w.raw))
	const commandWords = firstCommandWord === -1 ? [] : command.words.slice(firstCommandWord)
	const commandWord = commandWords[0]

	return {
		text,
		matchText: commandWords.map((w) => w.literal ?? w.raw).join(" "),
		commandIsLiteral: commandWord === undefined || commandWord.literal === commandWord.raw,
	}
}
