// pnpm --filter @roo-code/vscode-webview test src/components/chat/rows/__tests__/parseToolCached.spec.ts

import { parseToolCached, TOOL_PARSE_CACHE_MAX_ENTRIES } from "../parseToolCached"

// The cache is module state shared by every test here, so each test uses its
// own ts range.
describe("parseToolCached", () => {
	it("parses the tool payload of a message", () => {
		expect(parseToolCached({ ts: 1, text: JSON.stringify({ tool: "readFile", path: "a.ts" }) })).toEqual({
			tool: "readFile",
			path: "a.ts",
		})
	})

	it("parses a message once while its text stays the same", () => {
		const parse = vi.spyOn(JSON, "parse")
		onTestFinished(() => parse.mockRestore())
		const text = JSON.stringify({ tool: "readFile", path: "b.ts" })

		const first = parseToolCached({ ts: 10, text })
		// A fresh copy of the message, as the host sends with every state update.
		const second = parseToolCached({ ts: 10, text: `${text}` })

		expect(second).toBe(first)
		expect(parse).toHaveBeenCalledTimes(1)
	})

	it("parses again when the text of the same ts changes (a streamed partial)", () => {
		const first = parseToolCached({ ts: 20, text: JSON.stringify({ tool: "appliedDiff", diff: "-a" }) })
		const second = parseToolCached({ ts: 20, text: JSON.stringify({ tool: "appliedDiff", diff: "-a\n+b" }) })

		expect(first).toEqual({ tool: "appliedDiff", diff: "-a" })
		expect(second).toEqual({ tool: "appliedDiff", diff: "-a\n+b" })
	})

	it.each([
		["no text", undefined],
		["empty text", ""],
		["broken JSON", "{not json"],
		["JSON null", "null"],
		["a JSON number", "5"],
		["a JSON string", '"readFile"'],
	])("returns undefined for %s", (_name, text) => {
		expect(parseToolCached({ ts: 30, text })).toBeUndefined()
		// Cached or not, the second answer is the same.
		expect(parseToolCached({ ts: 30, text })).toBeUndefined()
	})

	it("evicts the oldest entry once the cache is full", () => {
		const base = 1_000_000
		const text = JSON.stringify({ tool: "readFile" })
		const oldest = parseToolCached({ ts: base, text })

		// Fill the cache from other ts values; the earlier tests' entries and
		// the oldest one above are pushed out first.
		for (let i = 1; i <= TOOL_PARSE_CACHE_MAX_ENTRIES; i++) {
			parseToolCached({ ts: base + i, text })
		}

		const newest = parseToolCached({ ts: base + TOOL_PARSE_CACHE_MAX_ENTRIES, text })
		const reparsed = parseToolCached({ ts: base, text })

		expect(newest).toBe(parseToolCached({ ts: base + TOOL_PARSE_CACHE_MAX_ENTRIES, text }))
		expect(reparsed).toEqual(oldest)
		expect(reparsed).not.toBe(oldest)
	})
})
