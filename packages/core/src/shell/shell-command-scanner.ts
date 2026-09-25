/**
 * A left-to-right scanner that splits a shell command into the simple commands
 * bash would run, including the ones nested inside command substitutions
 * (`$(...)`, backticks), process substitutions (`<(...)`, `>(...)`), groups
 * (`(...)`, `{ ...; }`), parameter expansions, arithmetic and unquoted heredoc
 * bodies.
 *
 * It exists for command auto-approval: every command bash runs must be visible
 * to the allow and deny lists. The scanner therefore follows bash's quoting
 * rules character by character (a backslash escapes the next character outside
 * single quotes, single quotes are opaque, double quotes still expand `$(...)`
 * and backticks, a quoted heredoc delimiter keeps the body literal). Whenever
 * it meets syntax it does not model precisely, it records an `uncertainty` so
 * the caller asks the user instead of approving.
 */

/** One word of a simple command. */
export interface ShellWord {
	/** The word as written, quotes and escapes included. */
	raw: string
	/**
	 * The word after quote removal, or null when its value is only known once
	 * the shell expands it (a variable, a substitution, a glob, ANSI-C quoting).
	 */
	literal: string | null
}

/** A simple command: its words (leading shell keywords removed) and its heredoc bodies. */
export interface ScannedCommand {
	words: ShellWord[]
	/** Each heredoc body with its terminator line, in the order they appear. */
	heredocs: string[]
}

export interface ShellScan {
	/** Every simple command, a command before the commands nested inside it. */
	commands: ScannedCommand[]
	/** Why the split may differ from bash's, or null when it matches. */
	uncertainty: string | null
}

/**
 * Reserved words that may precede a command (or stand alone) without being the
 * command themselves. They are dropped so the allow and deny lists see the
 * command that actually runs, e.g. `then rm -rf x` is checked as `rm -rf x`.
 */
const KEYWORDS_BEFORE_A_COMMAND = new Set([
	"!",
	"{",
	"}",
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"while",
	"until",
	"do",
	"done",
	"time",
	"coproc",
])

/** A function header written as one word, e.g. `deploy()`. */
const FUNCTION_HEADER = /^[A-Za-z_][\w.:-]*\(\)$/

/** A word that opens an array assignment, e.g. `files=` or `arr[1]+=`. */
const ARRAY_ASSIGNMENT_OPENER = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/

/** Characters that make an unquoted word a glob pattern. */
const GLOB_CHARACTERS = new Set(["*", "?", "["])

/**
 * Deepest nesting of substitutions, groups and quotes the scanner follows.
 * Real commands stay far below it; beyond it the scan stops as uncertain
 * instead of exhausting the call stack.
 */
const MAX_NESTING = 64

/** Characters that end an unquoted heredoc delimiter word. */
const DELIMITER_TERMINATORS = new Set([" ", "\t", "\n", "\r", ";", "&", "|", "<", ">", "(", ")"])

interface WordBuilder {
	raw: string
	literal: string
	/** False once the word contains something whose value is only known after expansion. */
	isLiteral: boolean
	/** Open parentheses inside the word (array assignment), during which blanks are word text. */
	parenDepth: number
}

interface ListState {
	command: ScannedCommand
	word: WordBuilder | null
}

interface PendingHeredoc {
	command: ScannedCommand
	delimiter: string
	stripTabs: boolean
	/** An unquoted delimiter means the body undergoes substitution. */
	expands: boolean
}

export function scanShellCommand(command: string): ShellScan {
	const scanner = new ShellScanner(command)
	scanner.scanAll()
	return { commands: scanner.commands, uncertainty: scanner.uncertainty }
}

class ShellScanner {
	readonly commands: ScannedCommand[] = []
	uncertainty: string | null = null
	private pos = 0
	private pendingHeredocs: PendingHeredoc[] = []

	constructor(
		private readonly src: string,
		private depth = 0,
	) {}

	scanAll(): void {
		this.scanList(null)
		if (this.pendingHeredocs.length > 0) {
			this.markUncertain("a heredoc has no body")
		}
	}

	/** Scan the body of an unquoted heredoc: only substitutions matter there. */
	scanExpandingText(): void {
		const scratch = newWord()
		while (this.pos < this.src.length) {
			const c = this.src[this.pos]
			if (c === "\\") {
				this.pos += 2
			} else if (c === "$") {
				this.consumeDollar(scratch, true)
			} else if (c === "`") {
				this.consumeBackticks(scratch)
			} else {
				this.pos++
			}
		}
	}

