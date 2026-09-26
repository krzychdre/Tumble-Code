import { visit } from "unist-util-visit"

/**
 * Counts the number of markdown headings in the given text.
 * Matches headings from level 1 to 6 (e.g. #, ##, ###, etc.).
 * Code fences are stripped before matching to avoid false positives.
 */
export function countMarkdownHeadings(text: string | undefined): number {
	if (!text) return 0

	// Remove fenced code blocks to avoid counting headings inside code
	const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, "")

	// Up to 3 leading spaces are allowed before the hashes per the markdown spec
	const headingRegex = /^\s{0,3}#{1,6}\s+.+$/gm
	const matches = withoutCodeBlocks.match(headingRegex)
	return matches ? matches.length : 0
}

/**
 * Returns true if the markdown contains at least two headings.
 */
export function hasComplexMarkdown(text: string | undefined): boolean {
	return countMarkdownHeadings(text) >= 2
}

/**
 * GitHub-style Markdown alert types, mapped to their lower-cased identifiers.
 * @see https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts
 */
export const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const

export type AlertType = (typeof ALERT_TYPES)[number]

// Matches a leading alert marker like "[!NOTE]" (case-insensitive) optionally
// followed by trailing whitespace/newline on the first line of a blockquote.
const ALERT_MARKER_REGEX = new RegExp(`^\\[!(${ALERT_TYPES.join("|")})\\][^\\S\\r\\n]*\\r?\\n?`, "i")

/**
 * remark plugin that detects GitHub-style alerts inside blockquotes
 * (e.g. `> [!NOTE]`) and annotates the blockquote node so it can be rendered
 * as a distinct alert block.
 *
 * The marker text is stripped from the rendered content and the recognized
 * alert type is exposed via the `data-alert-type` attribute plus matching
 * `markdown-alert*` class names on the emitted `<blockquote>` element.
 *
 * Blockquotes that do not begin with a supported marker are left untouched, so
 * normal blockquotes continue to render exactly as before.
 */
export function remarkGithubAlerts() {
	return (tree: Parameters<typeof visit>[0]) => {
		visit(tree, "blockquote", annotateAlertBlockquote)
	}
}

function annotateAlertBlockquote(node: any): void {
	const firstChild = node.children?.[0]

	// The marker must live in the first paragraph's first text node.
	if (!firstChild || firstChild.type !== "paragraph") {
		return
	}

	const firstText = firstChild.children?.[0]

	if (!firstText || firstText.type !== "text" || typeof firstText.value !== "string") {
		return
	}

	const match = firstText.value.match(ALERT_MARKER_REGEX)

	if (!match) {
		return
	}

	const alertType = match[1].toLowerCase() as AlertType

	// Strip the marker (and the following newline) from the rendered content.
	firstText.value = firstText.value.slice(match[0].length)

	// Drop the now-empty leading text node so the alert body starts cleanly.
	if (firstText.value === "") {
		firstChild.children.shift()
	}

	// If the paragraph became empty (marker was on its own line with no inline
	// content following it), remove it entirely.
	if (firstChild.children.length === 0) {
		node.children.shift()
	}

	node.data = node.data || {}
	const hProperties = (node.data.hProperties = node.data.hProperties || {})
	hProperties.className = `markdown-alert markdown-alert-${alertType}`
	hProperties["data-alert-type"] = alertType
}

// Minimal shapes of the micromark tokenizer API (micromark-util-types is not a
// direct dependency of the webview).
type MicromarkCode = number | null
type MicromarkState = (code: MicromarkCode) => MicromarkState | undefined
interface MicromarkEffects {
	enter(type: string): void
	exit(type: string): void
	consume(code: MicromarkCode): void
	attempt(
		construct: { tokenize: MicromarkTokenizer; partial: boolean },
		ok: MicromarkState,
		nok: MicromarkState,
	): MicromarkState
}
type MicromarkTokenizer = (effects: MicromarkEffects, ok: MicromarkState, nok: MicromarkState) => MicromarkState

