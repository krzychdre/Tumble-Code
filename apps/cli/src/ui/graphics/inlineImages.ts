import stringWidth from "string-width"

/**
 * Images in the printed transcript (plan: 2026-10-12 cli inline images).
 *
 * Ink cannot carry an image: it measures every string it prints and wraps
 * whatever is wider than its box, and an image sequence is tens of kilobytes
 * on one "line". So the transcript holds a short marker instead, and the
 * stdout wrapper (`imageStdout.ts`) swaps the marker for the image as
 * the text goes out, together with the cursor moves that make room for it.
 *
 * Only `<Static>` output may carry markers. Ink prints it once and never
 * repaints it, so the image stays where it was drawn. The dynamic tail is
 * repainted on every frame, and an image there would be drawn over and over
 * and leave remnants behind when the tail shrinks.
 *
 * Images are kept for the whole session: ink sometimes clears the screen and
 * prints the entire static output again, markers included.
 */

interface RegisteredImage {
	/** The escape sequence that draws the image. */
	sequence: string
	/**
	 * Rows the image covers, when the cell size is known. Without it the
	 * terminal moves the cursor past the image itself (see `expandMarker`).
	 */
	rows?: number
}

/** Private use characters: no text the transcript shows contains them. */
const MARKER_OPEN = "\uE000"
const MARKER_CLOSE = "\uE001"
const MARKER_RE = /\uE000([0-9a-z]+)\uE001/g

const images = new Map<string, RegisteredImage>()
const idsByKey = new Map<string, string>()

/**
 * Register an image and get the marker that stands for it. `key` identifies
 * the image and the size it was drawn at, so printing the same message again
 * (a ctrl+o reprint) reuses the sequence instead of encoding it again.
 */
export function registerImage(key: string, image: RegisteredImage): string {
	let id = idsByKey.get(key)
	if (!id) {
		id = (images.size + 1).toString(36)
		images.set(id, image)
		idsByKey.set(key, id)
	}
	return `${MARKER_OPEN}${id}${MARKER_CLOSE}`
}

/** The marker of an image registered under `key`, if there is one. */
export function markerFor(key: string): string | undefined {
	const id = idsByKey.get(key)
	return id ? `${MARKER_OPEN}${id}${MARKER_CLOSE}` : undefined
}

/** Forget every image; for tests. */
export function resetInlineImages(): void {
	images.clear()
	idsByKey.clear()
}

const ESC = "\x1b"
const up = (rows: number) => `${ESC}[${rows}A`
const down = (rows: number) => `${ESC}[${rows}B`
const toColumn = (column: number) => `${ESC}[${column + 1}G`

/**
 * What a marker at `column` turns into:
 *
 * 1. Line feeds for the rows below the first, then back up. A line feed
 *    scrolls the screen when the cursor is on the bottom row, so this makes
 *    sure all the rows exist before anything is drawn; an image drawn into
 *    rows that are not there would scroll the screen by itself, and each
 *    protocol does that differently.
 * 2. Save the cursor, draw, restore. Each protocol leaves the cursor in a
 *    different place after an image; restoring puts it back at the top left
 *    corner of the image whatever the protocol did.
 * 3. Down to the image's last row. The line feed ink writes after the marker
 *    then lands on the first row below the image.
 *
 * When the rows are not known (the terminal did not report its cell size),
 * reserving would guess, and a wrong guess leaves a gap or draws over the
 * text below. The image is then drawn alone and the terminal moves the cursor
 * past it, scrolling as needed; terminals differ by at most a blank row in
 * where they leave it.
 */
export function expandMarker(image: RegisteredImage, column: number): string {
	if (image.rows === undefined) {
		return image.sequence
	}
	const below = image.rows - 1
	const reserve = below > 0 ? "\n".repeat(below) + up(below) + toColumn(column) : ""
	const after = below > 0 ? down(below) + toColumn(column) : ""
	return `${reserve}${ESC}7${image.sequence}${ESC}8${after}`
}

/** The column a marker starts at: the width of the text before it on its line. */
function columnOf(data: string, index: number): number {
	const lineStart = data.lastIndexOf("\n", index - 1) + 1
	return stringWidth(data.slice(lineStart, index))
}

/** Replace every image marker in `data` with the image. Unknown markers vanish. */
export function expandImageMarkers(data: string): string {
	if (!data.includes(MARKER_OPEN)) {
		return data
	}
	return data.replace(MARKER_RE, (_marker, id: string, offset: number) => {
		const image = images.get(id)
		return image ? expandMarker(image, columnOf(data, offset)) : ""
	})
}
