import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkChangesets } from "../check-changesets.mjs"

function makeTree(changesets, summary = "Fixed: Text.") {
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
		writeFileSync(join(root, ".changeset", file), `---\n${header}\n---\n\n${summary}\n`)
	}
	return root
}

test("accepts labeled changesets of released packages", () => {
	const root = makeTree({ "a.md": ["ext"], "b.md": ["ext", "@x/types"] })
	try {
		assert.deepEqual(checkChangesets({ root }), { skipped: [], unlabeled: [], extension: "ext" })
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("flags changesets naming an ignored package or a package without a version", () => {
	const root = makeTree({ "a.md": ["ext", "@x/cli"], "b.md": ["@x/webview"], "c.md": ["ext"] })
	try {
		assert.deepEqual(checkChangesets({ root }).skipped, [
			{ file: "a.md", packages: ["@x/cli"] },
			{ file: "b.md", packages: ["@x/webview"] },
		])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("flags an extension changeset whose summary has no changelog label", () => {
	const root = makeTree({ "a.md": ["ext"], "c.md": ["@x/types"] }, "Text.")
	try {
		assert.deepEqual(checkChangesets({ root }).unlabeled, ["a.md"])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
