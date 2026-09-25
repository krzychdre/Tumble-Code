// Characterization of PDF text extraction (read_file on a .pdf) with the real
// pdf-parse and a committed fixture: a hand-written three-page PDF (Helvetica,
// WinAnsi) with two items on one row, accented Latin-1 text and 45 short rows.
// Written before DEP-6 (pdf-parse 1.x to 2.x) and expected to pass unchanged.

import * as path from "path"

import { addLineNumbers, extractTextFromFile, extractTextFromFileWithMetadata } from "../extract-text"

const fixture = path.join(__dirname, "fixtures", "sample.pdf")

const rows = Array.from(
	{ length: 45 },
	(_, i) => `Row ${String(i + 1).padStart(2, "0")}: the quick brown fox jumps over the lazy dog.`,
)

// Every page starts with a blank line pair; items on the same row are joined
// without a separator, a new row starts a new line.
const expectedLines = [
	"",
	"",
	"Hello from the PDF fixture.",
	"Second line: 42 apples, 7 pears.Same row, right column",
	"",
	"Page two starts here.",
	"Café crème brûlée (WinAnsi)",
	"",
	...rows,
]

// Line numbers are padded to the widest one (" 1 | ... 53 | ").
const expectedContent = addLineNumbers(expectedLines.join("\n"))

describe("PDF text extraction (pdf-parse)", () => {
	it("extracts the fixture's text with line numbers", async () => {
		const content = await extractTextFromFile(fixture)

		expect(content.split("\n").slice(0, 7)).toEqual([
			" 1 | ",
			" 2 | ",
			" 3 | Hello from the PDF fixture.",
			" 4 | Second line: 42 apples, 7 pears.Same row, right column",
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

	it("rejects a file that is not a PDF", async () => {
		const notAPdf = path.join(__dirname, "fixtures", "not-a-pdf.pdf")

		await expect(extractTextFromFile(notAPdf)).rejects.toThrow()
	})
})
