#!/usr/bin/env node
/**
 * List exports that only tests keep alive.
 *
 * knip reports exports nobody imports, but vitest makes every spec file an entry
 * point, so an export imported only by its own spec looks used to knip. This scan
 * covers that gap: it reports every exported function, class, const, type,
 * interface or enum whose name appears in at least one test file and in no
 * production file other than its own, and every production file none of whose
 * exports production code uses (usually a whole module kept only by its spec).
 *
 * It is a heuristic for a manual review, not a gate:
 * - references are matched by identifier, not resolved through imports, so a
 *   common name that also exists elsewhere hides a real finding (it under-reports,
 *   it does not over-report);
 * - comments do not count as a reference, string literals do;
 * - `export { a, b }` lists and default exports are not scanned.
 * Before deleting anything it reports, grep the name once more by hand.
 *
 * With --unreferenced it also lists exports that no other file mentions at all.
 * knip reports those too, but only as warnings (knip.jsonc "exports": "warn").
 *
 * Usage (from the repository root):
 *   node scripts/find-test-only-exports.mjs            # human-readable list
 *   node scripts/find-test-only-exports.mjs --json     # machine-readable
 *   node scripts/find-test-only-exports.mjs --unreferenced  # also exports nobody mentions
 *   node scripts/find-test-only-exports.mjs src/api    # only report under these paths
 *
 * Tests: node --test 'scripts/__tests__/*.test.mjs'
 */

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Where production code and its tests live. Every file under these roots counts as
// a possible reference; only .ts/.tsx production files are scanned for exports.
const ROOTS = ["src", "webview-ui", "apps", "packages"]
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage", ".turbo", ".vscode-test"])
// Shell scripts count as references too (apps/cli/scripts/build.sh imports a built module).
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|sh)$/

const TEST_PATH = [
	/(?:^|\/)(?:__tests__|__mocks__)\//,
	/\.(?:spec|test)\.[cm]?[jt]sx?$/,
	/(?:^|\/)vitest\.setup\.[cm]?[jt]s$/,
	// The e2e harness runs under mocha inside a VS Code test instance.
	/(?:^|\/)apps\/vscode-e2e\//,
]

const EXPORT_DECLARATION =
	/^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?(?:function[ \t]*\*?|const|let|var|class|interface|type|enum)[ \t]+([A-Za-z_$][\w$]*)/gm
const IDENTIFIER = /[A-Za-z_$][\w$]*/g
// Exports this scan cannot follow by name; a file that has one is never reported whole.
const UNNAMED_EXPORT = /^[ \t]*export[ \t]+(?:default\b|\{|\*)/m

/** @param {string} file a path with forward slashes */
export function isTestFile(file) {
	return TEST_PATH.some((pattern) => pattern.test(file))
}

/**
 * Remove // and block comments, keeping strings intact so "http://x" survives.
 * Regex literals are not recognized; a quote inside one can hide the rest of that
 * line, which at worst hides a finding.
 * @param {string} text
 */
function stripComments(text) {
	let out = ""
	let i = 0
	/** @type {string | undefined} */
	let quote
	// Brace depth at which each open template `${` returns to the template string.
	const templateDepths = []
	let depth = 0

	while (i < text.length) {
		const ch = text[i]
		const next = text[i + 1]

		if (quote) {
			out += ch
			if (ch === "\\") {
				out += next ?? ""
				i += 2
				continue
			}
			if (quote === "`" && ch === "$" && next === "{") {
				out += next
				templateDepths.push(depth)
				depth++
				quote = undefined
				i += 2
				continue
			}
			if (ch === quote) quote = undefined
			i++
			continue
		}

		if (ch === "/" && next === "/") {
			const end = text.indexOf("\n", i)
			i = end === -1 ? text.length : end
			continue
		}
		if (ch === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2)
			i = end === -1 ? text.length : end + 2
			out += " "
			continue
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch
		} else if (ch === "{") {
			depth++
		} else if (ch === "}") {
			depth--
			if (templateDepths.length && templateDepths[templateDepths.length - 1] === depth) {
				templateDepths.pop()
				quote = "`"
			}
		}
		out += ch
		i++
	}
	return out
}

