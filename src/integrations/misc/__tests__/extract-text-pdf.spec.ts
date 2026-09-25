// Characterization of PDF text extraction (read_file on a .pdf) with the real
// pdf-parse and a committed fixture: a hand-written three-page PDF (Helvetica,
// WinAnsi) with two items on one row, accented Latin-1 text and 45 short rows.
// Written before DEP-6 (pdf-parse 1.x to 2.x); passes unchanged on 2.x except
// where a comment says otherwise.

import * as path from "path"

import { addLineNumbers, extractTextFromFile, extractTextFromFileWithMetadata } from "../extract-text"

const fixture = path.join(__dirname, "fixtures", "sample.pdf")

const rows = Array.from(
	{ length: 45 },
	(_, i) => `Row ${String(i + 1).padStart(2, "0")}: the quick brown fox jumps over the lazy dog.`,
)

// Every page starts with a blank line pair; items on the same row are joined
// without a tab, a new row starts a new line.
const expectedLines = [
	"",
	"",
	"Hello from the PDF fixture.",
	// pdf.js 5 (pdf-parse 2.x) adds a space for the gap between two items on
	// one row; pdf.js 1.10 (pdf-parse 1.x) glued them: "pears.Same row".
	"Second line: 42 apples, 7 pears. Same row, right column",
	"",
	"Page two starts here.",
	"Café crème brûlée (WinAnsi)",
	"",
	...rows,
]

// Line numbers are padded to the widest one (" 1 | ... 53 | ").
const expectedContent = addLineNumbers(expectedLines.join("\n"))

describe("PDF text extraction (pdf-parse)", () => {
	// The first PDF read loads pdf-parse and pdf.js 5 (several MB) once per
	// process; every later read takes milliseconds. On the Windows CI runner,
	// with other packages' tests running next to src, that one load took 2.6
	// to 8.2 s in three identical jobs and once passed 20 s, which failed the
	// first test on its default timeout. Pay the load here, under its own
	// budget, so each test only measures the extraction it checks.
	beforeAll(async () => {
		await extractTextFromFile(fixture)
	}, 120_000)

	it("extracts the fixture's text with line numbers", async () => {
		const content = await extractTextFromFile(fixture)

		expect(content.split("\n").slice(0, 7)).toEqual([
			" 1 | ",
			" 2 | ",
			" 3 | Hello from the PDF fixture.",
			" 4 | Second line: 42 apples, 7 pears. Same row, right column",
			" 5 | ",
			" 6 | Page two starts here.",
			" 7 | Café crème brûlée (WinAnsi)",
		])
		expect(content).toBe(expectedContent)
	})

	it("reports the line counts of the extracted text", async () => {
		const result = await extractTextFromFileWithMetadata(fixture)

		expect(result).toEqual({
			content: expectedContent,
			totalLines: expectedLines.length + 1,
			returnedLines: expectedLines.length + 1,
			wasTruncated: false,
		})
	})

	// pdf-parse 1.1.1 hands pdf.js 1.10 a Node Buffer; in plain Node (the CLI,
	// this test) a copy under 4 KB comes from Buffer's shared pool and pdf.js
	// then reads the wrong bytes: "bad XRef entry". VS Code's Electron does
	// not pool, so the extension was not affected.
	it("extracts a PDF smaller than 4 KB in plain Node", async () => {
		const tiny = path.join(__dirname, "fixtures", "tiny.pdf")

		expect(await extractTextFromFile(tiny)).toBe(addLineNumbers("\n\nA tiny PDF under 4 KB."))
	})

	// pdf.js 5 builds a DOMMatrix when it loads; Node has none and the VSIX has
	// no @napi-rs/canvas to borrow one from, so extract-text sets an empty
	// stand-in for the load only.
	it("loads pdf.js without a global DOMMatrix and leaves none behind", async () => {
		expect((globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBeUndefined()

		await extractTextFromFile(fixture)

		expect((globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBeUndefined()
	})

	it("rejects a file that is not a PDF", async () => {
		const notAPdf = path.join(__dirname, "fixtures", "not-a-pdf.pdf")

		await expect(extractTextFromFile(notAPdf)).rejects.toThrow()
	})
})
