#!/usr/bin/env node
/**
 * Fail the dependency audit on any high or critical advisory in the shipped
 * dependencies that is not accepted in `scripts/audit-allowlist.mjs`, and on
 * any allowlist entry whose expiry date has passed.
 *
 * An entry accepts its advisory only on dependency paths through `via`: the
 * same advisory reaching the tree through another package fails the gate.
 *
 * Usage: pnpm audit --prod --json > audit.json; node scripts/audit-gate.mjs < audit.json
 */

import { readFileSync } from "node:fs"

import { allowlist } from "./audit-allowlist.mjs"

const BLOCKING = new Set(["high", "critical"])

export function auditProblems(report, allowlist, today) {
	const problems = []
	for (const entry of allowlist) {
		if (entry.expires < today) {
			problems.push(
				`allowlist entry ${entry.id} (${entry.module}) expired on ${entry.expires}: re-check it or remove the dependency`,
			)
		}
	}
	const accepted = new Map(allowlist.map((entry) => [entry.id, entry]))
	for (const advisory of Object.values(report.advisories ?? {})) {
		if (!BLOCKING.has(advisory.severity)) continue
		const id = advisory.github_advisory_id
		const entry = accepted.get(id)
		// A path reads "workspace>dependency>...>package".
		const paths = advisory.findings.flatMap((finding) => finding.paths)
		const unaccepted = entry ? paths.filter((path) => !path.includes(`>${entry.via}>`)) : paths
		if (unaccepted.length > 0) {
			problems.push(
				`${advisory.severity} ${id} in ${advisory.module_name} (${advisory.vulnerable_versions}) via ${unaccepted.join(", ")}: ${advisory.title}`,
			)
		}
	}
	return problems
}

const isMain = process.argv[1] && process.argv[1].endsWith("audit-gate.mjs")

if (isMain) {
	const report = JSON.parse(readFileSync(0, "utf8"))
	const problems = auditProblems(report, allowlist, new Date().toISOString().slice(0, 10))
	if (problems.length > 0) {
		console.error("Dependency audit failed:")
		for (const problem of problems) console.error(`- ${problem}`)
		process.exit(1)
	}
	console.log(
		`No unaccepted high or critical advisories (${allowlist.length} accepted, see scripts/audit-allowlist.mjs).`,
	)
}
