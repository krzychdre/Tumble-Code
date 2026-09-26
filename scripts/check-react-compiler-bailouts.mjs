#!/usr/bin/env node
// Lists the webview components and hooks that the React Compiler does NOT compile ("bailouts") and
// fails when that list differs from the committed baseline.
//
// Why: webview-ui/vite.config.ts runs babel-plugin-react-compiler, which silently skips any function it
// cannot prove safe (an `eslint-disable react-hooks` comment, a ref read during render, a mutated
// state value, ...). A skipped component keeps only its hand-written memoization, and nothing in the
// build says so. This script runs the same compiler, with the same Babel that Vite uses, over every
// production file and compares the skipped functions with webview-ui/react-compiler-bailouts.json:
// - a function missing from the baseline is a NEW bailout: fix it, or add it to the baseline on purpose;
// - a baseline entry that now compiles is stale: remove it (or run with --update), so the next
//   regression in that function is caught.
//
// Usage (from webview-ui, it runs in `pnpm lint`):
//   node ../scripts/check-react-compiler-bailouts.mjs            check against the baseline
//   node ../scripts/check-react-compiler-bailouts.mjs --update   rewrite the baseline from the source
//   node ../scripts/check-react-compiler-bailouts.mjs --root <dir>   check another package directory

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export const BASELINE_FILE = "react-compiler-bailouts.json"

// Keep in sync with the babel-plugin-react-compiler options in webview-ui/vite.config.ts.
const COMPILER_OPTIONS = { target: "18" }

// Logger events that mean "this function was not compiled". CompileSuccess and CompileDiagnostic
// (a non-fatal note) are not bailouts.
const BAILOUT_EVENTS = new Set(["CompileError", "CompileSkip", "PipelineError", "CompileUnexpectedThrow"])

const SKIPPED_DIRS = new Set(["node_modules", "__tests__", "__mocks__"])

/** Production source files under `<root>/src`, as sorted POSIX paths relative to `root`. */
export function listSourceFiles(root) {
	const out = []
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) walk(full)
			} else if (
				/\.(ts|tsx)$/.test(entry.name) &&
				!/\.d\.ts$/.test(entry.name) &&
				!/\.(spec|test|stories)\.(ts|tsx)$/.test(entry.name)
			) {
				out.push(path.relative(root, full).split(path.sep).join("/"))
			}
		}
	}
	walk(path.join(root, "src"))
	return out.sort()
}

/**
 * Loads Babel and the compiler plugin the way the package's own build does: the compiler from the
 * package, Babel from @rolldown/plugin-babel (the Babel that Vite runs the compiler with; since
 * @vitejs/plugin-react 6 the compiler runs there, plugin-react itself has no Babel any more).
 */
function loadToolchain(root) {
	const req = createRequire(path.join(root, "package.json"))
	const babel = createRequire(req.resolve("@rolldown/plugin-babel"))("@babel/core")
	return { babel, compilerPath: req.resolve("babel-plugin-react-compiler") }
}

/** Best name for the function at `fnPath`: its own name, or the variable/property/export it is bound to. */
function functionName(fnPath) {
	if (fnPath.node.id?.name) return fnPath.node.id.name
	let current = fnPath.parentPath
	while (current) {
		const { node } = current
		if (node.type === "VariableDeclarator" && node.id.type === "Identifier") return node.id.name
		if ((node.type === "ObjectProperty" || node.type === "ClassProperty") && node.key.type === "Identifier") {
			return node.key.name
		}
		if (node.type === "ExportDefaultDeclaration") return "default"
		// memo(...), forwardRef(...), React.memo(...): keep walking to the binding.
		if (node.type !== "CallExpression" && node.type !== "TSAsExpression") break
		current = current.parentPath
	}
	return `<anonymous:${fnPath.node.loc.start.line}>`
}

function reasonOf(event) {
	const detail = event.detail
	return String(detail?.reason ?? detail?.options?.reason ?? event.reason ?? event.data ?? event.kind)
}

/**
 * Compiles `code` and returns one entry per function the compiler skipped:
 * `{ name, line, reason }`, deduplicated by name.
 */