/**
 * @param {Map<string, string>} files repository-relative path (forward slashes) to file text
 * @returns {{
 *   exports: { file: string, name: string, usedInOwnFile: boolean }[],
 *   files: string[],
 *   unreferenced: { file: string, name: string, usedInOwnFile: boolean }[],
 * }}
 */
export function findTestOnlyExports(files) {
	/** @type {Map<string, { test: boolean, code: string, names: Map<string, number> }>} */
	const parsed = new Map()
	/** Identifier to the production files that mention it. */
	const productionMentions = new Map()
	/** Identifiers mentioned by at least one test file. */
	const testMentions = new Set()

	for (const [file, text] of files) {
		const code = stripComments(text)
		const test = isTestFile(file)
		const names = new Map()
		for (const [name] of code.matchAll(IDENTIFIER)) names.set(name, (names.get(name) ?? 0) + 1)
		parsed.set(file, { test, code, names })

		for (const name of names.keys()) {
			if (test) {
				testMentions.add(name)
			} else {
				if (!productionMentions.has(name)) productionMentions.set(name, new Set())
				productionMentions.get(name).add(file)
			}
		}
	}

	const found = []
	const deadFiles = []
	const unreferenced = []

	for (const [file, { test, code, names }] of parsed) {
		if (test || !/\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue

		const exported = [...new Set([...code.matchAll(EXPORT_DECLARATION)].map((m) => m[1]))]
		if (exported.length === 0) continue

		let testOnly = 0
		let usedElsewhere = 0
		for (const name of exported) {
			const elsewhere = [...(productionMentions.get(name) ?? [])].some((other) => other !== file)
			if (elsewhere) {
				usedElsewhere++
				continue
			}
			if (!testMentions.has(name)) {
				unreferenced.push({ file, name, usedInOwnFile: names.get(name) > 1 })
				continue
			}
			testOnly++
			found.push({ file, name, usedInOwnFile: names.get(name) > 1 })
		}
		// No production file uses any of its exports, and a test does: the module lives for its spec.
		if (usedElsewhere === 0 && testOnly > 0 && !UNNAMED_EXPORT.test(code)) deadFiles.push(file)
	}

	const byFileThenName = (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)
	return {
		exports: found.sort(byFileThenName),
		files: deadFiles.sort(),
		unreferenced: unreferenced.sort(byFileThenName),
	}
}

/** @param {string} repoRoot */
function readSources(repoRoot) {
	const files = new Map()
	const walk = (dir) => {
		let entries
		try {
			entries = readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const rel = `${dir}/${entry.name}`
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(rel)
			} else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
				files.set(rel, readFileSync(path.join(repoRoot, rel), "utf8"))
			}
		}
	}
	for (const root of ROOTS) walk(root)
	return files
}

function main() {
	const args = process.argv.slice(2)
	const json = args.includes("--json")
	const withUnreferenced = args.includes("--unreferenced")
	const only = args.filter((a) => !a.startsWith("--")).map((a) => a.replace(/\/+$/, "") + "/")
	const inScope = (file) => only.length === 0 || only.some((prefix) => file.startsWith(prefix))

	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
	const result = findTestOnlyExports(readSources(repoRoot))
	const exports = result.exports.filter((e) => inScope(e.file))
	const files = result.files.filter(inScope)
	const unreferenced = withUnreferenced ? result.unreferenced.filter((e) => inScope(e.file)) : []

	if (json) {
		console.log(JSON.stringify(withUnreferenced ? { exports, files, unreferenced } : { exports, files }, null, 2))
		return
	}

	console.log(`Files whose exports only tests reference (${files.length}):`)
	for (const file of files) console.log(`  ${file}`)
	const rest = exports.filter((e) => !files.includes(e.file))
	console.log(`\nOther exports only tests reference (${rest.length}):`)
	for (const e of rest) {
		console.log(
			`  ${e.file}: ${e.name}${e.usedInOwnFile ? " (still used in its own file, drop the export only)" : ""}`,
		)
	}
	if (withUnreferenced) {
		console.log(`\nExports no other file mentions (${unreferenced.length}):`)
		for (const e of unreferenced) {
			console.log(
				`  ${e.file}: ${e.name}${e.usedInOwnFile ? " (still used in its own file, drop the export only)" : ""}`,
			)
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
}
