// Real-WASM tests for the extension -> grammar map in languageParser.ts.
//
// The per-language parseSourceCodeDefinitions.*.spec.ts files mock
// loadRequiredLanguageParsers and hand parseFile a parser under whatever key
// the test picks, so they cannot notice when the real loader stores a parser
// under a key that parseFile (or the code-index CodeParser) never looks up.
// These tests go through the real loader with the grammar WASMs from src/dist.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { extensions, parseSourceCodeDefinitionsForFile, setMinComponentLines } from ".."
import { loadRequiredLanguageParsers } from "../languageParser"
import { shouldUseFallbackChunking } from "../../code-index/shared/supported-extensions"
import { CodeParser } from "../../code-index/processors/parser"

const DIST = path.join(process.cwd(), "dist")

// Route the production call sites (which pass no sourceDirectory and would
// look next to the bundled extension.js) to the WASMs in src/dist.
vi.mock("../languageParser", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../languageParser")>()
	return {
		...actual,
		loadRequiredLanguageParsers: (files: string[], sourceDirectory?: string) =>
			actual.loadRequiredLanguageParsers(files, sourceDirectory ?? path.join(process.cwd(), "dist")),
	}
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

const ERB_SAMPLE = `<%# Page header
    rendered for every visitor %>
<% def greeting(name)
     "Hello, #{name}"
   end %>
<h1><%= greeting(@user.name) %></h1>
`

const EJS_SAMPLE = `<%# List of users
    shown on the admin page %>
<% users.forEach(function (user) {
     if (user.active) { %>
  <li><%= user.name %></li>
<%   }
   }) %>
`

const HTML_SAMPLE = `<!DOCTYPE html>
<html>
  <body>
    <div class="card">
      <p>Hello</p>
    </div>
  </body>
</html>
`

const SAMPLES: Record<string, string> = {
	erb: ERB_SAMPLE,
	ejs: EJS_SAMPLE,
	html: HTML_SAMPLE,
	htm: HTML_SAMPLE,
}

let tmpDir: string

beforeAll(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-sitter-extmap-"))
	setMinComponentLines(2)
})

afterAll(() => {
	setMinComponentLines(4)
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeSample(ext: string, content: string): string {
	const file = path.join(tmpDir, `sample.${ext}`)
	fs.writeFileSync(file, content)
	return file
}

describe("tree-sitter extension map (real WASM)", () => {
	describe.each(Object.keys(SAMPLES))(".%s", (ext) => {
		it("loader returns a parser under the file's own extension and it yields captures", async () => {
			const parsers = await loadRequiredLanguageParsers([`sample.${ext}`], DIST)

			expect(Object.keys(parsers)).toEqual([ext])
			const { parser, query } = parsers[ext]
			const tree = parser.parse(SAMPLES[ext])
			expect(tree).toBeTruthy()
			expect(query.captures(tree!.rootNode).length).toBeGreaterThan(0)
		})

		it("parseSourceCodeDefinitionsForFile lists definitions", async () => {
			const file = writeSample(ext, SAMPLES[ext])

			const result = await parseSourceCodeDefinitionsForFile(file)

			expect(result).toBeDefined()
			expect(result).not.toContain("Unsupported file type")
			expect(result).toMatch(new RegExp(`^# sample\\.${ext}\\n\\d+--\\d+ \\| `))
		})
	})

	// The code index looks the parser up by extension too (CodeParser.parseContent),
	// so a wrong key or a missing loader made it drop these files entirely.
	it.each(["erb", "ejs", "htm"])("code index produces blocks for .%s", async (ext) => {
		const blocks = await new CodeParser().parseFile(`sample.${ext}`, { content: SAMPLES[ext] })

		expect(blocks.length).toBeGreaterThan(0)
	})

	it("code index chunks .elm by length instead of dropping it", async () => {
		const elm = "module Main exposing (main)\n\nmain : Int\nmain =\n    1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9\n"
		expect(shouldUseFallbackChunking(".elm")).toBe(true)

		const blocks = await new CodeParser().parseFile("sample.elm", { content: elm })

		expect(blocks.length).toBeGreaterThan(0)
	})

	it("loads .erb and .ejs together, each under its own key", async () => {
		const parsers = await loadRequiredLanguageParsers(["a.erb", "b.ejs"], DIST)

		expect(Object.keys(parsers).sort()).toEqual(["ejs", "erb"])
	})

	// .elm and .vb are advertised for code indexing, which chunks them by
	// length. Neither has a usable grammar: no Visual Basic WASM is shipped,
	// and the shipped tree-sitter-elm.wasm is ABI 12, which web-tree-sitter
	// 0.25 rejects ("Incompatible language version 12"). The definitions
	// listing must skip them instead of throwing "Unsupported language".
	it.each(["elm", "vb"])("parseSourceCodeDefinitionsForFile skips .%s without throwing", async (ext) => {
		const file = writeSample(ext, "main = 1\n")

		await expect(parseSourceCodeDefinitionsForFile(file)).resolves.toBeUndefined()
	})

	it("every advertised extension is markdown, fallback-chunked, or has a loadable grammar", async () => {
		const broken: string[] = []

		for (const dotted of extensions) {
			const ext = dotted.slice(1)
			if (ext === "md" || ext === "markdown") continue
			if (shouldUseFallbackChunking(dotted)) continue

			try {
				const parsers = await loadRequiredLanguageParsers([`sample.${ext}`], DIST)
				if (!parsers[ext]) broken.push(`${dotted}: parser stored under ${Object.keys(parsers).join(",")}`)
			} catch (error) {
				broken.push(`${dotted}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		expect(broken).toEqual([])
	})
})
