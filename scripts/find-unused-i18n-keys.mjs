#!/usr/bin/env node
/**
 * Lists webview translation keys (webview-ui/src/i18n/locales/en/*.json) that no source file references.
 *
 * Usage:
 *   node scripts/find-unused-i18n-keys.mjs            list the candidates, grouped by namespace
 *   node scripts/find-unused-i18n-keys.mjs --patterns also print every dynamic key pattern and what it covers
 *   node scripts/find-unused-i18n-keys.mjs --check    exit 1 when there is at least one candidate
 *   node scripts/find-unused-i18n-keys.mjs --write    delete the candidates from every locale
 *   node scripts/find-unused-i18n-keys.mjs --missing  the opposite check: list literal keys used by the webview
 *                                                     (t("ns:key"), i18nKey="ns:key") that the English locale lacks,
 *                                                     exit 1 when there is one (the user would see the raw key)
 *
 * The scan is deliberately conservative: a key counts as used when
 *   - its dotted path (or its plural base, "count" for "count_one") appears anywhere in the searched sources,
 *     not only inside t(...), so keys passed as props, stored in tables, sent from the extension host or read by
 *     tests all count;
 *   - a one-segment key appears as "ns:key", or as a quoted "key" in a file bound to that namespace
 *     (useTranslation("ns"), ns: "ns" or ns="ns");
 *   - it matches a dynamic pattern: a key-shaped template literal such as `settings:providers.${id}.label`,
 *     or a string literal ending with a dot such as "settings:codeIndex." (the start of a concatenation).
 * What it cannot see: keys assembled from pieces that never appear together, for example a namespace-only
 * template `mcp:${name}`. Those templates are skipped (they would cover a whole namespace) and listed by --patterns,
 * so review them before trusting a --write run.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other|plural)$/
const KEY_CHARS = /^[\w.:-]*$/
const IDENT_CHAR = /[\w$-]/

/** Every leaf of a nested translation object, as a dotted path. */
export function flattenKeys(obj, prefix = "") {
	const out = []
	for (const [key, value] of Object.entries(obj)) {
		const full = prefix ? `${prefix}.${key}` : key
		if (value && typeof value === "object" && !Array.isArray(value)) {
			out.push(...flattenKeys(value, full))
		} else {
			out.push(full)
		}
	}
	return out
}

