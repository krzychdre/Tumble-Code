#!/usr/bin/env node
/**
 * Rewrites the release section that `changeset version` just added to the
 * extension changelog into the published layout:
 *
 *   ## 1.2.0
 *
 *   Released 2026-11-02
 *
 *   <highlights paragraphs>
 *
 *   ### New / ### Improved / ### Fixed
 *
 * changesets heads the section "## 1.2.0" and groups it by semver bump
 * ("Minor Changes", "Patch Changes"); those headings are dropped. The heading
 * stays the bare version: changesets/action finds the entry for the version
 * bump PR by it. Every bullet starts with the label its changeset summary
 * starts with (see .changeset/README.md). A first section without bump
 * headings is a formatted release: no new extension changesets, nothing to do.
 *
 * Usage: node scripts/format-changelog.mjs <CHANGELOG.md>
 */

import { readFileSync, writeFileSync } from "node:fs"

export const LABELS = ["Highlights", "New", "Improved", "Fixed"]

const ENTRY = new RegExp(`^- (${LABELS.join("|")}): (.*)$`)

const BUMP_HEADING = /^### (Major|Minor|Patch) Changes$/

export function formatChangelog(text, date) {
	const lines = text.split("\n")
	const start = lines.findIndex((line) => line.startsWith("## "))
	const next = lines.findIndex((line, i) => i > start && line.startsWith("## "))
	const end = next === -1 ? lines.length : next
	if (!lines.slice(start + 1, end).some((line) => BUMP_HEADING.test(line))) return text
	const entries = Object.fromEntries(LABELS.map((label) => [label, []]))
	for (const line of lines.slice(start + 1, end)) {
		if (!line.startsWith("- ")) continue
		const match = line.match(ENTRY)
		if (!match) throw new Error(`changelog entry without a ${LABELS.join("/")} label: ${line}`)
		entries[match[1]].push(match[2])
	}

	const section = [lines[start], "", `Released ${date}`, ""]
	for (const paragraph of entries.Highlights) section.push(paragraph, "")
	for (const label of LABELS.slice(1)) {
		if (entries[label].length === 0) continue
		section.push(`### ${label}`, "", ...entries[label].map((entry) => `- ${entry}`), "")
	}
	return [...lines.slice(0, start), ...section, ...lines.slice(end)].join("\n")
}

const isMain = process.argv[1] && process.argv[1].endsWith("format-changelog.mjs")

if (isMain) {
	const path = process.argv[2]
	const date = new Date().toISOString().slice(0, 10)
	writeFileSync(path, formatChangelog(readFileSync(path, "utf8"), date))
}
