// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { test } from "node:test"

import { filterDiagnostics } from "../check-unused-locals.mjs"

const output = [
	"api/providers/a.ts(4,1): error TS6133: 'OpenAI' is declared but its value is never read.",
	"core/task/Task.ts(10,7): error TS6133: 'unused' is declared but its value is never read.",
	"core/task/Task.ts(20,3): error TS2322: Type 'string' is not assignable to type 'number'.",
	"  The expected type comes from property 'n'.",
	"api/transform/b.ts(1,1): error TS6192: All imports in import declaration are unused.",
	"api/providers/c.ts(9,2): error TS6196: 'Thing' is declared but never used.",
	"",
].join("\n")

test("keeps unused-local errors inside the enforced folders and drops them elsewhere", () => {
	const result = filterDiagnostics(output, ["api/"])

	assert.deepEqual(
		result.unused.map((d) => d.split(":")[0]),
		["api/providers/a.ts(4,1)", "api/transform/b.ts(1,1)", "api/providers/c.ts(9,2)"],
	)
	assert.equal(result.ignoredUnused, 1)
})

test("always keeps ordinary type errors, with their continuation lines", () => {
	const result = filterDiagnostics(output, ["api/"])

	assert.deepEqual(result.other, [
		"core/task/Task.ts(20,3): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
			"  The expected type comes from property 'n'.",
	])
})

test("a folder prefix matches whole path segments only", () => {
	const result = filterDiagnostics("apiary/x.ts(1,1): error TS6133: 'x' is declared but its value is never read.\n", [
		"api",
	])

	assert.deepEqual(result.unused, [])
	assert.equal(result.ignoredUnused, 1)
})