export async function findBailoutsInSource(code, filename, toolchain) {
	const { babel, compilerPath } = toolchain
	const parserOpts = { plugins: ["jsx", "typescript"] }
	const events = []
	await babel.transformAsync(code, {
		filename,
		babelrc: false,
		configFile: false,
		code: false,
		parserOpts,
		plugins: [[compilerPath, { ...COMPILER_OPTIONS, logger: { logEvent: (_file, event) => events.push(event) } }]],
	})
	const bailouts = events.filter((e) => BAILOUT_EVENTS.has(e.kind))
	if (bailouts.length === 0) return []

	// The logger reports only a location for failed functions; map it back to a name.
	const ast = await babel.parseAsync(code, { filename, babelrc: false, configFile: false, parserOpts })
	const namesByStart = new Map()
	babel.traverse(ast, {
		Function(fnPath) {
			const { line, column } = fnPath.node.loc.start
			namesByStart.set(`${line}:${column}`, functionName(fnPath))
		},
	})

	const byName = new Map()
	for (const event of bailouts) {
		const start = event.fnLoc?.start
		const name = start
			? (namesByStart.get(`${start.line}:${start.column}`) ?? `<anonymous:${start.line}>`)
			: "<file>"
		if (!byName.has(name)) byName.set(name, { name, line: start?.line ?? 0, reason: reasonOf(event) })
	}
	return [...byName.values()]
}

/** `{ "<file>": [{ name, line, reason }] }` for every file with at least one bailout. */
export async function findBailouts(root, files = listSourceFiles(root)) {
	const toolchain = loadToolchain(root)
	const result = {}
	for (const file of files) {
		const code = fs.readFileSync(path.join(root, file), "utf8")
		const found = await findBailoutsInSource(code, path.join(root, file), toolchain)
		if (found.length > 0) result[file] = found
	}
	return result
}

/** The baseline shape: `{ "<file>": ["<function name>", ...] }`, sorted for stable diffs. */
export function toBaseline(found) {
	const out = {}
	for (const file of Object.keys(found).sort()) {
		out[file] = found[file].map((b) => b.name).sort()
	}
	return out
}

/** The baseline as JSON, one line per file: the layout prettier keeps, so --update and lint-staged agree. */
export function formatBaseline(baseline) {
	const lines = Object.entries(baseline).map(
		([file, names]) => `\t${JSON.stringify(file)}: ${JSON.stringify(names).replaceAll('","', '", "')}`,
	)
	return lines.length === 0 ? "{}\n" : `{\n${lines.join(",\n")}\n}\n`
}

/** New bailouts (not in the baseline) and stale baseline entries (compile now). */
export function compareWithBaseline(found, baseline) {
	const added = []
	const stale = []
	for (const [file, list] of Object.entries(found)) {
		const allowed = new Set(baseline[file] ?? [])
		for (const b of list) if (!allowed.has(b.name)) added.push({ file, ...b })
	}
	for (const [file, names] of Object.entries(baseline)) {
		const present = new Set((found[file] ?? []).map((b) => b.name))
		for (const name of names) if (!present.has(name)) stale.push({ file, name })
	}
	return { added, stale }
}

async function main(argv) {
	const rootIndex = argv.indexOf("--root")
	const root = path.resolve(rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd())
	const baselinePath = path.join(root, BASELINE_FILE)
	const found = await findBailouts(root)

	if (argv.includes("--update")) {
		fs.writeFileSync(baselinePath, formatBaseline(toBaseline(found)))
		console.log(`Wrote ${Object.values(found).flat().length} React Compiler bailouts to ${baselinePath}`)
		return 0
	}

	const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {}
	const { added, stale } = compareWithBaseline(found, baseline)
	for (const b of added) {
		console.error(`${b.file}:${b.line} ${b.name}: the React Compiler skips it (new bailout): ${b.reason}`)
	}
	for (const s of stale) {
		console.error(
			`${s.file} ${s.name}: compiles now, remove it from ${BASELINE_FILE} (or run with --update) so a regression is caught`,
		)
	}
	if (added.length > 0 || stale.length > 0) {
		console.error(
			`React Compiler bailout check failed: ${added.length} new, ${stale.length} stale (baseline ${baselinePath}).`,
		)
		return 1
	}
	console.log(`React Compiler bailouts match the baseline (${Object.values(found).flat().length} known).`)
	return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2))
}
