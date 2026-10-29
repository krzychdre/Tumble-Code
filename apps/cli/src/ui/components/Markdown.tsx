import { memo, type ReactNode } from "react"
import { Box, Text } from "ink"

import { escapeRegExp } from "@tumble-code/core/cli"

import { figures } from "../figures.js"
import { InlineImage } from "../graphics/InlineImage.js"
import { MathBlock } from "../graphics/MathBlock.js"
import { MermaidBlock } from "../graphics/MermaidBlock.js"
import * as theme from "../theme.js"
import { texToUnicode } from "../utils/texToUnicode.js"

type TokenKind = "bold" | "italic" | "code" | "math" | "strike" | "linkText" | "linkUrl"

interface Token {
	kind?: TokenKind
	text: string
}

// `_emphasis_` only at word boundaries, as in CommonMark: otherwise
// `my_var_name` renders as `myvarname` and `__tests__` as `_tests_`.
// Inline math: `$$...$$`, `\(...\)`, `\[...\]` and `$...$` with Pandoc's rule
// (no space inside the dollars, no digit after the closing one), so the
// prices in "$5 and $10" stay text.
//
// No marker body may run past the next opener of its kind: `\[` written
// 30 000 times on one line, or `[a](` repeated, made each opener rescan the
// rest of the line and held the terminal for seconds per render. A link target
// may hold one level of balanced parentheses (Wikipedia's `Foo_(bar)`).
// For the same reason a `$` escaped by an odd run of backslashes opens no
// math: every `\$` of `a\$` repeated rescanned the rest of the line.
const INLINE_MATH = String.raw`\$\$[^$]+\$\$|\\\((?:(?!\\\().)+?\\\)|\\\[(?:(?!\\\[).)+?\\\]|(?<!(?<!\\)(?:\\\\)*\\)\$(?=[^\s$])(?:\\.|[^$\\])+?(?<=\S)\$(?!\d)`
const LINK = String.raw`\[[^\][]*\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*\)`
const INLINE_MARKER_RE = new RegExp(
	String.raw`(\x60[^\x60]+\x60|${INLINE_MATH}|\*\*[^*]+\*\*|\*[^*]+\*|(?<![\w])_[^_]+_(?![\w])|~~[^~]+~~|${LINK})`,
)

/** Math inside bold, italic, struck or link text: `**token $i$**` reads `token i`. */
const NESTED_MATH_RE = new RegExp(INLINE_MATH, "g")

/** The TeX of a math marker: `$$...$$` (1), a bracket form (2) or `$...$` (3). */
const MATH_MARKER_RE = /^(?:\$\$([\s\S]+)\$\$|\\[([]([\s\S]+)\\[)\]]|\$([\s\S]+)\$)$/

/** Content that reads as TeX: a command, a script, a relation or an operator. */
const LOOKS_LIKE_TEX = /\\[a-zA-Z]+|[\^_=<>+]/

/** A math marker as Unicode text, or undefined when `marker` is no formula. */
function mathOf(marker: string): string | undefined {
	const math = MATH_MARKER_RE.exec(marker)
	// "\[1\]" is an escaped "[1]", not math: brackets need TeX inside.
	if (!math || (math[2] !== undefined && !LOOKS_LIKE_TEX.test(math[2]))) {
		return undefined
	}
	return texToUnicode(math[1] ?? math[2] ?? math[3] ?? "")
}

function withMath(text: string): string {
	return text.replace(NESTED_MATH_RE, (marker) => mathOf(marker) ?? marker)
}

