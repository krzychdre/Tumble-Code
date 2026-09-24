#!/usr/bin/env node
/**
 * Turn `pnpm audit --json` output into a short Markdown summary: totals by
 * severity, then one row per vulnerable package with the workspaces that pull
 * it in. The raw report is over a megabyte and lists every dependency path;
 * this is what a person needs to decide what to upgrade.
 *
 * Usage: pnpm audit --prod --json | node scripts/audit-summary.mjs
 */

import { readFileSync } from "node:fs"

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"]

const report = JSON.parse(readFileSync(0, "utf8"))
const totals = report.metadata?.vulnerabilities ?? {}
const byPackage = new Map()

for (const advisory of Object.values(report.advisories ?? {})) {
	const entry = byPackage.get(advisory.module_name) ?? { severities: new Set(), count: 0, workspaces: new Set() }
	entry.severities.add(advisory.severity)
	entry.count += 1
	for (const finding of advisory.findings ?? []) {
		for (const path of finding.paths ?? []) {
			// A path reads "workspace>dependency>...>package"; pnpm writes "apps/cli" as "apps__cli".
			entry.workspaces.add(path.split(">")[0].replace(/__/g, "/"))
		}
	}
	byPackage.set(advisory.module_name, entry)
}

const worst = (severities) => Math.min(...[...severities].map((s) => SEVERITY_ORDER.indexOf(s)))
const rows = [...byPackage.entries()].sort(
	([a, x], [b, y]) => worst(x.severities) - worst(y.severities) || a.localeCompare(b),
)

const lines = [
	"## Dependency audit (production dependencies)",
	"",
	SEVERITY_ORDER.filter((s) => totals[s])
		.map((s) => `${s}: ${totals[s]}`)
		.join(", ") || "No known advisories.",
	"",
]

if (rows.length > 0) {
	lines.push("| Package | Worst severity | Advisories | Reached from |", "| --- | --- | --- | --- |")
	for (const [name, entry] of rows) {
		const workspaces = [...entry.workspaces].sort().join(", ")
		lines.push(`| ${name} | ${SEVERITY_ORDER[worst(entry.severities)]} | ${entry.count} | ${workspaces} |`)
	}
}

console.log(lines.join("\n"))