/** "items.count_one" -> "items.count": i18next picks the suffix from the count option. */
export function pluralBase(key) {
	return key.replace(PLURAL_SUFFIX, "")
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Splits the body of a template literal into static text and `${...}` holes (null entries). */
function splitTemplate(body) {
	const parts = []
	let current = ""
	let i = 0
	while (i < body.length) {
		if (body[i] === "\\") {
			current += body.slice(i, i + 2)
			i += 2
		} else if (body[i] === "$" && body[i + 1] === "{") {
			parts.push(current, null)
			current = ""
			let depth = 1
			i += 2
			while (i < body.length && depth > 0) {
				if (body[i] === "{") depth++
				else if (body[i] === "}") depth--
				i++
			}
		} else {
			current += body[i]
			i++
		}
	}
	parts.push(current)
	return parts
}

/**
 * Dynamic key patterns found in one source text: key-shaped template literals with at least one hole, and string
 * literals ending with a dot (concatenation prefixes). Each entry is { source, regex }; the regex is anchored and is
 * tested against both "ns:path" and "path".
 */
export function extractDynamicPatterns(text) {
	const patterns = []

	for (const match of text.matchAll(/`((?:[^`\\]|\\[\s\S])*)`/g)) {
		const body = match[1]
		if (!body.includes("${")) continue
		const parts = splitTemplate(body)
		const statics = parts.filter((p) => p !== null).join("")
		if (!KEY_CHARS.test(statics)) continue
		if (!statics.includes(".") && !statics.includes(":")) continue
		// A namespace alone ("mcp:") or bare separators ("." between two holes) name no key.
		if (!/[A-Za-z]/.test(statics.replace(/^[A-Za-z-]+:/, ""))) continue
		const regex = new RegExp("^" + parts.map((p) => (p === null ? "[\\w.:-]*" : escapeRegex(p))).join("") + "$")
		patterns.push({ source: "`" + body + "`", regex })
	}

	for (const match of text.matchAll(/(["'])((?:[\w-]+:)?[\w-]+(?:\.[\w-]+)*\.)\1/g)) {
		const prefix = match[2]
		patterns.push({ source: match[0], regex: new RegExp("^" + escapeRegex(prefix) + "[\\w.-]+$") })
	}

	return patterns
}

/** True when `needle` occurs in `haystack` with no identifier character right before or after it. */
function occursAsToken(haystack, needle) {
	let from = 0
	for (;;) {
		const at = haystack.indexOf(needle, from)
		if (at === -1) return false
		const before = at > 0 ? haystack[at - 1] : ""
		const after = haystack[at + needle.length] ?? ""
		if (!IDENT_CHAR.test(before) && !IDENT_CHAR.test(after)) return true
		from = at + 1
	}
}

function boundNamespaces(text) {
	const out = new Set()
	for (const m of text.matchAll(/useTranslation\(\s*["']([\w-]+)["']/g)) out.add(m[1])
	for (const m of text.matchAll(/\bns\s*[:=]\s*\{?\s*["']([\w-]+)["']/g)) out.add(m[1])
	return out
}

/**
 * @param {{ locales: Record<string, object>, sources: { file: string, text: string }[] }} input
 *   locales maps a namespace to its English translation object.
 * @returns {{ unused: { ns: string, key: string }[], patterns: { source: string, regex: RegExp, files: Set<string>, covers: string[] }[] }}
 */
export function findUnusedKeys({ locales, sources }) {
	const corpus = sources.map((s) => s.text).join("\n\u0000\n")

	const patternsBySource = new Map()
	for (const { file, text } of sources) {
		for (const p of extractDynamicPatterns(text)) {
			const entry = patternsBySource.get(p.source) ?? { ...p, files: new Set(), covers: [] }
			entry.files.add(file)
			patternsBySource.set(p.source, entry)
		}
	}
	const patterns = [...patternsBySource.values()]

	const boundTexts = new Map()
	for (const { text } of sources) {
		for (const ns of boundNamespaces(text)) {
			boundTexts.set(ns, (boundTexts.get(ns) ?? "") + "\n\u0000\n" + text)
		}
	}

	const unused = []
	for (const [ns, obj] of Object.entries(locales)) {
		for (const key of flattenKeys(obj)) {
			const names = [...new Set([key, pluralBase(key)])]

			const staticHit = names.some((name) => {
				if (name.includes(".")) return occursAsToken(corpus, name)
				if (occursAsToken(corpus, `${ns}:${name}`)) return true
				const bound = boundTexts.get(ns) ?? ""
				return ['"', "'", "`"].some((q) => bound.includes(q + name + q))
			})
			if (staticHit) continue

			const candidates = names.flatMap((name) => [`${ns}:${name}`, name])
			const covering = patterns.filter((p) => candidates.some((c) => p.regex.test(c)))
			if (covering.length > 0) {
				for (const p of covering) p.covers.push(`${ns}:${key}`)
				continue
			}

			unused.push({ ns, key })
		}
	}

	return { unused, patterns }
}

/** Removes the given dotted leaf paths from a copy of `obj` and drops objects left empty. */
export function removeKeys(obj, paths) {
	const copy = structuredClone(obj)
	let removed = 0
	for (const p of paths) {
		const segments = p.split(".")
		const chain = [copy]
		for (const seg of segments.slice(0, -1)) {
			const next = chain[chain.length - 1]?.[seg]
			if (!next || typeof next !== "object") break
			chain.push(next)
		}
		if (chain.length !== segments.length) continue
		const last = segments[segments.length - 1]
		const parent = chain[chain.length - 1]
		if (!(last in parent) || typeof parent[last] === "object") continue
		delete parent[last]
		removed++
		for (let i = chain.length - 1; i > 0; i--) {
			if (Object.keys(chain[i]).length > 0) break
			delete chain[i - 1][segments[i - 1]]
		}
	}
	return { obj: copy, removed }
}

