import { splitSearchQuery, splitWebUrl } from "../webToolText"

describe("splitSearchQuery", () => {
	it("keeps a plain query as one text part", () => {
		expect(splitSearchQuery("URL Rewrite 2.1 x64 1603")).toEqual([
			{ kind: "text", text: "URL Rewrite 2.1 x64 1603" },
		])
	})

	it("separates quoted phrases, site: prefixes and boolean words", () => {
		expect(splitSearchQuery('TIA "URLRewrite2" site:siemens.com OR site:elektroda.pl')).toEqual([
			{ kind: "text", text: "TIA " },
			{ kind: "quote", text: '"URLRewrite2"' },
			{ kind: "text", text: " " },
			{ kind: "operator", text: "site:" },
			{ kind: "text", text: "siemens.com " },
			{ kind: "operator", text: "OR" },
			{ kind: "text", text: " " },
			{ kind: "operator", text: "site:" },
			{ kind: "text", text: "elektroda.pl" },
		])
	})

	it("leaves lowercase or, unknown prefixes and colons inside words alone", () => {
		const text = "this or that error:0x800700b7 http://x"
		expect(splitSearchQuery(text)).toEqual([{ kind: "text", text }])
	})

	it("returns no parts for an empty query", () => {
		expect(splitSearchQuery("")).toEqual([])
	})
})

describe("splitWebUrl", () => {
	it("splits host and the rest, dropping www.", () => {
		expect(splitWebUrl("https://www.elektroda.pl/rtvforum/topic4152564.html?x=1#a")).toEqual({
			host: "elektroda.pl",
			rest: "/rtvforum/topic4152564.html?x=1#a",
		})
	})

	it("gives an empty rest for the site root", () => {
		expect(splitWebUrl("http://example.com/")).toEqual({ host: "example.com", rest: "" })
	})

	it("rejects text that is not an http(s) URL", () => {
		expect(splitWebUrl("javascript:alert(1)")).toBeUndefined()
		expect(splitWebUrl("file:///etc/passwd")).toBeUndefined()
		expect(splitWebUrl("elektroda.pl/topic")).toBeUndefined()
		expect(splitWebUrl("")).toBeUndefined()
	})
})
