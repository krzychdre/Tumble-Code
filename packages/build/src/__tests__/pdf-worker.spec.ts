// pdf-parse 2.x runs pdf.js 5, which loads its worker with a dynamic import of
// "./pdf.worker.mjs" next to the running bundle (dist/extension.js). esbuild
// cannot follow that import, so the build must copy the worker into dist, and
// it must be the worker of the exact pdfjs-dist version pdf-parse uses (pdf.js
// rejects a worker of another version).

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { createRequire } from "module"

import { copyWasms, copyPdfWorker } from "../esbuild.js"

const srcNodeModules = path.resolve(__dirname, "..", "..", "..", "..", "src", "node_modules")

function pdfjsVersionOf(file: string): string | undefined {
	return /pdfjsVersion = ([0-9.]+)/.exec(fs.readFileSync(file, "utf8"))?.[1]
}

describe("copyPdfWorker", () => {
	let distDir: string

	beforeEach(() => {
		distDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-worker-"))
	})

	afterEach(() => {
		fs.rmSync(distDir, { recursive: true, force: true })
	})

	it("copies the pdf.js worker of the pdfjs-dist version pdf-parse depends on", () => {
		copyPdfWorker(srcNodeModules, distDir)

		const copied = path.join(distDir, "pdf.worker.mjs")
		const requireFromPdfParse = createRequire(
			fs.realpathSync(path.join(srcNodeModules, "pdf-parse", "package.json")),
		)
		const pdfjsVersion = (requireFromPdfParse("pdfjs-dist/package.json") as { version: string }).version

		expect(fs.existsSync(copied)).toBe(true)
		expect(pdfjsVersionOf(copied)).toBe(pdfjsVersion)
	})

	it("is part of copyWasms, which the release and the nightly build both run", () => {
		copyWasms(path.dirname(srcNodeModules), distDir)

		expect(fs.existsSync(path.join(distDir, "pdf.worker.mjs"))).toBe(true)
	})
})
