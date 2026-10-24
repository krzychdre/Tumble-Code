#!/usr/bin/env node
/**
 * Guard: no changeset may mix ignored and released packages, and every
 * changeset of the extension starts with a changelog label.
 *
 * `changeset version` refuses a changeset file that names a package from the
 * `ignore` list of .changeset/config.json (today `@tumble-code/cli`), or a
 * package without a `version` field (which changesets treats the same way,
 * e.g. `@tumble-code/vscode-webview`), together with any other package. Only
 * the Changeset Release workflow runs that command, after the merge, so a
 * mixed file passed every PR check and broke the release on main. A change
 * that ships in both the extension and the CLI needs two changeset files.
 *
 * scripts/format-changelog.mjs, also run only on release, fails on an
 * extension changeset without a "New:"-style label (.changeset/README.md).
 *
 * Usage: node scripts/check-changesets.mjs [--root <dir>]
 * Exit 0 = clean, 1 = offending files listed on stdout.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { LABELS } from "./format-changelog.mjs"

// The globs of pnpm-workspace.yaml: two packages by path, two directories of packages.
const WORKSPACE_PACKAGES = ["src", "webview-ui"]
const WORKSPACE_DIRS = ["apps", "packages"]

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"))
}

/** The workspace packages changesets leaves alone: the ignore list plus every package without a version. */
function ignoredPackages(root) {
	const ignored = new Set(readJson(join(root, ".changeset/config.json")).ignore ?? [])
	const dirs = [
		...WORKSPACE_PACKAGES,
		...WORKSPACE_DIRS.flatMap((dir) =>
			existsSync(join(root, dir)) ? readdirSync(join(root, dir)).map((name) => join(dir, name)) : [],
		),
	]
	for (const dir of dirs) {
		const manifest = join(root, dir, "package.json")
		if (!existsSync(manifest)) continue
		const { name, version } = readJson(manifest)
		if (name && !version) ignored.add(name)
	}
	return ignored
}

/** The package names in a changeset's front matter. */
function changesetPackages(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!match) return []
	return [...match[1].matchAll(/^\s*["']?([^"':]+)["']?\s*:/gm)].map((m) => m[1].trim())
}

/** The text after a changeset's front matter. */
function changesetSummary(text) {
	return text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").trim()
}

export function checkChangesets({ root }) {
	const ignored = ignoredPackages(root)
	const extension = readJson(join(root, "src/package.json")).name
	const labeled = new RegExp(`^(${LABELS.join("|")}): `)
	const dir = join(root, ".changeset")
	const mixed = []
	const unlabeled = []
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".md") || file === "README.md") continue
		const text = readFileSync(join(dir, file), "utf8")
		const packages = changesetPackages(text)
		const skipped = packages.filter((name) => ignored.has(name))
		if (skipped.length > 0 && skipped.length < packages.length) {
			mixed.push({ file, ignored: skipped, released: packages.filter((name) => !ignored.has(name)) })
		}
		if (packages.includes(extension) && !labeled.test(changesetSummary(text))) unlabeled.push(file)
	}
	return { mixed, unlabeled }
}

const isMain = process.argv[1] && process.argv[1].endsWith("check-changesets.mjs")

if (isMain) {
	const root = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd()
	const { mixed, unlabeled } = checkChangesets({ root })
	for (const { file, ignored, released } of mixed) {
		console.log(
			`.changeset/${file}: ${ignored.join(", ")} cannot share a changeset with ${released.join(", ")}; split it into one file per side`,
		)
	}
	for (const file of unlabeled) {
		console.log(
			`.changeset/${file}: start the summary with ${LABELS.map((l) => `"${l}: "`).join(", ")} (see .changeset/README.md)`,
		)
	}
	process.exit(mixed.length + unlabeled.length > 0 ? 1 : 0)
}
