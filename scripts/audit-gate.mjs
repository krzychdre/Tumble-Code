#!/usr/bin/env node
/**
 * Fail the dependency audit on any high or critical advisory in the shipped
 * dependencies that is not accepted in `scripts/audit-allowlist.mjs`, and on
 * any allowlist entry whose expiry date has passed.
 *
 * Usage: pnpm audit --prod --json | node scripts/audit-gate.mjs
 */

import { readFileSync } from "node:fs"

import { allowlist } from "./audit-allowlist.mjs"

const BLOCKING = new Set(["high", "critical"])

const report = JSON.parse(readFileSync(0, "utf8"))
const today = new Date().toISOString().slice(0, 10)
const accepted = new Map(allowlist.map((entry) => [entry.id, entry]))
const problems = []

for (const advisory of Object.values(report.advisories ?? {})) {
	if (!BLOCKING.has(advisory.severity)) continue
	const id = advisory.github_advisory_id
	const entry = accepted.get(id)
	if (!entry) {
		problems.push(
			`${advisory.severity} ${id} in ${advisory.module_name} (${advisory.vulnerable_versions}): ${advisory.title}`,
		)
	} else if (entry.expires < today) {
		problems.push(
			`allowlist entry ${id} (${entry.module}) expired on ${entry.expires}: re-check it or remove the dependency`,
		)
	}
}

if (problems.length > 0) {
	console.error("Dependency audit failed:")
	for (const problem of problems) console.error(`- ${problem}`)
	process.exit(1)
}

console.log(
	`No unaccepted high or critical advisories (${allowlist.length} accepted, see scripts/audit-allowlist.mjs).`,
)