/**
 * Literal keys one source text asks for: t("ns:key"), i18n.t('ns:key'), i18nKey="ns:key" and i18nKey={"ns:key"}.
 * A key without a namespace is resolved against the file's namespace when the file binds exactly one
 * (useTranslation("ns")); otherwise it is skipped, because its namespace cannot be known statically.
 * Template literals and keys built at run time are not literal keys and are never reported, and neither are lines
 * that are comments (JSDoc examples).
 * @returns {{ ns: string, key: string }[]}
 */
export function extractLiteralKeys(source) {
	const out = []
	// Examples in JSDoc and line comments are not calls.
	const text = source.replace(/^\s*(\*|\/\/).*$/gm, "")
	const bound = [...text.matchAll(/useTranslation\(\s*["']([\w-]+)["']/g)].map((m) => m[1])
	const fileNs = new Set(bound).size === 1 ? bound[0] : undefined
	const literals = [
		...text.matchAll(/(?<![\w$])t\(\s*(["'])([\w-]+:)?([\w-]+(?:\.[\w-]+)*)\1/g),
		...text.matchAll(/\bi18nKey=\{?\s*(["'])([\w-]+:)?([\w-]+(?:\.[\w-]+)*)\1/g),
	]
	for (const m of literals) {
		const ns = m[2] ? m[2].slice(0, -1) : fileNs
		// A bare word with no namespace and no dot is too ambiguous to be a key (t("x") in unrelated helpers).
		if (!ns || (!m[2] && !m[3].includes(".") && !fileNs)) continue
		out.push({ ns, key: m[3] })
	}
	return out
}

/** True when `key` names a leaf, a plural family (key_one, key_other, ...) or a whole object in `obj`. */
export function hasKey(obj, key) {
	const segments = key.split(".")
	let node = obj
	for (const seg of segments.slice(0, -1)) {
		node = node?.[seg]
		if (!node || typeof node !== "object") return false
	}
	const last = segments[segments.length - 1]
	if (last in node) return true
	return Object.keys(node).some((k) => k !== last && pluralBase(k) === last)
}

/**
 * Literal keys used by the sources that the English locale does not define, so the user would see the raw key.
 * `ignore` lists "ns:key" strings that are known to be resolved some other way.
 * @param {{ locales: Record<string, object>, sources: { file: string, text: string }[], ignore?: Iterable<string> }} input
 * @returns {{ file: string, key: string }[]}
 */
export function findMissingKeys({ locales, sources, ignore = [] }) {
	const skip = new Set(ignore)
	const missing = []
	for (const { file, text } of sources) {
		const seen = new Set()
		for (const { ns, key } of extractLiteralKeys(text)) {
			const full = `${ns}:${key}`
			if (seen.has(full) || skip.has(full)) continue
			seen.add(full)
			if (locales[ns] && hasKey(locales[ns], key)) continue
			missing.push({ file, key: full })
		}
	}
	return missing
}

/** Webview source files whose literal keys must exist: everything under webview-ui/src except tests and mocks. */
export function isWebviewProductFile(relativeFile) {
	const posix = relativeFile.split(path.sep).join("/")
	return (
		posix.startsWith("webview-ui/src/") &&
		/\.(ts|tsx|js|jsx)$/.test(posix) &&
		!/(^|\/)(__tests__|__mocks__)\//.test(posix) &&
		!/\.(spec|test)\.[jt]sx?$/.test(posix)
	)
}

const SOURCE_ROOTS = ["webview-ui/src", "src", "apps", "packages"]
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|html|snap)$/
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage", ".turbo", ".vite"])

function walk(dir, out) {
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const e of entries) {
		const full = path.join(dir, e.name)
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue
			// Locale files hold the keys, they do not use them.
			if (e.name === "locales" && path.basename(dir) === "i18n") continue
			walk(full, out)
		} else if (e.isFile() && SOURCE_EXT.test(e.name) && !/^package\.nls.*\.json$/.test(e.name)) {
			out.push(full)
		}
	}
}

/** Repository root, as seen from this script. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Reads the English webview locales and every searched source file of the repository.
 * @returns {{ localesDir: string, locales: Record<string, object>, sources: { file: string, text: string }[] }}
 */
export function loadRepo(root = REPO_ROOT) {
	const localesDir = path.join(root, "webview-ui/src/i18n/locales")
	const enDir = path.join(localesDir, "en")

	const locales = {}
	for (const f of fs
		.readdirSync(enDir)
		.filter((f) => f.endsWith(".json"))
		.sort()) {
		locales[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(enDir, f), "utf8"))
	}

	const files = []
	for (const r of SOURCE_ROOTS) walk(path.join(root, r), files)
	const sources = [...new Set(files)].map((file) => ({
		file: path.relative(root, file),
		text: fs.readFileSync(file, "utf8"),
	}))
	return { localesDir, locales, sources }
}

/**
 * Literal keys that are resolved some way the static scan cannot see. Keep this list short and explain each entry;
 * a key that is simply missing belongs in the locales, not here.
 */
const MISSING_KEY_IGNORE = []

/** Missing literal keys of the webview product code (tests and mocks excluded). */
export function findMissingWebviewKeys({ locales, sources }) {
	return findMissingKeys({
		locales,
		sources: sources.filter((s) => isWebviewProductFile(s.file)),
		ignore: MISSING_KEY_IGNORE,
	})
}

function main() {
	const args = new Set(process.argv.slice(2))
	const { localesDir, locales, sources } = loadRepo()

	if (args.has("--missing")) {
		const missing = findMissingWebviewKeys({ locales, sources })
		console.log(`${missing.length} literal webview key(s) missing from the English locale.`)
		for (const m of missing) console.log(`  ${m.key}  (${m.file})`)
		if (missing.length > 0) process.exit(1)
		return
	}

	const { unused, patterns } = findUnusedKeys({ locales, sources })

	const total = Object.values(locales).reduce((n, obj) => n + flattenKeys(obj).length, 0)
	const byNs = new Map()
	for (const u of unused) byNs.set(u.ns, [...(byNs.get(u.ns) ?? []), u.key])

	console.log(`Scanned ${sources.length} source files, ${total} English keys, ${unused.length} unused.`)
	for (const [ns, keys] of byNs) {
		console.log(`\n${ns} (${keys.length})`)
		for (const k of keys) console.log(`  ${ns}:${k}`)
	}

	if (args.has("--patterns")) {
		console.log("\nDynamic patterns that keep at least one key:")
		for (const p of patterns.filter((p) => p.covers.length > 0)) {
			console.log(`  ${p.source}  covers ${p.covers.length}  (${[...p.files].slice(0, 3).join(", ")})`)
		}
	}

	if (args.has("--write")) {
		const bases = new Map()
		for (const u of unused) bases.set(u.ns, new Set([...(bases.get(u.ns) ?? []), pluralBase(u.key)]))
		let entries = 0
		for (const lang of fs.readdirSync(localesDir).sort()) {
			for (const [ns, nsBases] of bases) {
				const file = path.join(localesDir, lang, `${ns}.json`)
				if (!fs.existsSync(file)) continue
				const obj = JSON.parse(fs.readFileSync(file, "utf8"))
				// Match by plural base so a locale with more plural forms (ru: _few, _many) loses all of them.
				const doomed = flattenKeys(obj).filter((k) => nsBases.has(pluralBase(k)))
				const { obj: next, removed } = removeKeys(obj, doomed)
				if (removed === 0) continue
				fs.writeFileSync(file, JSON.stringify(next, null, "\t") + "\n")
				entries += removed
			}
		}
		console.log(`\nRemoved ${entries} entries across all locales.`)
	}

	if (args.has("--check") && unused.length > 0) process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
}
