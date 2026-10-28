import { describe, expect, it } from "vitest"

import { createDockedStdout } from "../dockedStdout.js"

/**
 * Chunk fixtures imitate the byte stream captured from ink 8's incremental
 * renderer on a real PTY: inert cursor/sync markers, log.clear()'s erase or
 * empty write, the static lines, then the frame as one full text write.
 */

const ERASE_5 = "\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G"
const WIPE = "\x1b[2J\x1b[3J\x1b[H"
const FRAME_4 = "╭────╮\n│spin│\n│❯ in│\n╰────╯\n"

function fakeStream(rows: number) {
	const writes: unknown[] = []
	let resizeListener: (() => void) | undefined
	const stream = {
		rows,
		write(chunk: unknown): boolean {
			writes.push(chunk)
			return true
		},
		on(_event: string, listener: () => void) {
			resizeListener = listener
		},
	} as unknown as NodeJS.WriteStream
	return {
		stream,
		writes,
		resizeTo(n: number) {
			stream.rows = n
			resizeListener?.()
		},
	}
}

function writeAll(stdout: NodeJS.WriteStream, chunks: string[]): void {
	for (const chunk of chunks) stdout.write(chunk)
}

describe("createDockedStdout", () => {
	it("docks a fresh frame to the bottom of the screen", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		writeAll(stdout, ["\x1b[?2026h", "", "msg0\n", "\x1b[?25l", FRAME_4, "\x1b[?2026l"])
		// Statics end on row 2; the 4-row frame is positioned to start on row 8.
		expect(writes).toEqual(["\x1b[?2026h", "", "msg0\n", "\x1b[?25l", "\x1b[8;1H" + FRAME_4, "\x1b[?2026l"])
	})

	it("recognizes statics that begin with color codes", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		writeAll(stdout, ["", "\x1b[36mmsg0\x1b[0m\n", FRAME_4])
		expect(writes[2]).toBe("\x1b[8;1H" + FRAME_4)
	})

	it("injects nothing once the transcript has pushed the frame to its target row", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		// First burst: statics on rows 1-2, frame docked to rows 8-11.
		writeAll(stdout, ["", "msg0\n", FRAME_4])
		// Second burst: erase moves to the frame's top row, the new static
		// line ends on row 9, and the frame would start there naturally.
		writeAll(stdout, [ERASE_5, "message-1\n", FRAME_4])
		expect(writes).toEqual(["", "msg0\n", "\x1b[8;1H" + FRAME_4, ERASE_5, "message-1\n", FRAME_4])
	})

	it("injects nothing when the frame would not fit below the cursor", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		// A tall statics burst leaves the cursor at the bottom: the terminal
		// scrolls naturally and the frame must not be re-positioned.
		writeAll(stdout, ["", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\n", FRAME_4])
		expect(writes[2]).toBe(FRAME_4)
	})

	it("passes frame diffs and stray text through untouched", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		writeAll(stdout, ["", "msg0\n", FRAME_4])
		writes.length = 0
		writeAll(stdout, ["\x1b[4A\x1b[E\x1b[12G\x1b[K2", "console noise\n", "\x1b[?25h"])
		expect(writes).toEqual(["\x1b[4A\x1b[E\x1b[12G\x1b[K2", "console noise\n", "\x1b[?25h"])
	})

	it("re-arms after a terminal wipe (/clear)", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		writeAll(stdout, ["", "msg0\n", FRAME_4])
		writes.length = 0
		writeAll(stdout, [WIPE, "fresh-0\n", FRAME_4])
		// The wipe homes the cursor; statics end on row 2 again.
		expect(writes).toEqual([WIPE, "fresh-0\n", "\x1b[8;1H" + FRAME_4])
	})

	it("docks to the new height after a resize once new statics arrive", () => {
		const { stream, writes, resizeTo } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		writeAll(stdout, ["", "msg0\n", FRAME_4])
		writes.length = 0
		resizeTo(16)
		stdout.write(WIPE)
		writeAll(stdout, ["fresh statics\n", FRAME_4])
		expect(writes).toEqual([WIPE, "fresh statics\n", "\x1b[12;1H" + FRAME_4])
	})

	it("passes non-string chunks through untouched", () => {
		const { stream, writes } = fakeStream(12)
		const stdout = createDockedStdout(stream)
		const buffer = Buffer.from("raw")
		stdout.write(buffer)
		expect(writes).toEqual([buffer])
	})
})
