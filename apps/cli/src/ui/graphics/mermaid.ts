import { renderMermaidASCII, renderMermaidSVG } from "beautiful-mermaid"
import stringWidth from "string-width"

import * as theme from "../theme.js"

import type { PixelSize } from "./imageEncoding.js"

/**
 * Mermaid diagrams in answers (plan: 2026-10-12 cli mermaid diagrams).
 *
 * `beautiful-mermaid` lays a diagram out without a browser and gives either
 * an SVG (drawn as an image where the terminal can, see `InlineImage`) or the
 * same diagram in box-drawing characters (everywhere else). It knows
 * flowcharts, state, sequence, class and ER diagrams and XY charts; other
 * kinds throw, and the answer keeps showing the code.
 */

/** Text colour for a diagram on `background`: the theme's on dark, near black on light. */
export function foregroundFor(background: string): string {
	const [r, g, b] = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16) / 255)
	const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
	return luminance < 0.5 ? theme.text : "#27272A"
}

/**
 * The diagram as an SVG with plain colours (see `resolveSvgColors`) and its
 * size in pixels, or undefined when it does not parse.
 */
export function renderMermaidImage(source: string, background: string): { svg: string; size: PixelSize } | undefined {
	try {
		const svg = resolveSvgColors(
			renderMermaidSVG(source, { bg: background, fg: foregroundFor(background), transparent: true }),
		)
		const width = Number(svg.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1])
		const height = Number(svg.match(/<svg[^>]*\sheight="([\d.]+)"/)?.[1])
		return width > 0 && height > 0 ? { svg, size: { width, height } } : undefined
	} catch {
		return undefined
	}
}

/**
 * The diagram in box-drawing characters, or undefined when it does not parse
 * or is wider than `columns`: the terminal would wrap every row and scramble it.
 */
export function renderMermaidText(source: string, columns: number): string | undefined {
	try {
		const text = renderMermaidASCII(source, { colorMode: "none" }).replace(/\s+$/gm, "")
		const widest = Math.max(...text.split("\n").map((line) => stringWidth(line)))
		return text.trim() !== "" && widest <= columns ? text : undefined
	} catch {
		return undefined
	}
}

/**
 * `svg` with every `var(...)` and `color-mix(...)` replaced by the colour it
 * stands for.
 *
 * The SVG keeps its palette in CSS custom properties derived from two colours
 * with `color-mix()`, so a browser can switch themes live. resvg implements
 * neither and paints every such fill black: the first trial run drew black
 * boxes without text or arrows. The definitions are read from the root
 * element's `style` and from the `<style>` blocks, and each use is evaluated
 * against them. The font `@import` goes too: resvg fetches nothing.
 */
export function resolveSvgColors(svg: string): string {
	const definitions = new Map<string, string>()
	for (const match of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"}]+)/g)) {
		definitions.set(match[1]!, match[2]!.trim())
	}

	const resolveIn = (text: string, depth: number): string => {
		let out = ""
		let index = 0
		while (index < text.length) {
			const start = findFunction(text, index)
			if (start === -1) {
				out += text.slice(index)
				break
			}
			const end = closingParen(text, text.indexOf("(", start))
			if (end === -1) {
				out += text.slice(index)
				break
			}
			out += text.slice(index, start)
			out += evaluate(text.slice(start, end + 1), depth) ?? text.slice(start, end + 1)
			index = end + 1
		}
		return out
	}

	const evaluate = (expression: string, depth: number): string | undefined => {
		// Definitions refer to each other; a cycle must not hang the render.
		if (depth > 16) {
			return undefined
		}
		const value = expression.trim()
		if (/^#[0-9a-f]{3,8}$/i.test(value)) {
			return value
		}
		if (value.startsWith("var(")) {
			const [name, fallback] = splitTopLevel(value.slice(4, -1), 1)
			const defined = definitions.get(name!.trim())
			return (
				(defined !== undefined ? evaluate(resolveIn(defined, depth + 1), depth + 1) : undefined) ??
				(fallback !== undefined ? evaluate(resolveIn(fallback, depth + 1), depth + 1) : undefined)
			)
		}
		if (value.startsWith("color-mix(")) {
			const [, first, second] = splitTopLevel(value.slice(10, -1))
			const a = mixPart(first, depth)
			const b = mixPart(second, depth)
			if (!a || !b) {
				return undefined
			}
			const share = a.share ?? (b.share !== undefined ? 100 - b.share : 50)
			const otherShare = b.share ?? 100 - share
			return mix(a.color, b.color, share / (share + otherShare))
		}
		return undefined
	}

	const mixPart = (part: string | undefined, depth: number) => {
		const match = part?.trim().match(/^(.*?)(?:\s+([\d.]+)%)?$/)
		const color = match?.[1] ? evaluate(resolveIn(match[1], depth + 1), depth + 1) : undefined
		return color ? { color, share: match?.[2] !== undefined ? Number(match[2]) : undefined } : undefined
	}

	return resolveIn(svg.replace(/@import[^;]*;/g, ""), 0)
}

function findFunction(text: string, from: number): number {
	const v = text.indexOf("var(", from)
	const m = text.indexOf("color-mix(", from)
	if (v === -1) {
		return m
	}
	return m === -1 ? v : Math.min(v, m)
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function closingParen(text: string, open: number): number {
	let depth = 0
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") {
			depth++
		} else if (text[i] === ")") {
			depth--
			if (depth === 0) {
				return i
			}
		}
	}
	return -1
}

/** Split on commas outside parentheses; at most `limit` splits when given. */
function splitTopLevel(text: string, limit = Infinity): string[] {
	const parts: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (char === "(") {
			depth++
		} else if (char === ")") {
			depth--
		} else if (char === "," && depth === 0 && parts.length < limit) {
			parts.push(text.slice(start, i))
			start = i + 1
		}
	}
	parts.push(text.slice(start))
	return parts
}

function toRgb(hex: string): number[] {
	const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex
	return [1, 3, 5].map((start) => parseInt(full.slice(start, start + 2), 16))
}

/** `a` and `b` mixed in sRGB, `weight` of `a`. */
function mix(a: string, b: string, weight: number): string {
	const [ca, cb] = [toRgb(a), toRgb(b)]
	return `#${ca
		.map((channel, i) => Math.round(channel * weight + cb[i]! * (1 - weight)))
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`
}
