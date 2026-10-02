#!/usr/bin/env node
/**
 * D2 guard: no literal defaults on settings-table keys at call sites.
 *
 * `SETTINGS_DEFAULTS` (packages/types/src/settings-defaults.ts) is the one
 * table of static setting defaults (CORE-R1). A call site that writes its own
 * literal (`key = true`, `key ?? 100`, `key || 5`) silently forks the default:
 * the table changes and the call site does not. This script fails CI when a
 * settings-table key gets a literal fallback in runtime code.
 *
 * Usage: node scripts/check-settings-defaults.mjs [--root <dir>]
 * Exit 0 = clean, 1 = violations listed on stdout.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const root = process.argv.includes("--root")
	? process.argv[process.argv.indexOf("--root") + 1]
	: process.cwd()

const TABLE_PATH = join(root, "packages/types/src/settings-defaults.ts")

/**
 * Call sites that are allowed a literal default on a table key, with a reason.
 * Map of "file:path-relative-to-root:line" -> reason. Keep it empty if possible.
 */
const ALLOWED = {
	// Import cycle: settings-defaults.ts imports WEB_TOOLS_DEFAULTS from
	// web-tools.ts, so this resolver cannot read the table.
	"packages/types/src/web-tools.ts:100": "import cycle with the defaults table",
	"packages/types/src/web-tools.ts:101": "import cycle with the defaults table",
	// Write path: `||` also guards the empty string a profile clear leaves
	// behind; a read-side `??` would save "" as a config name.
	"src/extension/api.ts:358": "write path; || also guards the empty string",
	// Display-only: the empty string is not the default config name, it just
	// renders "no profile selected" in the input.
	"webview-ui/src/components/settings/ApiConfigManager.tsx:29": 'optional prop; "" renders the empty input',
	"webview-ui/src/components/settings/ApiConfigManager.tsx:135":
		'display path; || also guards the empty string ("" is not a config name)',
	"webview-ui/src/components/chat/ComposerToolbar.tsx:53":
		'display path; || also guards the empty string ("" is not a config name)',
}

// ---------------------------------------------------------------------------
// 1. Read the table keys (and their literal values, for the report).
//

function readTableKeys(source) {
	// The table is the `const settingsDefaults = { ... }` block; every entry we
	// care about is one line of the shape `key: literal,` (numbers, strings,
	// booleans, null, and constant references like DEFAULT_WRITE_DELAY_MS).
	// The block ends with `} satisfies SettingsDefaultsShape`, so match to the
	// closing brace on its own line (the `\n}` anchor alone stops too early on
	// nested object literals).
	const blockMatch = source.match(/const settingsDefaults = \{([\s\S]*?)\n\} satisfies/)
	if (!blockMatch) {
		throw new Error("could not locate the settingsDefaults block in settings-defaults.ts")
	}

	const keys = new Set()
	const lineRe = /^\s+([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(.+?),?\s*$/
	for (const line of blockMatch[1].split("\n")) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("//")) continue
		const m = line.match(lineRe)
		if (m) {
			keys.add(m[1])
		}
	}
	return keys
}

// ---------------------------------------------------------------------------
// 2. Scan runtime code for literal fallbacks on those keys.
//

const SCAN_DIRS = ["src", "packages", "apps", "webview-ui"]
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "__mocks__", "coverage"])
const SKIP_FILE = (name) =>
	name.endsWith(".spec.ts") ||
	name.endsWith(".spec.tsx") ||
	name.endsWith(".test.ts") ||
	name.endsWith(".test.tsx") ||
	name.endsWith(".d.ts") ||
	name === "settings-defaults.ts" || // the table itself
	name === "check-settings-defaults.mjs" ||
	name === "check-settings-defaults.test.mjs"

function* walk(dir) {
	let entries
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue
			yield* walk(full)
		} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
			if (SKIP_FILE(entry.name)) continue
			yield full
		}
	}
}

// A literal default is either a destructuring default (`key = literal` where
// the key directly follows `{`, `,` or the line start — an assignment like
// `task.key = false` has a receiver prefix and must not match) or a fallback
// operator (`key ?? literal` / `key || literal`, with an optional `obj?.`
// prefix — that is a read with a default). References like
// `?? SETTINGS_DEFAULTS.key` do not match (they must not).
function literalFallbackRe(key) {
	return new RegExp(
		`(?:(?:^|[,({])[ \\t]*${key}[ \\t]*=[ \\t]*` +
			`|(?:[?]?\\.)?\\b${key}[ \\t]*(?:\\?\\?|\\|\\|)[ \\t]*)` +
			`("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|-?\\d[\\d_]*(?:\\.\\d+)?|true|false|null)`,
	)
}

function scan(keys, rootDir) {
	const violations = []
	for (const dir of SCAN_DIRS) {
		for (const file of walk(join(rootDir, dir))) {
			const rel = relative(rootDir, file).split(sep).join("/")
			const source = readFileSync(file, "utf8")
			const lines = source.split("\n")
			for (const key of keys) {
				const re = literalFallbackRe(key)
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					if (!line.includes(key)) continue
					const m = line.match(re)
					if (m) {
						const id = `${rel}:${i + 1}`
						const allowance = ALLOWED[id]
						if (allowance !== undefined) continue
						violations.push({ file: rel, line: i + 1, key, text: line.trim() })
					}
				}
			}
		}
	}
	return violations
}

// ---------------------------------------------------------------------------
// 3. Main (import guard: reusable from the test).
//

export function checkSettingsDefaults({ root: rootDir = root } = {}) {
	const tableSource = readFileSync(join(rootDir, "packages/types/src/settings-defaults.ts"), "utf8")
	const keys = readTableKeys(tableSource)
	return { keys, violations: scan(keys, rootDir) }
}

const isMain = process.argv[1] && process.argv[1].endsWith("check-settings-defaults.mjs")
if (isMain) {
	let result
	try {
		result = checkSettingsDefaults()
	} catch (error) {
		console.error(`check-settings-defaults: ${error.message}`)
		process.exit(1)
	}

	if (result.violations.length > 0) {
		console.error(
			`Literal default on a SETTINGS_DEFAULTS key (${result.violations.length}): ` +
				"use `?? SETTINGS_DEFAULTS.<key>` (packages/types/src/settings-defaults.ts is the one table).",
		)
		for (const v of result.violations) {
			console.error(`  ${v.file}:${v.line}  [${v.key}]  ${v.text}`)
		}
		process.exit(1)
	}

	console.log(`check-settings-defaults: clean (${result.keys.size} table keys checked)`)
}
