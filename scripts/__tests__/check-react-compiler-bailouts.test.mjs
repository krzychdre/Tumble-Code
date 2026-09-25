// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { compareWithBaseline, findBailouts, toBaseline } from "../check-react-compiler-bailouts.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(here, "..", "check-react-compiler-bailouts.mjs")
const webviewRoot = path.resolve(here, "..", "..", "webview-ui")

// A component the compiler refuses: it disables a react-hooks rule.
const suppressed = `import { useEffect } from "react"
export function Suppressed({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	useEffect(() => {
		onChange(value)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value])
	return <div>{value}</div>
}
`

// Reads a ref during render, inside memo(): the name must come from the variable, not the arrow.
const refInRender = `import { memo, useRef } from "react"
export const RefReader = memo(({ label }: { label: string }) => {
	const ref = useRef(0)
	return <span>{label + ref.current}</span>
})
`

const clean = `import { useState } from "react"
export function Clean({ label }: { label: string }) {
	const [count, setCount] = useState(0)
	return <button onClick={() => setCount(count + 1)}>{label + count}</button>
}
`

/** A throwaway package directory whose node_modules is the webview's, so the real compiler runs. */
function makeRoot(files) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "compiler-bailouts-"))
	fs.writeFileSync(path.join(root, "package.json"), "{}\n")
	fs.symlinkSync(path.join(webviewRoot, "node_modules"), path.join(root, "node_modules"), "junction")
	for (const [name, code] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
		fs.writeFileSync(path.join(root, name), code)
	}
	return root
}

function run(root, ...args) {
	return spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" })
}

test("names the components the compiler skips and leaves compiled ones out", async () => {
	const root = makeRoot({
		"src/Suppressed.tsx": suppressed,
		"src/RefReader.tsx": refInRender,
		"src/Clean.tsx": clean,
		// Specs and mocks are not production code and are never checked.
		"src/__tests__/Suppressed.spec.tsx": suppressed,
	})
	try {
		const found = await findBailouts(root)
		assert.deepEqual(toBaseline(found), {
			"src/RefReader.tsx": ["RefReader"],
			"src/Suppressed.tsx": ["Suppressed"],
		})
		assert.match(found["src/Suppressed.tsx"][0].reason, /ESLint rules were disabled/)
		assert.equal(found["src/Suppressed.tsx"][0].line, 2)
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

test("reports new bailouts and stale baseline entries separately", () => {
	const found = {
		"src/A.tsx": [{ name: "A", line: 3, reason: "r" }],
		"src/B.tsx": [{ name: "B", line: 1, reason: "r" }],
	}
	const baseline = { "src/A.tsx": ["A"], "src/C.tsx": ["C"] }
	assert.deepEqual(compareWithBaseline(found, baseline), {
		added: [{ file: "src/B.tsx", name: "B", line: 1, reason: "r" }],
		stale: [{ file: "src/C.tsx", name: "C" }],
	})
})

test("the CLI fails on a new bailout, passes on the baseline and fails when an entry goes stale", () => {
	const root = makeRoot({ "src/Suppressed.tsx": suppressed, "src/Clean.tsx": clean })
	try {
		const fresh = run(root)
		assert.equal(fresh.status, 1, fresh.stderr)
		assert.match(fresh.stderr, /src\/Suppressed\.tsx:2 Suppressed: the React Compiler skips it \(new bailout\)/)

		assert.equal(run(root, "--update").status, 0)
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "react-compiler-bailouts.json"), "utf8")), {
			"src/Suppressed.tsx": ["Suppressed"],
		})
		const known = run(root)
		assert.equal(known.status, 0, known.stderr)

		// Fixing the component without shrinking the baseline must fail, or the next regression hides.
		fs.writeFileSync(path.join(root, "src/Suppressed.tsx"), clean.replace("Clean", "Suppressed"))
		const stale = run(root)
		assert.equal(stale.status, 1)
		assert.match(stale.stderr, /src\/Suppressed\.tsx Suppressed: compiles now, remove it/)
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})
