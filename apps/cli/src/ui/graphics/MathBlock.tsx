import { createHash } from "crypto"
import { useContext, useMemo } from "react"
import { Box, Text } from "ink"

import * as theme from "../theme.js"
import { texToUnicode } from "../utils/texToUnicode.js"

import { GraphicsContext, useImageProtocol } from "./GraphicsContext.js"
import { InlineImage } from "./InlineImage.js"
import { renderMathImage } from "./math.js"
import { foregroundFor } from "./mermaid.js"

/** The background a formula is drawn for when the terminal did not report its own. */
const DEFAULT_BACKGROUND = "#000000"

/**
 * The formula's em in terminal rows: a little under a row, so its letters
 * come out about as large as the transcript's.
 */
const EM_PER_ROW = 0.85

interface MathBlockProps {
	tex: string
	/** False while the formula still streams: it is shown as text until it is complete. */
	closed: boolean
}

/**
 * A display formula (`$$...$$`, `\[...\]`; plan: 2026-10-12 cli math): an
 * image in the printed transcript of a terminal that draws images, the
 * formula in Unicode text everywhere else (the live tail, text-only
 * terminals, TeX that MathJax rejects).
 */
export function MathBlock({ tex, closed }: MathBlockProps) {
	const graphics = useContext(GraphicsContext)
	const protocol = useImageProtocol()

	const textView = (
		<Box paddingLeft={2}>
			<Text color={theme.text}>{texToUnicode(tex)}</Text>
		</Box>
	)

	const background = graphics.background ?? DEFAULT_BACKGROUND
	const image = useMemo(() => {
		if (!protocol || !closed) {
			return undefined
		}
		const rendered = renderMathImage(tex, foregroundFor(background), graphics.cellHeight * EM_PER_ROW)
		if (!rendered) {
			return undefined
		}
		return {
			kind: "svg" as const,
			svg: rendered.svg,
			size: rendered.size,
			id: createHash("sha1").update(`${background}\n${graphics.cellHeight}\n${tex}`).digest("hex"),
		}
	}, [protocol, closed, tex, background, graphics.cellHeight])

	return image ? <InlineImage source={image} fallback={textView} /> : textView
}
