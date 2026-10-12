import { expandImageMarkers, expandMarker, markerFor, registerImage, resetInlineImages } from "../inlineImages.js"

beforeEach(() => resetInlineImages())

describe("registerImage", () => {
	it("gives each key one marker and keeps the first sequence", () => {
		const first = registerImage("a", { sequence: "IMG-A", rows: 1 })
		const again = registerImage("a", { sequence: "IMG-A2", rows: 1 })
		const other = registerImage("b", { sequence: "IMG-B", rows: 1 })

		expect(again).toBe(first)
		expect(other).not.toBe(first)
		expect(markerFor("a")).toBe(first)
		expect(expandImageMarkers(first)).toBe("\x1b7IMG-A\x1b8")
	})
})

describe("expandMarker", () => {
	it("reserves the rows below the first, draws from the saved cursor, then ends on the last row", () => {
		expect(expandMarker({ sequence: "IMG", rows: 3 }, 2)).toBe("\n\n\x1b[2A\x1b[3G\x1b7IMG\x1b8\x1b[2B\x1b[3G")
	})

	it("lets the terminal move the cursor when the rows are not known", () => {
		expect(expandMarker({ sequence: "IMG" }, 4)).toBe("IMG")
	})

	it("needs no cursor moves for a one-row image", () => {
		expect(expandMarker({ sequence: "IMG", rows: 1 }, 0)).toBe("\x1b7IMG\x1b8")
	})
})

describe("expandImageMarkers", () => {
	it("starts the image at the column the marker is printed at, ignoring colour codes", () => {
		const marker = registerImage("a", { sequence: "IMG", rows: 2 })
		const out = expandImageMarkers(`text above\n\x1b[90m●\x1b[39m ${marker}\nbelow`)

		expect(out).toBe("text above\n\x1b[90m●\x1b[39m \n\x1b[1A\x1b[3G\x1b7IMG\x1b8\x1b[1B\x1b[3G\nbelow")
	})

	it("drops a marker it does not know and leaves marker-free output alone", () => {
		expect(expandImageMarkers("a\uE000zz\uE001b")).toBe("ab")
		expect(expandImageMarkers("plain")).toBe("plain")
	})
})
