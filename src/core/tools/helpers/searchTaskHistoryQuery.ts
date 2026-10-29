import { escapeRegExp } from "@tumble-code/core/browser"

/*
 * Query compiling of the task-history search (searchTaskHistory.ts): the
 * `/pattern/flags` form, the literal fallback, and the guard that refuses a
 * pattern shape that backtracks exponentially.
 */

/** How the query was interpreted. */
export type HistoryQueryMode =
	/** Compiled and used as a regular expression. */
	| "regex"
	/** Did not compile, so it was searched for as plain text. */
	| "literal"
	/** Compiled, but its shape can backtrack exponentially, so it was searched for as plain text. */
	| "unsafe"

/** Regular-expression flags accepted in the `/pattern/flags` form. */
const ALLOWED_SLASH_FLAGS = "imsu"

/**
 * Compiles the query the way the tool description promises.
 *
 * Three outcomes, in order:
 *
 * 1. `/pattern/flags` is unwrapped first. Weak models write a slash-delimited
 *    literal far more often than they read the parameter description, and
 *    treating the slashes as content makes such a call silently find nothing.
 * 2. A pattern whose shape can backtrack exponentially (a repeated group whose
 *    body can match the same text in more than one way, the classic `(a+)+b`
 *    or `(a|a)*b`) is REFUSED
 *    as a regular expression and searched for literally. There is no way to
 *    interrupt a running `RegExp.test`, so the only safe move is not to start
 *    one; the wall-clock budget in {@link searchHistorySources} is the second
 *    line of defence, not the first.
 * 3. Anything that does not compile is escaped and searched for literally, so a
 *    stray bracket costs no turn.
 *
 * The search is always case-insensitive.
 */
export function compileHistoryQuery(query: string): { regex: RegExp; usedRegex: boolean; mode: HistoryQueryMode } {
	const slashForm = parseSlashDelimited(query)
	const source = slashForm?.pattern ?? query
	const flags = slashForm?.flags ?? "i"

	if (isCatastrophicPattern(source)) {
		return { regex: new RegExp(escapeRegExp(query), "i"), usedRegex: false, mode: "unsafe" }
	}

	try {
		return { regex: new RegExp(source, flags), usedRegex: true, mode: "regex" }
	} catch {
		return { regex: new RegExp(escapeRegExp(query), "i"), usedRegex: false, mode: "literal" }
	}
}

/**
 * Recognises `/pattern/flags` and returns its parts.
 *
 * Only `i`, `m`, `s` and `u` are accepted as flags: `g` and `y` make
 * `RegExp.test` stateful through `lastIndex`, which would make the same pattern
 * match every other line. `i` is always added, because the tool promises a
 * case-insensitive search whatever the model wrote.
 */
function parseSlashDelimited(query: string): { pattern: string; flags: string } | undefined {
	if (query.length < 3 || !query.startsWith("/")) {
		return undefined
	}

	const closing = query.lastIndexOf("/")
	if (closing <= 0) {
		return undefined
	}

	const pattern = query.slice(1, closing)
	const rawFlags = query.slice(closing + 1)

	if (pattern.length === 0) {
		return undefined
	}

	if (![...rawFlags].every((flag) => ALLOWED_SLASH_FLAGS.includes(flag))) {
		return undefined
	}

	const flags = ["i", ...new Set(rawFlags)].filter((flag, index, all) => all.indexOf(flag) === index).join("")

	return { pattern, flags }
}

/**
 * True when the pattern contains a repeated group (`*`, `+` or any `{...}`
 * count) whose body can match the same text in more than one way: the body
 * holds a variable quantifier (`*`, `+`, `?`, `{n,}`, `{n,m}`) or an
 * alternation (`|`). Each repetition then has several ways to split the text,
 * and a failing match tries them all: `(a+)+b`, `(a|a)*b` and `(a{1,5})+b`
 * take seconds to minutes on a line of 30 to 40 `a`s.
 *
 * Deliberately syntactic and conservative: it walks the pattern once, tracking
 * escapes and character classes, and only reports the nesting it can actually
 * see. `(ab)+`, `(\d{4}-)+` and an unrepeated `(foo|bar)` are fine.
 *
 * Deliberate over-approximations, all paid for with a literal fallback rather
 * than an error:
 *
 * - Any alternation counts, also one whose branches can never match the same
 *   text, so `(foo|bar)+` is refused like `(a|a)+`.
 * - A body's marker survives group nesting even when the inner group is
 *   itself unquantified, so `((a+))+` is refused like `(a+)+`. This also
 *   refuses safe shapes such as `((a+)b)+`.
 * - `?` in a body counts as a quantifier, because a nullable body under a
 *   repeated group (`(a?)+`, `(?:\d?)*`) is the classic blow-up. The `?` that
 *   is group syntax (`(?:`, `(?=`, `(?!`, `(?<`) does not count, so `(?:foo)+`
 *   stays a live regex.
 */
function isCatastrophicPattern(pattern: string): boolean {
	/** For each open group, whether its body can match the same text in more than one way. */
	const groupBodyQuantified: boolean[] = []
	let inCharClass = false
	let escaped = false
	/** True when the previous character was an unescaped `(`. */
	let afterGroupOpen = false

	const markCurrentGroup = () => {
		if (groupBodyQuantified.length > 0) {
			groupBodyQuantified[groupBodyQuantified.length - 1] = true
		}
	}

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i]
		const wasAfterGroupOpen = afterGroupOpen
		afterGroupOpen = false

		if (escaped) {
			escaped = false
			continue
		}

		if (char === "\\") {
			escaped = true
			continue
		}

		if (inCharClass) {
			if (char === "]") {
				inCharClass = false
			}
			continue
		}

		switch (char) {
			case "[":
				inCharClass = true
				break
			case "(":
				groupBodyQuantified.push(false)
				afterGroupOpen = true
				break
			case ")": {
				const bodyQuantified = groupBodyQuantified.pop() ?? false

				if (bodyQuantified && isRepeatAt(pattern, i + 1)) {
					return true
				}
				if (bodyQuantified) {
					// The marker survives the nesting: `((a+))` still carries the
					// `+`, so `((a+))+` must be refused like `(a+)+`. A quantifier
					// on this group marks the enclosing one when it is read next.
					markCurrentGroup()
				}
				break
			}
			case "*":
			case "+":
			case "|":
				markCurrentGroup()
				break
			case "?":
				// A nullable body under an unbounded group quantifier ((a?)+) is
				// the classic exponential shape. `?` right after an unescaped `(`
				// is group syntax ((?:, (?=, (?!, (?<), not a quantifier.
				if (!wasAfterGroupOpen) {
					markCurrentGroup()
				}
				break
			case "{":
				// `{n}` repeats a fixed count and splits text one way only.
				if (countAt(pattern, i)?.[1] !== undefined) {
					markCurrentGroup()
				}
				break
			default:
				break
		}
	}

	return false
}

/** True when position `index` starts `*`, `+` or a `{n}`, `{n,}` or `{n,m}` count. */
function isRepeatAt(pattern: string, index: number): boolean {
	const char = pattern[index]

	return char === "*" || char === "+" || countAt(pattern, index) !== null
}

/** Sticky, so a count is read where it starts without copying the rest of the pattern. */
const COUNT = /\{\d+(,\d*)?\}/y

/** The `{n}`, `{n,}` or `{n,m}` count at `index`; group 1 is the comma part of a variable count. */
function countAt(pattern: string, index: number): RegExpExecArray | null {
	COUNT.lastIndex = index
	return COUNT.exec(pattern)
}
