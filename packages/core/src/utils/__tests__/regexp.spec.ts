import { escapeRegExp } from "../regexp.js"

describe("escapeRegExp", () => {
	it("escapes every metacharacter so the text matches itself", () => {
		const text = "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o"
		expect(escapeRegExp(text)).toBe("a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o")
		expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true)
	})

	it("leaves plain text and the slash alone", () => {
		expect(escapeRegExp("src/app-1_x")).toBe("src/app-1_x")
	})
})
