/**
 * Wrap `stream` so ink's interactive frame docks to the bottom terminal row
 * (Claude Code behavior) instead of floating right under the transcript.
 *
 * ink 8 with incrementalRendering renders static output in bursts:
 *
 *   log.clear() -> an erase-lines chunk, an empty chunk, or a terminal wipe
 *                  (/clear), then
 *   the promoted static lines as one text chunk, then
 *   the frame as one full fresh write (the log was just reset, so it is
 *   never a diff); its newline count is its row count.
 *
 * Before a fresh frame this wrapper injects an absolute cursor positioning
 * (`rows - frameRows`) so the frame ends on the second-to-last terminal row;
 * ink's trailing newline keeps the cursor on the bottom row. Relative moves
 * in later frame diffs stay correct because the real cursor ends up exactly
 * where ink's relative model expects it: right below the frame.
 *
 * Once the transcript reaches the bottom there is nothing to inject (the
 * frame would start at or above its target row) and the terminal scrolls
 * naturally - Claude Code's steady-state look. Diff-only bursts (no new
 * static lines) never move the frame. After a terminal resize the frame is
 * re-docked by the next statics burst, when ink repositions everything.
 *
 * Only string chunks are tracked; ink never writes buffers.
 */

const ESC = "\x1b"
const INERT_CHUNKS = new Set([
	ESC + "[?2026h", // begin synchronized update
	ESC + "[?2026l", // end synchronized update
	ESC + "[?25l", // hide cursor
	ESC + "[?25h", // show cursor
])
const ERASE_LINE = ESC + "[2K"

// Built via `new RegExp` so the control character stays in a string constant,
// where `no-control-regex` has nothing to flag.
const CSI = new RegExp("^\\[[0-9;?]*[@-~]")
const WIPE = new RegExp(`^${ESC}\\[[23]J`)
const CONTROL = new RegExp(`^${ESC}\\[[0-9;?]*([@-~])`)

/** Cursor row on a fixed-height screen; scrolling clamps at the last row. */
class CursorRow {
	rows: number
	row = 1

	constructor(rows: number) {
		this.rows = rows
	}

	feed(str: string): void {
		let i = 0
		while (i < str.length) {
			const ch = str[i]
			if (ch === "\x1b") {
				const next = str[i + 1]
				if (next === "[") {
					const match = CSI.exec(str.slice(i + 1))
					if (!match) return
					this.csi(match[0].slice(1))
					i += 1 + match[0].length
					continue
				}
				if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
					// OSC / DCS / APC / PM / SOS: skip to ST, or to BEL inside OSC
					const rest = str.slice(i)
					const bel = rest.indexOf("\x07")
					const st = rest.indexOf("\x1b\\")
					const end = bel !== -1 && (st === -1 || bel < st) ? bel + 1 : st === -1 ? -1 : st + 2
					if (end === -1) return
					i += end
					continue
				}
				i += 2
				continue
			}
			if (ch === "\n" && this.row < this.rows) this.row++
			i++
		}
	}

	private csi(seq: string): void {
		const final = seq[seq.length - 1]
		switch (final) {
			case "A": // cursor up
			case "F": // cursor previous line
				this.row = Math.max(1, this.row - Math.max(1, this.param(seq, 1)))
				break
			case "B": // cursor down
			case "E": // cursor next line
				this.row = Math.min(this.rows, this.row + Math.max(1, this.param(seq, 1)))
				break
			case "H": // cursor position
			case "f":
				this.row = Math.min(this.rows, Math.max(1, this.param(seq, 1)))
				break
			case "J": // erase in display: 2J/3J also homes the cursor
				if (this.param(seq, 1) >= 2) this.row = 1
				break
		}
	}

	/** First parameter of the sequence; empty or missing means `dflt`. */
	private param(seq: string, dflt: number): number {
		const first = seq.slice(0, -1).replace(/^\?/, "").split(";")[0]
		const value = Number(first)
		return first === "" || Number.isNaN(value) ? dflt : value
	}
}

/**
 * The burst phases: a statics burst arms on log.clear(), its first text chunk
 * is the static output, and the next one is the frame to dock.
 */
type Phase = "idle" | "cleared" | "statics"

export function createDockedStdout<T extends NodeJS.WriteStream>(stream: T): T {
	const cursor = new CursorRow(stream.rows)

	// Ink re-renders on resize on its own; we only need the new height for
	// the dock math and to keep the tracked row on the screen.
	stream.on("resize", () => {
		cursor.rows = stream.rows
		cursor.row = Math.min(cursor.row, cursor.rows)
	})

	let phase: Phase = "idle"

	const dock = (chunk: string): string => {
		if (INERT_CHUNKS.has(chunk)) return chunk
		if (chunk === "") {
			phase = "cleared" // log.clear() with nothing to erase
			return chunk
		}
		if (chunk.startsWith(ERASE_LINE) || WIPE.test(chunk)) {
			phase = "cleared" // log.clear()'s erase lines, or a terminal wipe (/clear)
			cursor.feed(chunk)
			return chunk
		}
		const match = CONTROL.exec(chunk)
		if (match && match[1] !== "m") {
			phase = "idle" // a frame diff: no statics in this burst
			cursor.feed(chunk)
			return chunk
		}
		if (phase === "cleared") {
			phase = "statics"
			cursor.feed(chunk)
			return chunk
		}
		if (phase === "statics") {
			phase = "idle"
			const frameRows = chunk.split("\n").length - 1
			// Dock when the frame would otherwise start above its target row;
			// at or below it the terminal already scrolls naturally.
			if (frameRows > 0 && cursor.row + frameRows < cursor.rows) {
				const pos = `\x1b[${cursor.rows - frameRows};1H`
				cursor.feed(pos + chunk)
				return pos + chunk
			}
			cursor.feed(chunk)
			return chunk
		}
		cursor.feed(chunk) // stray text between bursts: track, inject nothing
		return chunk
	}

	const write = (chunk: unknown, ...rest: unknown[]): boolean => {
		const data = typeof chunk === "string" ? dock(chunk) : chunk
		return (stream.write as (...args: unknown[]) => boolean)(data, ...rest)
	}

	return new Proxy(stream, {
		get(target, property) {
			if (property === "write") {
				return write
			}
			// Methods must run against the real stream (event emitter state,
			// `columns`/`rows` getters), not against the proxy.
			const value = Reflect.get(target, property, target)
			return typeof value === "function" ? value.bind(target) : value
		},
	})
}
