// Golden renders of every lucide-react icon the webview imports.
//
// lucide renames icons (the old name stays as an alias for a while, then
// goes away) and redraws others between releases. Both are invisible in a
// dependency bump's type check as long as the alias still exists, so this
// spec pins, per imported name, the exact SVG it renders. A bump that changes
// a glyph or a class name shows up here as a diff to review.
//
// The expected markup lives in __golden__/lucide-icons.golden.json.
// Regenerate it with UPDATE_GOLDEN=1 and review the diff before committing.

import fs from "fs"
import path from "path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as lucide from "lucide-react"

const SRC_ROOT = path.resolve(__dirname, "..")
const GOLDEN_FILE = path.join(__dirname, "__golden__", "lucide-icons.golden.json")
const UPDATE = process.env.UPDATE_GOLDEN === "1"

// Type-only names that are not components.
const NOT_ICONS = new Set(["LucideIcon", "LucideProps"])

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full)
		return /\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name) ? [full] : []
	})
}

function importedIconNames(): string[] {
	const names = new Set<string>()
	const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g
	for (const file of sourceFiles(SRC_ROOT)) {
		const text = fs.readFileSync(file, "utf8")
		for (const match of text.matchAll(importRe)) {
			for (const raw of match[1].split(",")) {
				const name = raw
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0]
					?.trim()
				if (name && !NOT_ICONS.has(name)) names.add(name)
			}
		}
	}
	return [...names].sort()
}

const icons = importedIconNames()
const golden: Record<string, string> = fs.existsSync(GOLDEN_FILE)
	? JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"))
	: {}
const actual: Record<string, string> = {}

describe("lucide-react icons used by the webview", () => {
	afterAll(() => {
		if (UPDATE) {
			fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true })
			fs.writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, "\t") + "\n")
		}
	})

	it("finds the icon imports", () => {
		// A broken scan would make every other case vacuous.
		expect(icons.length).toBeGreaterThan(50)
		expect(icons).toContain("ChevronRight")
	})

	it("renders the same set of icon names as the golden file", () => {
		if (!UPDATE) expect(icons).toEqual(Object.keys(golden).sort())
	})

	it.each(icons)("%s", (name) => {
		const Icon = (lucide as unknown as Record<string, React.ComponentType | undefined>)[name]
		if (!Icon) throw new Error(`lucide-react no longer exports ${name}`)
		const svg = renderToStaticMarkup(React.createElement(Icon))
		actual[name] = svg
		if (!UPDATE) expect(svg).toBe(golden[name])
	})
})
