import fs from "fs"
import path from "path"
import { useContext, useMemo, type ReactNode } from "react"
import { Text, useWindowSize } from "ink"

import { debugLog } from "@tumble-code/core/cli"

import { GraphicsContext, useImageProtocol, type GraphicsSettings } from "./GraphicsContext.js"
import {
	encodeImage,
	imageFileSize,
	MAX_IMAGE_PIXELS,
	placeImage,
	rasterizeSvg,
	wrapBitmapInSvg,
	type ImageBox,
	type PixelSize,
} from "./imageEncoding.js"
import { markerFor, registerImage } from "./inlineImages.js"

/** What to draw: an image file (a path or a `data:` URL) or an SVG document. */
export type ImageSource = { kind: "file"; src: string } | { kind: "svg"; svg: string; size: PixelSize; id: string }

/**
 * Columns kept free next to an image: the transcript's gutter on the left
 * and one column on the right, so the image never touches the terminal edge.
 */
const GUTTER_COLUMNS = 4

/** An image never takes more than this many rows, however tall the terminal. */
const MAX_IMAGE_ROWS = 40

/** A larger image file is not read at all: it is read in one go, on the render path. */
const MAX_IMAGE_FILE_BYTES = 32 * 1024 * 1024

/** The bytes of an image file, from a path relative to the workspace or a `data:` URL. */
function readImageBytes(src: string, baseDir: string): Uint8Array | undefined {
	const data = src.match(/^data:image\/[\w.+-]+;base64,(.+)$/)
	if (data?.[1]) {
		return Buffer.from(data[1], "base64")
	}
	if (/^[a-z][\w+.-]*:\/\//i.test(src)) {
		// A remote image: fetching it is not something printing an answer should do.
		return undefined
	}
	const file = path.resolve(baseDir, src.startsWith("file://") ? new URL(src).pathname : src)
	const stat = fs.statSync(file, { throwIfNoEntry: false })
	return stat?.isFile() && stat.size <= MAX_IMAGE_FILE_BYTES ? fs.readFileSync(file) : undefined
}

/**
 * Encode `source` for the terminal and register it. Returns the marker that
 * stands for it in the transcript, or undefined when it cannot be drawn
 * (missing file, unknown format, a renderer error), so the caller shows its
 * text fallback instead.
 */
export function prepareImage(source: ImageSource, graphics: GraphicsSettings, box: ImageBox): string | undefined {
	const protocol = graphics.protocol
	if (!protocol) {
		return undefined
	}
	const id = source.kind === "file" ? `file:${path.resolve(graphics.baseDir, source.src)}` : `svg:${source.id}`
	const key = `${protocol}|${box.maxColumns}x${box.maxRows}|${id}`
	const existing = markerFor(key)
	if (existing) {
		return existing
	}

	try {
		const bytes = source.kind === "file" ? readImageBytes(source.src, graphics.baseDir) : undefined
		const header = bytes ? imageFileSize(bytes) : undefined
		if (header && header.width * header.height > MAX_IMAGE_PIXELS) {
			return undefined
		}
		const natural = source.kind === "file" ? header : source.size
		const placement = natural ? placeImage(natural, box, graphics) : undefined
		if (!placement) {
			return undefined
		}

		// A bitmap is drawn by an SVG that scales it to the placement.
		const svg = source.kind === "svg" ? source.svg : wrapBitmapInSvg(bytes!, header!.mime, placement)
		const raster = rasterizeSvg(svg, placement.width)
		const known = graphics.cellSizeKnown
		return registerImage(key, {
			sequence: encodeImage(protocol, raster, {
				movesCursor: !known,
				background: graphics.background,
				colors: graphics.colors,
			}),
			rows: known ? Math.ceil(raster.height / graphics.cellHeight) : undefined,
		})
	} catch (error) {
		debugLog("[CLI] image could not be drawn", error instanceof Error ? error.message : String(error))
		return undefined
	}
}

interface InlineImageProps {
	source: ImageSource
	/** What to show where the image cannot be drawn: the live tail, a text-only terminal, a failure. */
	fallback: ReactNode
}

/**
 * An image in the transcript: drawn in the printed scrollback of a terminal
 * that supports images, `fallback` everywhere else.
 */
export function InlineImage({ source, fallback }: InlineImageProps) {
	const graphics = useContext(GraphicsContext)
	const protocol = useImageProtocol()
	const { columns, rows } = useWindowSize()

	const marker = useMemo(() => {
		if (!protocol) {
			return undefined
		}
		const box = {
			maxColumns: columns - GUTTER_COLUMNS,
			maxRows: Math.min(MAX_IMAGE_ROWS, rows - 4),
		}
		return prepareImage(source, graphics, box)
	}, [protocol, source, graphics, columns, rows])

	return marker ? <Text>{marker}</Text> : <>{fallback}</>
}
