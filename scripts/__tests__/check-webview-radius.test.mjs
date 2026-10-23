// node --test 'scripts/__tests__/*.test.mjs'

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(here, "..", "check-webview-radius.mjs")

/** The script scans `src/` under its working directory, as webview-ui's lint script runs it. */
function runOn(files) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "webview-radius-"))
	try {
		for (const [name, text] of Object.entries(files)) {
			const file = path.join(root, "src", name)
			fs.mkdirSync(path.dirname(file), { recursive: true })
			fs.writeFileSync(file, text)
		}
		const { status, stderr } = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" })
		return { status, offenders: stderr.split("\n").filter((line) => line.startsWith("  ")) }
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
}

test("accepts the two radius tokens and skips specs, comments, declaration files and other CSS", () => {
	const { status, offenders } = runOn({
		"Card.tsx": [
			`<div className="rounded-control p-2" />`,
			`<div className={cn("hover:rounded-floating", open && "rounded-t-control rounded-bl-floating")} />`,
			`<div style={{ borderRadius: 0, padding: 2 }} />`,
			`<div style={{ borderRadius: "var(--radius-control)" }} />`,
			`// a rounded-full pill used to sit here`,
			` * rounded-md in a doc comment`,
		].join("\n"),
		"Card.spec.tsx": `<div className="rounded-full" />`,
		"__tests__/helpers.ts": `const cls = "rounded-md"`,
		"vendor.d.ts": `declare const style: { borderRadius: 3 }`,
		"index.css": [
			".a { border-radius: 0; }",
			".b { border-radius: unset; }",
			".c { border-radius: var(--radius-floating); }",
			".d { border-radius: var(--radius-control) !important; }",
		].join("\n"),
		"other.css": ".e { border-radius: 3px; }",
	})
	assert.deepEqual(offenders, [])
	assert.equal(status, 0)
})

test("reports every other rounded class, inline radius and index.css radius with its location", () => {
	const { status, offenders } = runOn({
		"Bad.tsx": [
			`<div className="rounded" />`,
			`<div className="p-1 rounded-full" />`,
			`<div className="hover:rounded-md" />`,
			`<div className="rounded-[3px]" />`,
			`<div style={{ borderRadius: 4 }} />`,
			`<div style={{ borderRadius: "var(--radius-pill)" }} />`,
		].join("\n"),
		"index.css": ".x { border-radius: 3px; }",
	})
	const bad = path.join("src", "Bad.tsx")
	const css = path.join("src", "index.css")
	assert.equal(status, 1)
	assert.equal(offenders.length, 7)
	for (const line of [1, 2, 3, 4]) {
		assert.ok(offenders.some((o) => o.includes(`${bad}:${line}: rounded* class`)), `Bad.tsx:${line}`)
	}
	for (const line of [5, 6]) {
		assert.ok(offenders.some((o) => o.includes(`${bad}:${line}: hard-coded borderRadius`)), `Bad.tsx:${line}`)
	}
	assert.ok(offenders.some((o) => o.includes(`${css}:1: non-zero CSS border-radius`)))
})