	private markUncertain(reason: string): void {
		if (this.uncertainty === null) {
			this.uncertainty = reason
		}
	}

	private adopt(nested: ShellScanner): void {
		this.commands.push(...nested.commands)
		if (nested.uncertainty !== null) {
			this.markUncertain(nested.uncertainty)
		}
	}

	private startCommand(): ScannedCommand {
		// Reserve the slot now so a command precedes the commands nested in it.
		const command: ScannedCommand = { words: [], heredocs: [] }
		this.commands.push(command)
		return command
	}

	private finishCommand(state: ListState): void {
		this.endWord(state)
		const { command } = state
		const words = command.words

		while (words.length > 0) {
			const first = words[0]!.raw
			if (KEYWORDS_BEFORE_A_COMMAND.has(first) || FUNCTION_HEADER.test(first)) {
				words.shift()
			} else if (first === "function") {
				// `function name` or `function name()`: the body that follows is checked.
				words.splice(0, words[2]?.raw === "()" ? 3 : 2)
			} else if (words[1]?.raw === "()") {
				// `name ()`: a function header written as two words.
				words.splice(0, 2)
			} else {
				break
			}
		}

		if (words[0]?.raw === "case" || words[0]?.raw === "select") {
			this.markUncertain(`\`${words[0].raw}\` statements are not analysed`)
		}

		if (words.length === 0 && command.heredocs.length === 0) {
			this.commands.splice(this.commands.lastIndexOf(command), 1)
		}
		state.command = this.startCommand()
	}

	private endWord(state: ListState): void {
		const word = state.word
		if (word === null) {
			return
		}
		if (word.parenDepth > 0) {
			this.markUncertain("unbalanced parenthesis inside a word")
		}
		state.command.words.push({ raw: word.raw, literal: word.isLiteral ? word.literal : null })
		state.word = null
	}

	private wordOf(state: ListState): WordBuilder {
		state.word ??= newWord()
		return state.word
	}

	/**
	 * Run `scan` one nesting level deeper, or stop the whole scan as uncertain
	 * when the nesting limit is reached.
	 */
	private nested(scan: () => void): void {
		if (this.depth >= MAX_NESTING) {
			this.markUncertain("nesting too deep")
			this.pos = this.src.length
			return
		}
		this.depth++
		try {
			scan()
		} finally {
			this.depth--
		}
	}

	/**
	 * Scan a command list until `closer` (the `)` of a substitution or group) or
	 * the end of input. Nested lists recurse.
	 */
	private scanList(closer: ")" | null): void {
		this.nested(() => this.scanListBody(closer))
	}

	private scanListBody(closer: ")" | null): void {
		const state: ListState = { command: this.startCommand(), word: null }

		while (this.pos < this.src.length) {
			const c = this.src[this.pos]!
			const next = this.src[this.pos + 1]

			if (this.consumeWordPart(state)) {
				continue
			}

			const word = state.word

			if (word !== null && word.parenDepth > 0) {
				// Inside `name=(...)` blanks, newlines and operators are word text.
				if (c === "(") word.parenDepth++
				if (c === ")") word.parenDepth--
				word.raw += c
				word.literal += c
				this.pos++
				continue
			}

			if (c === " " || c === "\t") {
				this.endWord(state)
				this.pos++
				continue
			}

			if (c === "\n" || c === "\r") {
				this.finishCommand(state)
				this.pos += c === "\r" && next === "\n" ? 2 : 1
				this.readPendingHeredocs()
				continue
			}

			if (c === "#" && word === null) {
				// Comment: skip to the end of the line, keeping the newline.
				while (this.pos < this.src.length && this.src[this.pos] !== "\n" && this.src[this.pos] !== "\r") {
					this.pos++
				}
				continue
			}

			if (c === ";") {
				this.finishCommand(state)
				this.pos++
				// `;;`, `;&` and `;;&` end a case branch.
				while (this.src[this.pos] === ";" || this.src[this.pos] === "&") this.pos++
				continue
			}

			if (c === "&") {
				if (word !== null && /[<>]$/.test(word.raw)) {
					// `2>&1`, `<&0`: part of a redirection.
					this.appendText(state, c)
				} else if (next === ">") {
					// `&>file`, `&>>file`: redirection of both streams.
					this.appendText(state, c)
				} else {
					this.finishCommand(state)
					this.pos += next === "&" ? 2 : 1
				}
				continue
			}

			if (c === "|") {
				if (word !== null && word.raw.endsWith(">")) {
					// `>|file`: clobbering redirection.
					this.appendText(state, c)
				} else {
					this.finishCommand(state)
					this.pos += next === "|" || next === "&" ? 2 : 1
				}
				continue
			}

			if (c === "<" && next === "<") {
				if (this.src[this.pos + 2] === "<") {
					// `<<<`: a herestring feeds one word, it has no body.
					this.appendText(state, "<<<")
				} else {
					this.consumeHeredocOpener(state)
				}
				continue
			}

			if (c === "(") {
				this.consumeOpenParen(state)
				continue
			}

			if (c === ")") {
				if (closer === ")") {
					this.finishCommand(state)
					this.pos++
					this.discardEmpty(state.command)
					return
				}
				this.markUncertain("unmatched `)`")
				this.finishCommand(state)
				this.pos++
				continue
			}

			const target = this.wordOf(state)
			target.raw += c
			target.literal += c
			if (GLOB_CHARACTERS.has(c)) {
				target.isLiteral = false
			}
			this.pos++
		}

		this.finishCommand(state)
		this.discardEmpty(state.command)
		if (closer !== null) {
			this.markUncertain("unterminated `(`")
		}
	}

