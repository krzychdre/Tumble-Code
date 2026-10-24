#!/usr/bin/env node
/**
 * Guard: every changeset names released packages only, and every changeset
 * of the extension starts with a changelog label.
 *
 * changesets skips a package from the `ignore` list of .changeset/config.json
 * (the CLI) and a package without a `version` field (the webview): their
 * changesets never reach the changelog, and mixed with a released package
 * they break `changeset version` on main, after every PR check passed. The
 * CLI ships in the extension's release, so its changes name the extension.
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
	const skipped = []
	const unlabeled = []
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".md") || file === "README.md") continue
		const text = readFileSync(join(dir, file), "utf8")
		const packages = changesetPackages(text)
		const names = packages.filter((name) => ignored.has(name))
		if (names.length > 0) skipped.push({ file, packages: names })
		if (packages.includes(extension) && !labeled.test(changesetSummary(text))) unlabeled.push(file)
	}
	return { skipped, unlabeled, extension }
}

const isMain = process.argv[1] && process.argv[1].endsWith("check-changesets.mjs")

if (isMain) {
	const root = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd()
	const { skipped, unlabeled, extension } = checkChangesets({ root })
	for (const { file, packages } of skipped) {
		console.log(
			`.changeset/${file}: ${packages.join(", ")} is not released on its own; name "${extension}" instead`,
		)
	}
	for (const file of unlabeled) {
		console.log(
			`.changeset/${file}: start the summary with ${LABELS.map((l) => `"${l}: "`).join(", ")} (see .changeset/README.md)`,
		)
	}
	process.exit(skipped.length + unlabeled.length > 0 ? 1 : 0)
}
