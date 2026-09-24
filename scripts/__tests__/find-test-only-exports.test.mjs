// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { test } from "node:test"

import { findTestOnlyExports, isTestFile } from "../find-test-only-exports.mjs"

test("isTestFile recognizes spec, test, __tests__ and __mocks__ paths", () => {
	assert.equal(isTestFile("src/a/__tests__/b.ts"), true)
	assert.equal(isTestFile("src/a/b.spec.ts"), true)
	assert.equal(isTestFile("webview-ui/src/c.test.tsx"), true)
	assert.equal(isTestFile("src/__mocks__/vscode.js"), true)
	assert.equal(isTestFile("src/a/b.ts"), false)
})

test("reports an export that only a test references, and a file whose exports all are", () => {
	const files = new Map([
		["src/lib/dead.ts", "export function onlyTested() {}\nexport const alsoOnlyTested = 1\n"],
		["src/lib/__tests__/dead.spec.ts", 'import { onlyTested, alsoOnlyTested } from "../dead"\n'],
		["src/lib/mixed.ts", "export function used() {}\nexport function testedHelper() {}\n"],
		["src/lib/__tests__/mixed.spec.ts", 'import { used, testedHelper } from "../mixed"\n'],
		["src/main.ts", 'import { used } from "./lib/mixed"\nused()\n'],
	])

	const result = findTestOnlyExports(files)

	assert.deepEqual(
		result.exports.map((e) => `${e.file}:${e.name}`),
		["src/lib/dead.ts:alsoOnlyTested", "src/lib/dead.ts:onlyTested", "src/lib/mixed.ts:testedHelper"],
	)
	assert.deepEqual(result.files, ["src/lib/dead.ts"])
})

test("does not report an export that production code references, or one nobody references", () => {
	const files = new Map([
		["src/a.ts", "export interface Shape {}\nexport type Id = string\nexport class Unreferenced {}\n"],
		["src/b.ts", 'import type { Shape, Id } from "./a"\n'],
		["src/__tests__/a.spec.ts", 'import type { Shape } from "../a"\n'],
	])

	const result = findTestOnlyExports(files)

	// Unreferenced exports are knip's job; this scan only covers the test-only gap.
	assert.deepEqual(result.exports, [])
	assert.deepEqual(result.files, [])
})

test("ignores a mention of the name inside a comment of a production file", () => {
	const files = new Map([
		["src/a.ts", "export function legacyHelper() {}\n"],
		["src/b.ts", "// legacyHelper used to live here\n/* legacyHelper */\nexport const x = 1\n"],
		["src/__tests__/a.spec.ts", 'import { legacyHelper } from "../a"\n'],
		["src/c.ts", 'import { x } from "./b"\n'],
	])

	const result = findTestOnlyExports(files)

	assert.deepEqual(
		result.exports.map((e) => e.name),
		["legacyHelper"],
	)
})

test("marks an export that its own file still uses, since only the export keyword is dead", () => {
	const files = new Map([
		["src/a.ts", "export function inner() {}\nexport function outer() { return inner() }\n"],
		["src/b.ts", 'import { outer } from "./a"\n'],
		["src/__tests__/a.spec.ts", 'import { inner } from "../a"\n'],
	])

	const result = findTestOnlyExports(files)

	assert.deepEqual(result.exports, [{ file: "src/a.ts", name: "inner", usedInOwnFile: true }])
	assert.deepEqual(result.files, [])
})

test("lists exports that no other file mentions separately, for --unreferenced", () => {
	const files = new Map([
		["src/a.ts", "export function nobodyCalls() {}\nexport const selfUsed = 1\nconsole.log(selfUsed)\n"],
		["src/b.ts", 'import "./a"\n'],
	])

	const result = findTestOnlyExports(files)

	assert.deepEqual(result.unreferenced, [
		{ file: "src/a.ts", name: "nobodyCalls", usedInOwnFile: false },
		{ file: "src/a.ts", name: "selfUsed", usedInOwnFile: true },
	])
	assert.deepEqual(result.exports, [])
	assert.deepEqual(result.files, [])
})

test("never reports a whole file that also has a default export or an export list", () => {
	const files = new Map([
		["src/View.tsx", "export interface ViewProps {}\nconst View = () => null\nexport default View\n"],
		["src/app.tsx", 'import View from "./View"\n'],
		["src/__tests__/View.spec.tsx", 'import type { ViewProps } from "../View"\n'],
	])

	const result = findTestOnlyExports(files)

	assert.deepEqual(result.files, [])
	assert.deepEqual(
		result.exports.map((e) => e.name),
		["ViewProps"],
	)
})
