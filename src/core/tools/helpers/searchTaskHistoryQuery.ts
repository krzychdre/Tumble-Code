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
 * 2. A pattern whose shape can backtrack exponentially (a quantified group that
 *    itself contains an unbounded quantifier, the classic `(a+)+b`) is REFUSED
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
 * True when the pattern contains a quantified group whose body already carries
 * an unbounded quantifier, which is the shape that backtracks exponentially.
 *
 * Deliberately syntactic and conservative: it walks the pattern once, tracking
 * escapes and character classes, and only reports the nesting it can actually
 * see. `(foo|bar)+` is fine; `(a+)+`, `(a*)*`, `(?:\d+)*` and `(x|y+)*` are not.
 *
 * Two deliberate over-approximations, both paid for with a literal fallback
 * rather than an error:
 *
 * - A body's quantifier survives group nesting even when the inner group is
 *   itself unquantified, so `((a+))+` is refused like `(a+)+`. This also
 *   refuses safe shapes such as `((a+)b)+`.
 * - `?` in a body counts as a quantifier, because a nullable body under an
 *   unbounded group quantifier (`(a?)+`, `(?:\d?)*`) is the classic blow-up.
 *   The `?` that is group syntax (`(?:`, `(?=`, `(?!`, `(?<`) does not count,
 *   so `(?:foo)+` stays a live regex.
 */
function isCatastrophicPattern(pattern: string): boolean {
	/** For each open group, whether its body carries an unbounded quantifier. */
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
				const quantified = isUnboundedQuantifierAt(pattern, i + 1)

				if (bodyQuantified && quantified) {
					return true
				}
				if (bodyQuantified || quantified) {
					// A quantified group is itself an unbounded quantifier as far
					// as any enclosing group is concerned, and a quantifier in the
					// body survives the nesting: `((a+))` still carries the `+`,
					// so `((a+))+` must be refused like `(a+)+`.
					markCurrentGroup()
				}
				break
			}
			case "*":
			case "+":
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
				if (isUnboundedQuantifierAt(pattern, i)) {
					markCurrentGroup()
				}
				break
			default:
				break
		}
	}

	return false
}

/** True when position `index` starts `*`, `+` or an open-ended `{n,}`. */
function isUnboundedQuantifierAt(pattern: string, index: number): boolean {
	const char = pattern[index]

	if (char === "*" || char === "+") {
		return true
	}

	if (char !== "{") {
		return false
	}

	const close = pattern.indexOf("}", index)
	if (close < 0) {
		return false
	}

	// `{n,}` is unbounded; `{n}` and `{n,m}` are not.
	return /^\d+,$/.test(pattern.slice(index + 1, close))
}
