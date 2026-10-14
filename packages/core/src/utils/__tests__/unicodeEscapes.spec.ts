import { decodeLiteralUnicodeEscapes } from "../unicodeEscapes.js"

describe("decodeLiteralUnicodeEscapes", () => {
	it("decodes the Polish text of task 01a134d6", () => {
		expect(decodeLiteralUnicodeEscapes("Dok\\u0142adnie tak, w kt\\u00f3rym si\\u0119 od\\u015bwie\\u017ca")).toBe(
			"Dokładnie tak, w którym się odświeża",
		)
	})

	it("returns the same string when there is no escape", () => {
		const text = "Zażółć gęślą jaźń \\n"
		expect(decodeLiteralUnicodeEscapes(text)).toBe(text)
	})

	it("decodes uppercase hex and a surrogate pair", () => {
		expect(decodeLiteralUnicodeEscapes("\\u0141\\u00D3D\\u017A \\ud83d\\ude00")).toBe("ŁÓDź 😀")
	})

	it("keeps ASCII escapes and lone surrogates as written", () => {
		expect(decodeLiteralUnicodeEscapes("say \\u0022hi\\u0022 \\ud83d alone")).toBe(
			"say \\u0022hi\\u0022 \\ud83d alone",
		)
	})

	it("keeps an escape whose backslash is escaped", () => {
		expect(decodeLiteralUnicodeEscapes("path \\\\u0142")).toBe("path \\\\u0142")
	})

	it("keeps escapes inside inline code and fenced blocks", () => {
		const text = 'Use `"\\u0142"` here.\n```js\nconst l = "\\u0142"\n```\nbut decode wy\\u0142\\u0105cznie'
		expect(decodeLiteralUnicodeEscapes(text)).toBe(
			'Use `"\\u0142"` here.\n```js\nconst l = "\\u0142"\n```\nbut decode wyłącznie',
		)
	})

	it("keeps escapes inside an unclosed fence", () => {
		const text = "zrobione\n```\nx = '\\u0142'"
		expect(decodeLiteralUnicodeEscapes(text)).toBe(text)
	})
})