function tokenizeInline(line: string): Token[] {
	try {
		const tokens: Token[] = []
		let remaining = line
		let match: RegExpExecArray | null

		while ((match = INLINE_MARKER_RE.exec(remaining)) !== null) {
			const marker = match[1] ?? ""
			const before = remaining.slice(0, match.index)
			if (before) {
				tokens.push({ text: before })
			}

			const math = mathOf(marker)
			if (math !== undefined) {
				tokens.push({ kind: "math", text: math })
			} else if (MATH_MARKER_RE.test(marker)) {
				tokens.push({ text: marker })
			} else if (marker.startsWith("**")) {
				tokens.push({ kind: "bold", text: withMath(marker.slice(2, -2)) })
			} else if (marker.startsWith("*")) {
				tokens.push({ kind: "italic", text: withMath(marker.slice(1, -1)) })
			} else if (marker.startsWith("_")) {
				tokens.push({ kind: "italic", text: withMath(marker.slice(1, -1)) })
			} else if (marker.startsWith("`")) {
				tokens.push({ kind: "code", text: marker.slice(1, -1) })
			} else if (marker.startsWith("~~")) {
				tokens.push({ kind: "strike", text: withMath(marker.slice(2, -2)) })
			} else if (marker.startsWith("[")) {
				tokens.push({ kind: "linkText", text: withMath(marker.slice(1, marker.indexOf("]"))) })
				const urlStart = marker.indexOf("(") + 1
				const urlEnd = marker.lastIndexOf(")")
				if (urlStart > 0 && urlEnd > urlStart) {
					tokens.push({ kind: "linkUrl", text: marker.slice(urlStart, urlEnd) })
				}
			} else {
				// Unknown marker shape — render literally
				tokens.push({ text: marker })
			}

			remaining = remaining.slice(match.index + marker.length)
		}

		if (remaining) {
			tokens.push({ text: remaining })
		}

		return tokens
	} catch {
		// Malformed match — fall back to raw line
		return [{ text: line }]
	}
}

/**
 * `faint` recedes every token, code and links included, which is what the SGR
 * dim on a blockquote used to promise and VTE never drew (theme.dimmed).
 */
function renderTokens(tokens: Token[], dimColor: boolean, faint = false): ReactNode {
	const shade = (color: string) => (faint ? theme.dimmed(color) : color)
	try {
		return tokens.map((token, index) => {
			const baseColor = shade(dimColor ? theme.secondaryText : theme.text)
			switch (token.kind) {
				case "bold":
					return (
						<Text key={index} bold color={baseColor}>
							{token.text}
						</Text>
					)
				case "italic":
					return (
						<Text key={index} italic color={baseColor}>
							{token.text}
						</Text>
					)
				case "code":
					return (
						<Text key={index} color={shade(theme.code)}>
							{token.text}
						</Text>
					)
				case "math":
					return (
						<Text key={index} italic color={baseColor}>
							{token.text}
						</Text>
					)
				case "strike":
					return (
						<Text key={index} strikethrough color={baseColor}>
							{token.text}
						</Text>
					)
				case "linkText":
					return (
						<Text key={index} color={shade(theme.suggestion)}>
							{token.text}
						</Text>
					)
				case "linkUrl":
					return (
						<Text key={index} color={theme.faint}>
							{" "}
							({token.text})
						</Text>
					)
				default:
					return (
						<Text key={index} color={baseColor}>
							{token.text}
						</Text>
					)
			}
		})
	} catch {
		// Malformed token rendering — fall back to raw text
		return (
			<Text color={shade(dimColor ? theme.secondaryText : theme.text)}>
				{tokens.map((token) => token.text).join("")}
			</Text>
		)
	}
}

/**
 * Inline formatting (bold, code, links...) for the content of a block element.
 * List items, blockquotes and headings used to print their content raw, so
 * `- **Plik:** opis` reached the screen with the asterisks still in it
 * (plan: 2026-09-22 inline markdown in CLI list items).
 */
function renderInline(text: string, dimColor: boolean, faint = false): ReactNode {
	return renderTokens(tokenizeInline(text), dimColor, faint)
}

/**
 * Base text color for a line, honoring the dimColor (thinking-style) mode.
 */
function baseTextColor(dimColor: boolean): string {
	return dimColor ? theme.secondaryText : theme.text
}

/**
 * Render a single line of markdown text. Each transform is isolated in
 * try/catch and falls back to the raw line so malformed input never throws.
 */
