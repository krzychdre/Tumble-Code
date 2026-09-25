// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { test } from "node:test"

import {
	extractDynamicPatterns,
	extractLiteralKeys,
	findMissingKeys,
	findMissingWebviewKeys,
	findUnusedKeys,
	flattenKeys,
	hasKey,
	isWebviewProductFile,
	loadRepo,
	pluralBase,
	removeKeys,
} from "../find-unused-i18n-keys.mjs"

test("flattenKeys lists every leaf as a dotted path", () => {
	assert.deepEqual(flattenKeys({ a: "x", b: { c: "y", d: { e: "z" } } }), ["a", "b.c", "b.d.e"])
})

test("pluralBase strips i18next plural suffixes and nothing else", () => {
	assert.equal(pluralBase("items.count_one"), "items.count")
	assert.equal(pluralBase("items.count_other"), "items.count")
	assert.equal(pluralBase("items.count_plural"), "items.count")
	assert.equal(pluralBase("items.max_tokens"), "items.max_tokens")
})

test("a template literal with an interpolated segment becomes a dynamic pattern", () => {
	const patterns = extractDynamicPatterns("t(`settings:providers.${id}.label`)")
	assert.equal(patterns.length, 1)
	assert.ok(patterns[0].regex.test("settings:providers.openai.label"))
	assert.ok(!patterns[0].regex.test("settings:providers.openai.description"))
	assert.ok(!patterns[0].regex.test("settings:other.openai.label"))
})

test("a multi-line template literal is still found", () => {
	const patterns = extractDynamicPatterns("t(\n\t`chat:status.${\n\t\tstate\n\t}`,\n)")
	assert.equal(patterns.length, 1)
	assert.ok(patterns[0].regex.test("chat:status.running"))
})

test("templates that are not key shaped are ignored", () => {
	assert.deepEqual(extractDynamicPatterns("`${a}.${b}`"), [])
	assert.deepEqual(extractDynamicPatterns("`width: ${w}px`"), [])
	// A namespace alone says nothing about which keys are used.
	assert.deepEqual(extractDynamicPatterns("`mcp:${server}`"), [])
})

test("a string literal ending with a dot is a concatenation prefix", () => {
	const patterns = extractDynamicPatterns('t("settings:codeIndex." + provider)')
	assert.equal(patterns.length, 1)
	assert.ok(patterns[0].regex.test("settings:codeIndex.openai"))
	assert.ok(patterns[0].regex.test("settings:codeIndex.nested.key"))
})

const locales = {
	chat: {
		title: "Chat",
		used: { plain: "a", count_one: "b", count_other: "c" },
		dynamic: { alpha: "d", beta: "e" },
		dead: { gone: "f" },
		bare: "only referenced without namespace",
	},
	settings: { title: "Settings", orphan: "g" },
}

const sources = [
	{ file: "a.tsx", text: 't("chat:used.plain")\nt("chat:used.count", { count })\nt(`chat:dynamic.${x}`)' },
	{ file: "b.tsx", text: 'const { t } = useTranslation("chat")\nt("bare")' },
	{ file: "c.ts", text: '<Trans i18nKey="settings:title" />' },
]

test("findUnusedKeys reports only keys with no static or dynamic reference", () => {
	const { unused } = findUnusedKeys({ locales, sources })
	assert.deepEqual(
		unused.map((u) => `${u.ns}:${u.key}`),
		["chat:title", "chat:dead.gone", "settings:orphan"],
	)
})

test("a one-segment key counts as used only with its namespace or in a file bound to that namespace", () => {
	const { unused } = findUnusedKeys({
		locales: { settings: { title: "x" } },
		sources: [{ file: "x.tsx", text: '"title"' }],
	})
	assert.deepEqual(
		unused.map((u) => u.key),
		["title"],
	)
})

test("removeKeys deletes leaves and prunes objects left empty, keeping key order", () => {
	const obj = { a: "1", b: { c: "2", d: { e: "3" } }, f: "4" }
	const result = removeKeys(obj, ["b.d.e", "f", "missing.key"])
	assert.deepEqual(result.obj, { a: "1", b: { c: "2" } })
	assert.equal(result.removed, 2)
	assert.deepEqual(Object.keys(result.obj), ["a", "b"])
})

test("extractLiteralKeys finds t() and i18nKey literals with their namespace", () => {
	const text = [
		't("chat:a.b")',
		"i18n.t('common:c')",
		'<Trans i18nKey="settings:d.e" />',
		'<Trans i18nKey={"settings:f"} />',
		"t(`chat:${dynamic}`)",
		'format("chat:not.a.call")',
	].join("\n")
	assert.deepEqual(
		extractLiteralKeys(text).map((k) => `${k.ns}:${k.key}`),
		["chat:a.b", "common:c", "settings:d.e", "settings:f"],
	)
})

test("extractLiteralKeys resolves a bare key only in a file bound to exactly one namespace", () => {
	assert.deepEqual(extractLiteralKeys('useTranslation("mcp")\nt("execution.running")'), [
		{ ns: "mcp", key: "execution.running" },
	])
	assert.deepEqual(extractLiteralKeys('useTranslation("a")\nuseTranslation("b")\nt("x.y")'), [])
	assert.deepEqual(extractLiteralKeys('t("x.y")\nt("word")'), [])
})

test("extractLiteralKeys skips JSDoc examples and line comments", () => {
	assert.deepEqual(extractLiteralKeys(' * label={t("settings:example.label")}\n// t("chat:old")'), [])
})

test("hasKey accepts a leaf, a plural family or an object, and nothing else", () => {
	const obj = { a: { leaf: "x", count_one: "1", count_other: "n", group: { inner: "y" } } }
	assert.ok(hasKey(obj, "a.leaf"))
	assert.ok(hasKey(obj, "a.count"))
	assert.ok(hasKey(obj, "a.group"))
	assert.ok(!hasKey(obj, "a.missing"))
	assert.ok(!hasKey(obj, "a.leaf.deeper"))
	assert.ok(!hasKey(obj, "b.leaf"))
})

test("findMissingKeys reports literal keys the locale lacks, once per file, minus the ignore list", () => {
	const missing = findMissingKeys({
		locales: { chat: { here: "x", n_one: "1", n_other: "n" } },
		sources: [
			{ file: "a.tsx", text: 't("chat:here")\nt("chat:n", { count })\nt("chat:gone")\nt("chat:gone")' },
			{ file: "b.tsx", text: 't("nons:key")\nt("chat:known.elsewhere")' },
		],
		ignore: ["chat:known.elsewhere"],
	})
	assert.deepEqual(missing, [
		{ file: "a.tsx", key: "chat:gone" },
		{ file: "b.tsx", key: "nons:key" },
	])
})

test("isWebviewProductFile keeps webview sources and drops tests and mocks", () => {
	assert.ok(isWebviewProductFile("webview-ui/src/components/chat/ChatRow.tsx"))
	assert.ok(!isWebviewProductFile("webview-ui/src/components/chat/__tests__/ChatRow.spec.tsx"))
	assert.ok(!isWebviewProductFile("webview-ui/src/i18n/__mocks__/setup.ts"))
	assert.ok(!isWebviewProductFile("webview-ui/src/utils/format.test.ts"))
	assert.ok(!isWebviewProductFile("src/core/task/Task.ts"))
})

test("every literal translation key the webview uses exists in the English locale", () => {
	const missing = findMissingWebviewKeys(loadRepo())
	assert.deepEqual(
		missing.map((m) => `${m.key} (${m.file})`),
		[],
		"these keys would render as raw text; add them to every locale or remove the usage",
	)
})