	private discardEmpty(command: ScannedCommand): void {
		if (command.words.length === 0 && command.heredocs.length === 0) {
			this.commands.splice(this.commands.lastIndexOf(command), 1)
		}
	}

	private appendText(state: ListState, text: string): void {
		const word = this.wordOf(state)
		word.raw += text
		word.literal += text
		this.pos += text.length
	}

	/**
	 * Consume one quoted, escaped or expanded part of a word. Returns false when
	 * the character at the cursor is not the start of such a part.
	 */
	private consumeWordPart(state: ListState): boolean {
		const c = this.src[this.pos]
		const next = this.src[this.pos + 1]
		const start = this.pos

		if (c === "\\") {
			if (next === "\n" || (next === "\r" && this.src[this.pos + 2] === "\n")) {
				// Line continuation: bash removes it, so it neither ends nor joins anything visible.
				this.pos += next === "\n" ? 2 : 3
				return true
			}
			const word = this.wordOf(state)
			if (next === undefined) {
				word.raw += c
				word.literal += c
				this.pos++
				return true
			}
			word.raw += c + next
			word.literal += next
			this.pos += 2
			return true
		}

		if (c === "'") {
			const word = this.wordOf(state)
			const end = this.src.indexOf("'", this.pos + 1)
			if (end === -1) {
				this.markUncertain("unterminated single quote")
				this.pos = this.src.length
			} else {
				word.literal += this.src.slice(this.pos + 1, end)
				this.pos = end + 1
			}
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		if (c === "$" && next === "'") {
			// ANSI-C quoting: escapes are decoded by bash, so the value is not literal.
			const word = this.wordOf(state)
			this.consumeAnsiC()
			word.isLiteral = false
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		if (c === '"' || (c === "$" && next === '"')) {
			const word = this.wordOf(state)
			this.consumeDoubleQuoted(word)
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		if (c === "`") {
			const word = this.wordOf(state)
			this.consumeBackticks(word)
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		if (c === "$") {
			const word = this.wordOf(state)
			this.consumeDollar(word, false)
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		if ((c === "<" || c === ">") && next === "(") {
			// Process substitution runs its list.
			const word = this.wordOf(state)
			this.pos += 2
			this.scanList(")")
			word.isLiteral = false
			word.raw += this.src.slice(start, this.pos)
			return true
		}

		return false
	}

	private consumeAnsiC(): void {
		this.pos += 2
		while (this.pos < this.src.length) {
			const c = this.src[this.pos]
			if (c === "\\") {
				this.pos += 2
			} else if (c === "'") {
				this.pos++
				return
			} else {
				this.pos++
			}
		}
		this.markUncertain("unterminated ANSI-C quote")
	}

	/** Consume `"..."` or `$"..."`; substitutions inside it still run. */
	private consumeDoubleQuoted(word: WordBuilder): void {
		if (this.src[this.pos] === "$") {
			word.isLiteral = false
			this.pos++
		}
		this.pos++
		while (this.pos < this.src.length) {
			const c = this.src[this.pos]
			const next = this.src[this.pos + 1]
			if (c === '"') {
				this.pos++
				return
			}
			if (c === "\\") {
				if (next === "\n") {
					// Escaped newline inside double quotes is removed.
				} else if (next === "$" || next === "`" || next === '"' || next === "\\") {
					word.literal += next
				} else {
					word.literal += c + (next ?? "")
				}
				this.pos += 2
				continue
			}
			if (c === "$") {
				this.consumeDollar(word, true)
				continue
			}
			if (c === "`") {
				this.consumeBackticks(word)
				continue
			}
			word.literal += c
			this.pos++
		}
		this.markUncertain("unterminated double quote")
	}

	/** Consume an expansion that starts with `$`. */
	private consumeDollar(word: WordBuilder, inDoubleQuotes: boolean): void {
		this.nested(() => this.consumeDollarBody(word, inDoubleQuotes))
	}

	private consumeDollarBody(word: WordBuilder, inDoubleQuotes: boolean): void {
		const next = this.src[this.pos + 1]

		if (next === "(" && this.src[this.pos + 2] === "(") {
			word.isLiteral = false
			this.pos += 3
			this.consumeArithmetic()
			return
		}

		if (next === "(") {
			word.isLiteral = false
			this.pos += 2
			this.scanList(")")
			return
		}

		if (next === "{") {
			word.isLiteral = false
			this.pos += 2
			this.consumeBraced("}", inDoubleQuotes)
			return
		}

		if (next === "[") {
			word.isLiteral = false
			this.pos += 2
			this.consumeBraced("]", inDoubleQuotes)
			return
		}

		const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9?!#$@*-])/.exec(this.src.slice(this.pos + 1))
		if (name) {
			word.isLiteral = false
			this.pos += 1 + name[0].length
			return
		}

		// A lone `$` is literal text.
		word.literal += "$"
		this.pos++
	}

	/**
	 * Consume the rest of `${...}` or `$[...]` up to the matching `closer`,
	 * scanning nested quotes and substitutions.
	 */
	private consumeBraced(closer: "}" | "]", inDoubleQuotes: boolean): void {
		const opener = closer === "}" ? "{" : "["
		const scratch = newWord()
		let depth = 0
		while (this.pos < this.src.length) {
			const c = this.src[this.pos]
			if (c === "\\") {
				this.pos += 2
			} else if (c === "'" && !inDoubleQuotes) {
				const end = this.src.indexOf("'", this.pos + 1)
				this.pos = end === -1 ? this.src.length : end + 1
			} else if (c === '"') {
				this.consumeDoubleQuoted(scratch)
			} else if (c === "$") {
				this.consumeDollar(scratch, inDoubleQuotes)
			} else if (c === "`") {
				this.consumeBackticks(scratch)
			} else if (c === opener) {
				depth++
				this.pos++
			} else if (c === closer) {
				this.pos++
				if (depth === 0) {
					return
				}
				depth--
			} else {
				this.pos++
			}
		}
		this.markUncertain(`unterminated \`${opener === "{" ? "${" : "$["}\``)
	}

	/** Consume the body of `$((...))` or `((...))` after the opening parentheses. */
	private consumeArithmetic(): void {
		const scratch = newWord()
		let depth = 0
		while (this.pos < this.src.length) {
			const c = this.src[this.pos]
			if (c === "\\") {
				this.pos += 2
			} else if (c === "'") {
				const end = this.src.indexOf("'", this.pos + 1)
				this.pos = end === -1 ? this.src.length : end + 1
			} else if (c === '"') {
				this.consumeDoubleQuoted(scratch)
			} else if (c === "$") {
				this.consumeDollar(scratch, false)
			} else if (c === "`") {
				this.consumeBackticks(scratch)
			} else if (c === "(") {
				depth++
				this.pos++
			} else if (c === ")") {
				if (depth > 0) {
					depth--
					this.pos++
				} else if (this.src[this.pos + 1] === ")") {
					this.pos += 2
					return
				} else {
					this.markUncertain("arithmetic closed by a single `)`")
					this.pos++
					return
				}
			} else {
				this.pos++
			}
		}
		this.markUncertain("unterminated arithmetic expansion")
	}

	/**
	 * Consume a backtick substitution. Inside it `\``, `\\` and `\$` stand for
	 * the plain characters, so the body is unescaped and scanned on its own.
	 */
	private consumeBackticks(word: WordBuilder): void {
		word.isLiteral = false
		let body = ""
		let i = this.pos + 1
		while (i < this.src.length) {
			const c = this.src[i]
			if (c === "\\" && i + 1 < this.src.length) {
				const next = this.src[i + 1]
				body += next === "`" || next === "\\" || next === "$" ? next : c + next
				i += 2
			} else if (c === "`") {
				this.pos = i + 1
				const nested = new ShellScanner(body, this.depth + 1)
				nested.scanAll()
				this.adopt(nested)
				return
			} else {
				body += c
				i++
			}
		}
		this.markUncertain("unterminated backtick")
		this.pos = this.src.length
	}

	/** `(` outside a quoted part: a group, an arithmetic command, a function header or an array. */
	private consumeOpenParen(state: ListState): void {
		const word = state.word
		const next = this.src[this.pos + 1]

		if (word !== null) {
			if (next === ")") {
				// `name()`: function header.
				this.appendText(state, "()")
				return
			}
			if (!ARRAY_ASSIGNMENT_OPENER.test(word.raw)) {
				this.markUncertain("parenthesis inside a word")
			}
			word.parenDepth++
			this.appendText(state, "(")
			return
		}

		if (state.command.words.length > 0) {
			if (next === ")") {
				// `name ()`: function header written as two words.
				this.appendText(state, "()")
				this.endWord(state)
				return
			}
			this.markUncertain("`(` after a command word")
		}

		if (next === "(") {
			// `((...))`: arithmetic command.
			const start = this.pos
			this.pos += 2
			this.consumeArithmetic()
			state.command.words.push({ raw: this.src.slice(start, this.pos), literal: null })
			return
		}

		// Subshell group: its commands run like any others. Words after the
		// closing `)` (redirections) form a command listed after the group.
		this.finishCommand(state)
		this.discardEmpty(state.command)
		this.pos++
		this.scanList(")")
		state.command = this.startCommand()
	}

	/** `<<WORD` or `<<-WORD`: record the heredoc; its body starts after the next newline. */
	private consumeHeredocOpener(state: ListState): void {
		const stripTabs = this.src[this.pos + 2] === "-"
		this.appendText(state, stripTabs ? "<<-" : "<<")

		if (this.src[this.pos] === " " || this.src[this.pos] === "\t") {
			this.endWord(state)
			while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos++
		}

		const start = this.pos
		let delimiter = ""
		let quoted = false
		while (this.pos < this.src.length && !DELIMITER_TERMINATORS.has(this.src[this.pos]!)) {
			const c = this.src[this.pos]
			if (c === "'" || c === '"') {
				quoted = true
				const end = this.src.indexOf(c, this.pos + 1)
				const stop = end === -1 ? this.src.length : end
				delimiter += this.src.slice(this.pos + 1, stop)
				this.pos = stop + 1
			} else if (c === "\\") {
				quoted = true
				delimiter += this.src[this.pos + 1] ?? ""
				this.pos += 2
			} else {
				delimiter += c
				this.pos++
			}
		}

		const word = this.wordOf(state)
		word.raw += this.src.slice(start, this.pos)
		word.literal += delimiter

		if (delimiter.length === 0) {
			this.markUncertain("heredoc without a delimiter")
			return
		}
		this.pendingHeredocs.push({ command: state.command, delimiter, stripTabs, expands: !quoted })
	}

	/** Read the bodies of the heredocs opened on the line that just ended. */
	private readPendingHeredocs(): void {
		const pending = this.pendingHeredocs
		this.pendingHeredocs = []

		pending.forEach((heredoc, index) => {
			if (index > 0 && this.src[this.pos] === "\n") {
				this.pos++
			}
			const bodyStart = this.pos
			while (this.pos < this.src.length) {
				const lineStart = this.pos
				let lineEnd = this.src.indexOf("\n", lineStart)
				if (lineEnd === -1) lineEnd = this.src.length
				const rawLine = this.src.slice(lineStart, lineEnd).replace(/\r$/, "")
				const line = heredoc.stripTabs ? rawLine.replace(/^\t+/, "") : rawLine

				if (line === heredoc.delimiter) {
					// Leave the terminator's newline in place: it separates the next command.
					this.pos = lineEnd
					heredoc.command.heredocs.push(this.src.slice(bodyStart, lineEnd))
					if (heredoc.expands) {
						const nested = new ShellScanner(this.src.slice(bodyStart, lineStart), this.depth + 1)
						nested.scanExpandingText()
						this.adopt(nested)
					}
					return
				}
				this.pos = lineEnd + 1
			}
			this.pos = this.src.length
			this.markUncertain("unterminated heredoc")
		})
	}
}

function newWord(): WordBuilder {
	return { raw: "", literal: "", isLiteral: true, parenDepth: 0 }
}
