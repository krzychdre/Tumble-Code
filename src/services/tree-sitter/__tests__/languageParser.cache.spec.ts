// Real-WASM tests for the per-grammar cache in languageParser.ts.
//
// The definitions listing calls loadRequiredLanguageParsers once per file it
// reads, so without a cache every read of a TypeScript file loaded the 2.3 MB
// grammar WASM again and compiled the tag query again, and nothing ever freed
// the Parser and Query objects (they live in WASM memory, not on the JS heap).
//
// The grammars come from node_modules/tree-sitter-wasms/out, the directory the
// bundle copies them from, so these tests need no prior build.

import { createRequire } from "module"
import * as path from "path"

import { disposeLanguageParsers, loadRequiredLanguageParsers } from "../languageParser"

// The product code loads web-tree-sitter with require(), which resolves the
// package's CommonJS build. An ESM import would get a different Language class.
const { Language, Parser, Query } = createRequire(__filename)("web-tree-sitter")

const WASM_DIR = path.resolve(__dirname, "../../../node_modules/tree-sitter-wasms/out")

const SAMPLES: Record<string, string> = {
	erb: `<% def greeting(name)\n     "Hello, #{name}"\n   end %>\n<h1><%= greeting(@user.name) %></h1>\n`,
	ejs: `<% users.forEach(function (user) { %>\n  <li><%= user.name %></li>\n<% }) %>\n`,
	htm: `<html>\n  <body>\n    <div class="card">\n      <p>Hello</p>\n    </div>\n  </body>\n</html>\n`,
}

describe("loadRequiredLanguageParsers cache (real WASM)", () => {
	afterEach(() => {
		disposeLanguageParsers()
		vi.restoreAllMocks()
	})

	it("loads a grammar WASM once across two calls for the same extension", async () => {
		const load = vi.spyOn(Language, "load")

		await loadRequiredLanguageParsers(["a.ts"], WASM_DIR)
		await loadRequiredLanguageParsers(["b.ts"], WASM_DIR)

		expect(load).toHaveBeenCalledTimes(1)
	})

	it("returns the same parser and query on the second call", async () => {
		const first = await loadRequiredLanguageParsers(["a.ts"], WASM_DIR)
		const second = await loadRequiredLanguageParsers(["b.ts"], WASM_DIR)

		expect(second.ts.parser).toBe(first.ts.parser)
		expect(second.ts.query).toBe(first.ts.query)
	})

	it("reuses the grammar for another extension that maps to it (.erb then .ejs)", async () => {
		const load = vi.spyOn(Language, "load")

		await loadRequiredLanguageParsers(["a.erb"], WASM_DIR)
		await loadRequiredLanguageParsers(["b.ejs"], WASM_DIR)

		expect(load).toHaveBeenCalledTimes(1)
	})

	it("loads once when two calls for the same extension overlap", async () => {
		const load = vi.spyOn(Language, "load")

		const [a, b] = await Promise.all([
			loadRequiredLanguageParsers(["a.ts"], WASM_DIR),
			loadRequiredLanguageParsers(["b.ts"], WASM_DIR),
		])

		expect(load).toHaveBeenCalledTimes(1)
		expect(b.ts.parser).toBe(a.ts.parser)
	})

	it.each(Object.keys(SAMPLES))("a cached .%s parser still parses and yields captures", async (ext) => {
		await loadRequiredLanguageParsers([`first.${ext}`], WASM_DIR)
		const { parser, query } = (await loadRequiredLanguageParsers([`second.${ext}`], WASM_DIR))[ext]

		const tree = parser.parse(SAMPLES[ext])
		expect(tree).toBeTruthy()
		expect(query.captures(tree!.rootNode).length).toBeGreaterThan(0)
		tree!.delete()
	})

	it("keeps rejecting .elm (no usable grammar) instead of caching a failure", async () => {
		await expect(loadRequiredLanguageParsers(["a.elm"], WASM_DIR)).rejects.toThrow("Unsupported language: elm")
		await expect(loadRequiredLanguageParsers(["a.elm"], WASM_DIR)).rejects.toThrow("Unsupported language: elm")
	})

	it("retries a grammar whose load failed instead of caching the rejection", async () => {
		const missing = path.resolve(WASM_DIR, "does-not-exist")
		vi.spyOn(console, "error").mockImplementation(() => {})

		await expect(loadRequiredLanguageParsers(["a.ts"], missing)).rejects.toThrow()
		const parsers = await loadRequiredLanguageParsers(["a.ts"], WASM_DIR)

		expect(parsers.ts.parser).toBeDefined()
	})

	it("dispose deletes the cached parser and query, and the next call loads again", async () => {
		const load = vi.spyOn(Language, "load")
		const parserDelete = vi.spyOn(Parser.prototype, "delete")
		const queryDelete = vi.spyOn(Query.prototype, "delete")

		await loadRequiredLanguageParsers(["a.ts", "b.erb"], WASM_DIR)
		disposeLanguageParsers()

		expect(parserDelete).toHaveBeenCalledTimes(2)
		expect(queryDelete).toHaveBeenCalledTimes(2)

		await loadRequiredLanguageParsers(["a.ts"], WASM_DIR)
		expect(load).toHaveBeenCalledTimes(3)
	})
})
