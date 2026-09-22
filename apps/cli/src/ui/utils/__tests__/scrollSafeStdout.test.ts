import { EventEmitter } from "events"

import { createScrollSafeStdout } from "../scrollSafeStdout.js"

class FakeStream extends EventEmitter {
	chunks: unknown[] = []
	private size = { columns: 80, rows: 24 }
	get columns() {
		return this.size.columns
	}
	get rows() {
		return this.size.rows
	}
	resize(columns: number, rows: number) {
		this.size = { columns, rows }
		this.emit("resize")
	}
	write(chunk: unknown) {
		this.chunks.push(chunk)
		return true
	}
}

function wrap() {
	const stream = new FakeStream()
	const wrapped = createScrollSafeStdout(stream as unknown as NodeJS.WriteStream)
	return { stream, wrapped }
}

describe("createScrollSafeStdout", () => {
	it("turns every cursor-next-line into a scrolling newline", () => {
		const { stream, wrapped } = wrap()
		// The shape of an incremental ink frame: back to the top, skip two
		// unchanged rows, rewrite the third, skip the last.
		wrapped.write("\x1b[4A\x1b[E\x1b[E\x1b[1Gspinner\x1b[K\n\x1b[E")

		expect(stream.chunks).toEqual(["\x1b[4A\r\n\r\n\x1b[1Gspinner\x1b[K\n\r\n"])
	})

	it("leaves other output untouched", () => {
		const { stream, wrapped } = wrap()
		wrapped.write("\x1b[2K\x1b[1A\x1b[2K\x1b[Gplain text\n")

		expect(stream.chunks).toEqual(["\x1b[2K\x1b[1A\x1b[2K\x1b[Gplain text\n"])
	})

	it("passes non-string chunks through", () => {
		const { stream, wrapped } = wrap()
		const buffer = Buffer.from("\x1b[E")
		wrapped.write(buffer)

		expect(stream.chunks).toEqual([buffer])
	})

	it("keeps the real stream's size and events", () => {
		const { stream, wrapped } = wrap()
		const onResize = vi.fn()
		wrapped.on("resize", onResize)

		stream.resize(120, 40)

		expect(onResize).toHaveBeenCalledTimes(1)
		expect(wrapped.columns).toBe(120)
		expect(wrapped.rows).toBe(40)
		wrapped.off("resize", onResize)
		expect(stream.listenerCount("resize")).toBe(0)
	})
})
