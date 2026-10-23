import { createHash } from "crypto"
import { useContext, useMemo, type ReactNode } from "react"
import { Text, useWindowSize } from "ink"

import * as theme from "../theme.js"

import { GraphicsContext, useImageProtocol } from "./GraphicsContext.js"
import { InlineImage } from "./InlineImage.js"
import { renderMermaidImage, renderMermaidText } from "./mermaid.js"

/** Columns the transcript takes for its gutter and margin (as in `InlineImage`). */
const GUTTER_COLUMNS = 4

/** The background a diagram is drawn for when the terminal did not report its own. */
const DEFAULT_BACKGROUND = "#000000"

/**
 * Pixel height of a terminal row the diagram's own text size suits. Diagrams
 * are scaled by the terminal's row height over this, so their text comes out
 * about as large as the transcript's (a HiDPI terminal has 35-pixel rows).
 */
const DIAGRAM_ROW_HEIGHT = 18

interface MermaidBlockProps {
	source: string
	/** The fenced code block, for a diagram that cannot be drawn either way. */
	fallback: ReactNode
}

/**
 * A ```mermaid block (plan: 2026-10-12 cli mermaid diagrams): an image in
 * the printed transcript of a terminal that draws images, the diagram in
 * box-drawing characters everywhere else (the live tail, text-only
 * terminals), and the code itself when neither works.
 */
export function MermaidBlock({ source, fallback }: MermaidBlockProps) {
	const graphics = useContext(GraphicsContext)
	const protocol = useImageProtocol()
	const columns = useWindowSize().columns - GUTTER_COLUMNS

	const text = useMemo(() => renderMermaidText(source, columns), [source, columns])
	const textView = text ? (
		<Text color={theme.text} wrap="truncate-end">
			{text}
		</Text>
	) : (
		fallback
	)

	const background = graphics.background ?? DEFAULT_BACKGROUND
	const image = useMemo(() => {
		if (!protocol) {
			return undefined
		}
		const rendered = renderMermaidImage(source, background)
		if (!rendered) {
			return undefined
		}
		const scale = Math.max(1, graphics.cellHeight / DIAGRAM_ROW_HEIGHT)
		return {
			kind: "svg" as const,
			svg: rendered.svg,
			size: { width: rendered.size.width * scale, height: rendered.size.height * scale },
			id: createHash("sha1").update(`${background}\n${source}`).digest("hex"),
		}
	}, [protocol, source, background, graphics.cellHeight])

	return image ? <InlineImage source={image} fallback={textView} /> : textView
}
