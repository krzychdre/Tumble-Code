import { bandSegments, changeSpans, pairHunkLines, type DiffLine } from "../diffBand.js"

const removed = (content: string): DiffLine => ({ type: "removed", content })
const added = (content: string): DiffLine => ({ type: "added", content })
const context = (content: string): DiffLine => ({ type: "context", content })

describe("changeSpans", () => {
	it("spans the columns between the common prefix and suffix", () => {
		expect(changeSpans("    rsa_keygen_bits:1024", "    rsa_keygen_bits:2048")).toEqual({
			removed: { from: 20, to: 24 },
			added: { from: 20, to: 24 },
		})
	})

	it("gives a pure insertion an empty span on the removed side", () => {
		expect(changeSpans("abc", "abXYc")).toEqual({
			removed: { from: 2, to: 2 },
			added: { from: 2, to: 4 },
		})
	})

	it("does not let the suffix overlap the prefix", () => {
		// "aa" vs "aaa": prefix 2 leaves one column of the longer line.
		expect(changeSpans("aa", "aaa")).toEqual({
			removed: { from: 2, to: 2 },
			added: { from: 2, to: 3 },
		})
	})

	it("returns nothing for identical lines or lines that share nothing", () => {
		expect(changeSpans("same", "same")).toBeUndefined()
		expect(changeSpans("old 0", "new")).toBeUndefined()
	})
})

describe("pairHunkLines", () => {
	it("pairs the k-th removed line with the k-th added line of the run after it", () => {
		const views = pairHunkLines([
			context("keep"),
			removed("foo = 1"),
			removed("bar = 2"),
			added("foo = 9"),
			added("bar = 8"),
			context("keep"),
		])

		expect(views.map((view) => view.change)).toEqual([
			undefined,
			{ from: 6, to: 7 },
			{ from: 6, to: 7 },
			{ from: 6, to: 7 },
			{ from: 6, to: 7 },
			undefined,
		])
	})

	it("leaves the surplus of an uneven run unpaired", () => {
		const views = pairHunkLines([removed("a = 1"), removed("b = 2"), added("a = 3")])

		expect(views[0]!.change).toEqual({ from: 4, to: 5 })
		expect(views[1]!.change).toBeUndefined()
		expect(views[2]!.change).toEqual({ from: 4, to: 5 })
	})

	it("does not pair across a context line", () => {
		const views = pairHunkLines([removed("a = 1"), context("x"), added("a = 2")])

		expect(views.every((view) => view.change === undefined)).toBe(true)
	})
})

describe("bandSegments", () => {
	it("pads a short line to the band width and cuts the changed columns out", () => {
		const band = bandSegments({ line: removed("x = 1"), change: { from: 4, to: 5 } }, 10)

		expect(band).toEqual({ before: "-x = ", changed: "1", after: "    " })
		expect(band.before + band.changed + band.after).toHaveLength(10)
	})

	it("cuts a long line at the width with a trailing ellipsis", () => {
		const band = bandSegments({ line: added("a".repeat(50)) }, 20)

		expect(band.before).toBe(`+${"a".repeat(18)}…`)
		expect(band.changed).toBe("")
		expect(band.after).toBe("")
	})

	it("shifts the band so a change beyond the cut stays in view", () => {
		const prefix = "the quick brown fox jumps over the lazy dog and keeps running on "
		const views = pairHunkLines([removed(`${prefix}red`), added(`${prefix}blue`)])
		const width = 40

		const removedBand = bandSegments(views[0]!, width)
		const addedBand = bandSegments(views[1]!, width)

		// Twelve identical columns are kept before the change, behind an ellipsis.
		expect(removedBand.before).toBe(`-…${prefix.slice(-12)}`)
		expect(removedBand.changed).toBe("red")
		expect(addedBand.before).toBe(`+…${prefix.slice(-12)}`)
		expect(addedBand.changed).toBe("blue")
		for (const band of [removedBand, addedBand]) {
			expect(band.after.trim()).toBe("")
			expect(band.before + band.changed + band.after).toHaveLength(width)
		}
	})

	it("still cuts the end of a shifted band when the change runs past it", () => {
		const prefix = "x".repeat(60)
		const views = pairHunkLines([removed(`${prefix}${"a".repeat(80)}`), added(`${prefix}${"b".repeat(80)}`)])

		const band = bandSegments(views[1]!, 30)

		expect(band.before).toBe(`+…${"x".repeat(12)}`)
		expect(band.changed).toBe("b".repeat(15))
		expect(band.after).toBe("…")
		expect(band.before + band.changed + band.after).toHaveLength(30)
	})

	it("does not shift when the change is already in view", () => {
		const views = pairHunkLines([removed(`a = 1${" ".repeat(60)}`), added(`a = 2${" ".repeat(60)}`)])

		const band = bandSegments(views[0]!, 20)

		expect(band.before).toBe("-a = ")
		expect(band.changed).toBe("1")
		expect(band.after).toBe(`${" ".repeat(13)}…`)
	})

	it("keeps the removed side of a pure insertion aligned with the added side", () => {
		const prefix = "p".repeat(50)
		const views = pairHunkLines([removed(`${prefix}end`), added(`${prefix}NEW end`)])

		const removedBand = bandSegments(views[0]!, 24)
		const addedBand = bandSegments(views[1]!, 24)

		expect(removedBand.before).toBe(`-…${"p".repeat(12)}`)
		expect(removedBand.changed).toBe("")
		expect(removedBand.after).toBe("end       ")
		expect(addedBand.before).toBe(`+…${"p".repeat(12)}`)
		expect(addedBand.changed).toBe("NEW ")
		expect(addedBand.after).toBe("end   ")
	})
})
