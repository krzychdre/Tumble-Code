import { memo, type ReactNode } from "react"
import { Box, Text } from "ink"

import { figures } from "../figures.js"
import * as theme from "../theme.js"

type TokenKind = "bold" | "italic" | "code" | "strike" | "linkText" | "linkUrl"

interface Token {
	kind?: TokenKind
	text: string
}

// `_emphasis_` only at word boundaries, as in CommonMark: otherwise
// `my_var_name` renders as `myvarname` and `__tests__` as `_tests_`.
const INLINE_MARKER_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|(?<![\w])_[^_]+_(?![\w])|`[^`]+`|~~[^~]+~~|\[[^\]]*\]\([^)]*\))/

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

			if (marker.startsWith("**")) {
				tokens.push({ kind: "bold", text: marker.slice(2, -2) })
			} else if (marker.startsWith("*")) {
				tokens.push({ kind: "italic", text: marker.slice(1, -1) })
			} else if (marker.startsWith("_")) {
				tokens.push({ kind: "italic", text: marker.slice(1, -1) })
			} else if (marker.startsWith("`")) {
				tokens.push({ kind: "code", text: marker.slice(1, -1) })
			} else if (marker.startsWith("~~")) {
				tokens.push({ kind: "strike", text: marker.slice(2, -2) })
			} else if (marker.startsWith("[")) {
				tokens.push({ kind: "linkText", text: marker.slice(1, marker.indexOf("]")) })
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

function renderTokens(tokens: Token[], dimColor: boolean): ReactNode {
	try {
		return tokens.map((token, index) => {
			const baseColor = dimColor ? theme.secondaryText : theme.text
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
						<Text key={index} color={theme.code}>
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
						<Text key={index} color={theme.suggestion}>
							{token.text}
						</Text>
					)
				case "linkUrl":
					return (
						<Text key={index} dimColor color={theme.secondaryText}>
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
			<Text color={dimColor ? theme.secondaryText : theme.text}>
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
function renderInline(text: string, dimColor: boolean): ReactNode {
	return renderTokens(tokenizeInline(text), dimColor)
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
			return (
				<Text dimColor color={theme.secondaryText}>
					{fenceMatch[2] ? `lang: ${fenceMatch[2]}` : ""}
				</Text>
			)
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
				<Text dimColor color={theme.secondaryText}>
					{figures.blockquote} {renderInline(quoteMatch[1] ?? "", true)}
				</Text>
			)
		}

		// Horizontal rule
		if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
			return (
				<Text dimColor color={theme.secondaryText}>
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
				<Text dimColor color={theme.secondaryText}>
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

interface MarkdownProps {
	children: string
	dimColor?: boolean
}

/**
 * Minimal line-based markdown renderer (no dependencies).
 * Supports bold, italic, inline code, strikethrough, headings (1-4),
 * unordered/ordered lists, blockquotes, fenced code blocks, links and
 * horizontal rules. Tables and unknown structures pass through verbatim.
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
					const closing = inner.match(new RegExp(`^\\s*(${fence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`))
					if (closing) {
						break
					}
					block.push(inner)
					i += 1
				}

				rendered.push(
					<Box key={`fence-${rendered.length}`} flexDirection="column">
						{lang && (
							<Text dimColor color={theme.secondaryText}>
								{lang}
							</Text>
						)}
						{block.map((codeLine, codeIndex) => (
							<Box key={codeIndex} paddingLeft={2}>
								<Text color={theme.secondaryText}>{codeLine}</Text>
							</Box>
						))}
					</Box>,
				)
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
