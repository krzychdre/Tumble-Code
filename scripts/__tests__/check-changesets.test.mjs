import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkChangesets } from "../check-changesets.mjs"

function makeTree(changesets) {
	const root = mkdtempSync(join(tmpdir(), "check-changesets-"))
	mkdirSync(join(root, ".changeset"), { recursive: true })
	writeFileSync(join(root, ".changeset/config.json"), JSON.stringify({ ignore: ["@x/cli"] }))
	writeFileSync(join(root, ".changeset/README.md"), "# Changesets\n")
	for (const [dir, manifest] of [
		["src", { name: "ext", version: "1.0.0" }],
		["webview-ui", { name: "@x/webview" }],
		["apps/cli", { name: "@x/cli", version: "0.2.0" }],
		["packages/types", { name: "@x/types", version: "0.0.1" }],
	]) {
		mkdirSync(join(root, dir), { recursive: true })
		writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest))
	}
	for (const [file, packages] of Object.entries(changesets)) {
		const header = packages.map((name) => `"${name}": patch`).join("\n")
		writeFileSync(join(root, ".changeset", file), `---\n${header}\n---\n\nText.\n`)
	}
	return root
}

test("accepts one-sided changesets", () => {
	const root = makeTree({ "a.md": ["ext"], "b.md": ["@x/cli"], "c.md": ["@x/webview"], "d.md": ["ext", "@x/types"] })
	try {
		assert.deepEqual(checkChangesets({ root }).mixed, [])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("flags a changeset that mixes an ignored package with a released one", () => {
	const root = makeTree({ "a.md": ["ext", "@x/cli"] })
	try {
		assert.deepEqual(checkChangesets({ root }).mixed, [{ file: "a.md", ignored: ["@x/cli"], released: ["ext"] }])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("treats a package without a version as ignored", () => {
	const root = makeTree({ "a.md": ["@x/webview", "ext"] })
	try {
		assert.deepEqual(checkChangesets({ root }).mixed, [
			{ file: "a.md", ignored: ["@x/webview"], released: ["ext"] },
		])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