// micromark codes: null is the end of input; -5, -4 and -3 are line endings;
// -2 is a tab and -1 a virtual space; 32 is a space.
const DOLLAR = 36
const BACKSLASH = 92
const isLineEnding = (code: MicromarkCode) => code !== null && code < -2
const isSpace = (code: MicromarkCode) => code === 32 || code === -2 || code === -1
const isDigit = (code: MicromarkCode) => code !== null && code >= 48 && code <= 57

// A closing "$" may not be followed by another "$" or by a digit ("$5 and $10").
const closingDollar = {
	partial: true,
	tokenize: ((effects, ok, nok) => (code) => {
		effects.enter("mathTextSequence")
		effects.consume(code)
		effects.exit("mathTextSequence")
		return (next) => (next === DOLLAR || isDigit(next) ? nok(next) : ok(next))
	}) as MicromarkTokenizer,
}

// "$...$" inline math with Pandoc's tex_math_dollars rule.
const tokenizeSingleDollarMath: MicromarkTokenizer = (effects, ok, nok) => {
	// Whether the last character inside the math was a space or a line ending.
	let afterSpace = false

	const data: MicromarkState = (code) => {
		if (code === null || code === DOLLAR || isLineEnding(code)) {
			effects.exit("mathTextData")
			return between(code)
		}
		effects.consume(code)
		afterSpace = isSpace(code)
		return code === BACKSLASH ? escaped : data
	}

	// "\$" (or any escaped character) inside the math is TeX, not the closing "$".
	const escaped: MicromarkState = (code) => {
		if (code === null || isLineEnding(code)) {
			return data(code)
		}
		effects.consume(code)
		afterSpace = false
		return data
	}

	const dollarAsData: MicromarkState = (code) => {
		effects.enter("mathTextData")
		effects.consume(code)
		afterSpace = false
		return data
	}

	const close: MicromarkState = (code) => {
		effects.exit("mathText")
		return ok(code)
	}

	const between: MicromarkState = (code) => {
		if (code === null) {
			return nok(code)
		}
		if (isLineEnding(code)) {
			effects.enter("lineEnding")
			effects.consume(code)
			effects.exit("lineEnding")
			afterSpace = true
			return between
		}
		if (code === DOLLAR) {
			// A "$" after a space never closes ("$5 and $10").
			return afterSpace ? dollarAsData(code) : effects.attempt(closingDollar, close, dollarAsData)(code)
		}
		effects.enter("mathTextData")
		return data(code)
	}

	const afterOpening: MicromarkState = (code) => {
		// "$$" belongs to remark-math; "$ 5" is not math.
		if (code === null || code === DOLLAR || isSpace(code) || isLineEnding(code)) {
			return nok(code)
		}
		return between(code)
	}

	return (code) => {
		effects.enter("mathText")
		effects.enter("mathTextSequence")
		effects.consume(code)
		effects.exit("mathTextSequence")
		return afterOpening
	}
}

/**
 * Single-dollar inline math with Pandoc's rule, so prices stay text. Use with
 * `[remarkMath, { singleDollarTextMath: false }]`, which keeps "$$...$$" (inline
 * and display) and leaves "$...$" to this plugin.
 *
 * Pandoc (tex_math_dollars): the opening "$" must be followed by a non-space,
 * the closing "$" must be preceded by a non-space and must not be followed by
 * a digit. "$5 and $10" has no valid closing "$", so both stay literal, while
 * "$x^2$" and "$2^n$" are math. It emits the tokens remark-math's own
 * construct emits, so mdast-util-math builds the same inlineMath node.
 */
export function remarkSingleDollarMath(this: { data(): object }) {
	// The unified processor's data; remark-parse reads its micromarkExtensions.
	const data = this.data() as { micromarkExtensions?: unknown[] }

	;(data.micromarkExtensions ??= []).push({
		text: {
			[DOLLAR]: {
				name: "singleDollarMath",
				tokenize: tokenizeSingleDollarMath,
				// Never open at the second "$" of "$$".
				previous: (code: MicromarkCode) => code !== DOLLAR,
			},
		},
	})
}
