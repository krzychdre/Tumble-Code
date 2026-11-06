import { test } from "node:test"
import assert from "node:assert/strict"

import { auditProblems } from "../audit-gate.mjs"

const TODAY = "2026-11-06"
const ENTRY = { id: "GHSA-zod", module: "zod", via: "@lmstudio/sdk", expires: "2026-12-31" }

function report(...advisories) {
	return {
		advisories: Object.fromEntries(
			advisories.map(({ id, severity = "high", paths }, index) => [
				index,
				{
					github_advisory_id: id,
					severity,
					module_name: "zod",
					vulnerable_versions: "<4",
					title: "t",
					findings: [{ version: "3.25.76", paths }],
				},
			]),
		),
	}
}

for (const [name, audit, allowlist, expected] of [
	[
		"accepts an allowlisted advisory on its accepted path",
		report({ id: "GHSA-zod", paths: ["src>@lmstudio/sdk>zod", "src>@lmstudio/sdk>zod-to-json-schema>zod"] }),
		[ENTRY],
		[],
	],
	["ignores advisories below high", report({ id: "GHSA-other", severity: "moderate", paths: ["src>zod"] }), [], []],
	[
		"fails an unlisted high advisory",
		report({ id: "GHSA-other", paths: ["src>zod"] }),
		[],
		["high GHSA-other in zod (<4) via src>zod: t"],
	],
	[
		"fails an allowlisted advisory reaching the tree through another package",
		report({ id: "GHSA-zod", paths: ["src>@lmstudio/sdk>zod", "src>other>zod"] }),
		[ENTRY],
		["high GHSA-zod in zod (<4) via src>other>zod: t"],
	],
	[
		"fails an expired entry whose advisory is no longer reported",
		report(),
		[{ ...ENTRY, expires: "2026-11-05" }],
		["allowlist entry GHSA-zod (zod) expired on 2026-11-05: re-check it or remove the dependency"],
	],
]) {
	test(name, () => {
		assert.deepEqual(auditProblems(audit, allowlist, TODAY), expected)
	})
}
