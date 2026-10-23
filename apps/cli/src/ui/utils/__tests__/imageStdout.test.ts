import { EventEmitter } from "events"

import { registerImage, resetInlineImages } from "../../graphics/inlineImages.js"
import { createImageStdout } from "../imageStdout.js"

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
	const wrapped = createImageStdout(stream as unknown as NodeJS.WriteStream)
	return { stream, wrapped }
}

describe("createImageStdout", () => {
	beforeEach(() => resetInlineImages())

	it("draws the image in place of its marker", () => {
		const { stream, wrapped } = wrap()
		const marker = registerImage("a", { sequence: "IMG", rows: 1 })
		wrapped.write(`\x1b[1Gbefore ${marker}\n`)

		expect(stream.chunks).toEqual(["\x1b[1Gbefore \x1b7IMG\x1b8\n"])
	})

	it("passes non-string chunks through", () => {
		const { stream, wrapped } = wrap()
		const buffer = Buffer.from("\uE000a\uE001")
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
