// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { test } from "node:test"

import {
	extractDynamicPatterns,
	findUnusedKeys,
	flattenKeys,
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