function renderLine(line: string, dimColor: boolean): ReactNode {
	try {
		// Fenced code block opener/closer
		const fenceMatch = line.match(/^\s*(```|~~~)(\S*)?$/)
		if (fenceMatch) {
			return <Text color={theme.faint}>{fenceMatch[2] ? `lang: ${fenceMatch[2]}` : ""}</Text>
		}

		// Heading
		const headingMatch = line.match(/^(#{1,4}) (.*)$/)
		if (headingMatch) {
			const level = headingMatch[1]?.length ?? 0
			const content = headingMatch[2] ?? ""
			const base = baseTextColor(dimColor)
			if (level === 1) {
				return (
					<Text bold underline color={base}>
						{renderInline(content, dimColor)}
					</Text>
				)
			}
			return (
				<Text bold color={base}>
					{renderInline(content, dimColor)}
				</Text>
			)
		}

		// Unordered list — render with a literal bullet prefix
		const bulletMatch = line.match(/^\s*(-|\*|\+)\s+(.*)$/)
		if (bulletMatch) {
			return (
				<Text color={dimColor ? theme.secondaryText : theme.text}>
					{"  • "}
					{renderInline(bulletMatch[2] ?? "", dimColor)}
				</Text>
			)
		}

		// Ordered list — preserve the number with hanging indent
		const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
		if (orderedMatch) {
			return (
				<Text color={dimColor ? theme.secondaryText : theme.text}>
					{"  "}
					{orderedMatch[1]}. {renderInline(orderedMatch[2] ?? "", dimColor)}
				</Text>
			)
		}

		// Blockquote
		const quoteMatch = line.match(/^\s*>\s?(.*)$/)
		if (quoteMatch) {
			return (
				<Text color={theme.faint}>
					{figures.blockquote} {renderInline(quoteMatch[1] ?? "", true, true)}
				</Text>
			)
		}

		// Horizontal rule
		if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
			return (
				<Text color={theme.faint}>
					{"───".repeat(13)} {/* 39 dashes, kept under 40 wide */}
				</Text>
			)
		}

		// Table separator row (`|---|:--:|`) becomes dim spacing.
		//
		// The test has to be this strict. An earlier version asked only whether
		// the line contained a pipe AND anything of `-:|` survived stripping the
		// punctuation — and the pipe itself always survives, so EVERY line with a
		// pipe in it was blanked out: shell commands, prose mentioning
		// `grep foo | head`, table content rows. That is what left bare bullets in
		// the transcript (plan: 2026-09-22 empty bullets in the CLI transcript).
		//
		// Content rows still fall through to the inline tokenizer and print
		// verbatim, which is what this component's doc comment promises.
		const trimmedLine = line.trim()
		const isTableBoundary = trimmedLine.includes("|") && trimmedLine.includes("-") && /^[|\s:-]+$/.test(trimmedLine)
		if (isTableBoundary) {
			return (
				<Text color={theme.faint}>
					{"	"}
					{"　"}
				</Text>
			)
		}

		// Plain inline-formatting line
		return <Text color={dimColor ? theme.secondaryText : theme.text}>{renderInline(line, dimColor)}</Text>
	} catch {
		// Any failure — render the raw line verbatim
		return <Text color={dimColor ? theme.secondaryText : theme.text}>{line}</Text>
	}
}

/** A display formula filling a line: `$$...$$` (1) or `\[...\]` (2). */
const DISPLAY_MATH_LINE_RE = /^\s*(?:\$\$([^$]+)\$\$|\\\[(.+)\\\])\s*$/

/** The opening of a display formula over several lines: `$$` or `\[`, then maybe its first TeX. */
const DISPLAY_MATH_OPEN_RE = /^\s*(\$\$|\\\[)(.*)$/

/** A line that is nothing but an image: `![alt](src)`, optionally with a title. */
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)\s*$/

/**
 * An image on a line of its own, drawn where the terminal can (plan:
 * 2026-10-12 cli inline images). Elsewhere it reads `[image: alt] src`; an
 * embedded `data:` image is not spelled out.
 */
function MarkdownImage({ alt, src }: { alt: string; src: string }) {
	const where = src.startsWith("data:") ? "(embedded)" : src
	const fallback = (
		<Text color={theme.faint}>
			[image{alt ? `: ${alt}` : ""}] {where}
		</Text>
	)
	return <InlineImage source={{ kind: "file", src }} fallback={fallback} />
}

interface MarkdownProps {
	children: string
	dimColor?: boolean
}

/**
 * Minimal line-based markdown renderer (no dependencies).
 * Supports bold, italic, inline code, strikethrough, headings (1-4),
 * unordered/ordered lists, blockquotes, fenced code blocks, links and
 * horizontal rules, images on a line of their own, ```mermaid diagrams and
 * math (`$...$` and `\(...\)` as text, `$$...$$` and `\[...\]` blocks).
 * Tables and unknown structures pass through verbatim.
 * Never throws on malformed input — each line falls back to raw text.
 */
function Markdown({ children, dimColor = false }: MarkdownProps) {
	try {
		const lines = children.split("\n")
		const rendered: ReactNode[] = []

		let i = 0
		while (i < lines.length) {
			const line = lines[i]

			// Fenced code block: group indented lines after the opener
			const fenceMatch = (line ?? "").match(/^\s*(```|~~~)(\S*)?$/)
			if (fenceMatch) {
				const fence = fenceMatch[1] ?? "```"
				const lang = fenceMatch[2] || ""
				const block: string[] = []
				i += 1
				while (i < lines.length) {
					const inner = lines[i] ?? ""
					const closing = inner.match(new RegExp(`^\\s*(${escapeRegExp(fence)})`))
					if (closing) {
						break
					}
					block.push(inner)
					i += 1
				}

				const closed = i < lines.length
				const code = (
					<Box key={`fence-${rendered.length}`} flexDirection="column">
						{lang && <Text color={theme.faint}>{lang}</Text>}
						{block.map((codeLine, codeIndex) => (
							<Box key={codeIndex} paddingLeft={2}>
								<Text color={theme.secondaryText}>{codeLine}</Text>
							</Box>
						))}
					</Box>
				)
				// A diagram only once its fence is closed: while it streams, the
				// source is incomplete and laying it out on every chunk is wasted.
				rendered.push(
					lang === "mermaid" && closed ? (
						<MermaidBlock key={`fence-${rendered.length}`} source={block.join("\n")} fallback={code} />
					) : (
						code
					),
				)
				i += 1
				continue
			}

			const mathLine = (line ?? "").match(DISPLAY_MATH_LINE_RE)
			if (mathLine && (mathLine[2] === undefined || LOOKS_LIKE_TEX.test(mathLine[2]))) {
				rendered.push(<MathBlock key={i} tex={mathLine[1] ?? mathLine[2] ?? ""} closed />)
				i += 1
				continue
			}

			// A formula over several lines; while it streams, the closing line has
			// not arrived and the formula shows as text.
			const mathOpen = (line ?? "").match(DISPLAY_MATH_OPEN_RE)
			const closer = mathOpen?.[1] === "$$" ? "$$" : "\\]"
			// "$$a$$ and $$b$$" closes on its own line: inline math, below.
			if (mathOpen && !(mathOpen[2] ?? "").includes(closer)) {
				const body = [mathOpen[2] ?? ""]
				let j = i + 1
				while (j < lines.length && !(lines[j] ?? "").includes(closer)) {
					body.push(lines[j] ?? "")
					j += 1
				}
				const closed = j < lines.length
				if (closed) {
					body.push((lines[j] ?? "").slice(0, (lines[j] ?? "").indexOf(closer)))
				}
				const tex = body.join("\n").trim()
				if (closer === "$$" || LOOKS_LIKE_TEX.test(tex)) {
					rendered.push(<MathBlock key={i} tex={tex} closed={closed} />)
					i = j + 1
					continue
				}
			}

			const imageMatch = (line ?? "").match(IMAGE_LINE_RE)
			if (imageMatch) {
				rendered.push(<MarkdownImage key={i} alt={imageMatch[1] ?? ""} src={imageMatch[2] ?? ""} />)
				i += 1
				continue
			}

			rendered.push(<Text key={i}>{renderLine(line ?? "", dimColor)}</Text>)
			i += 1
		}

		return <Box flexDirection="column">{rendered}</Box>
	} catch {
		// Fatal failure — render raw children as plain text
		return (
			<Box flexDirection="column">
				<Text color={dimColor ? theme.secondaryText : theme.text}>{children}</Text>
			</Box>
		)
	}
}

export default memo(Markdown)
