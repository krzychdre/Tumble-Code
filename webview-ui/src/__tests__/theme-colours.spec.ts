// Tailwind's palette colours (`text-green-500`, `bg-red-600`, ...) are fixed
// values that ignore the VS Code theme: a green that reads well on a dark
// background can vanish on a light one. Status colours come from the
// `--status-*` tokens in index.css, everything else from `--vscode-*`
// variables. This spec fails when a palette colour comes back in production
// code.

import fs from "fs"
import path from "path"

const SRC_ROOT = path.resolve(__dirname, "..")

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory())
			return entry.name === "node_modules" || entry.name === "__tests__" ? [] : sourceFiles(full)
		return /\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name) ? [full] : []
	})
}

const PALETTE_CLASS =
	/\b(?:text|bg|border(?:-[lrtbxy])?|ring|fill|stroke|outline|from|via|to|divide|decoration|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g

// The bypass and autonomous auto-approve modes are deliberately orange in every
// theme, the same colour as the frame accent they switch on.
const ALLOWED = new Set(["bg-orange-600", "border-orange-600", "text-orange-500"])

describe("theme colours", () => {
	it("production code uses no Tailwind palette colours outside the auto-approve orange", () => {
		const found: string[] = []
		for (const file of sourceFiles(SRC_ROOT)) {
			const text = fs.readFileSync(file, "utf8")
			for (const match of text.matchAll(PALETTE_CLASS)) {
				if (!ALLOWED.has(match[0])) found.push(`${path.relative(SRC_ROOT, file)}: ${match[0]}`)
			}
		}
		expect(found).toEqual([])
	})
})
