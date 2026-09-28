/**
 * Advisories accepted on purpose by the dependency-audit gate
 * (`scripts/audit-gate.mjs`). Every entry says why the advisory does not reach
 * shipped code, which refactor item removes it, and when it must be looked at
 * again: after `expires` the gate fails until the entry is renewed or the
 * dependency is gone.
 *
 * Only high and critical advisories fail the gate, so only they need an entry.
 */
export const allowlist = [
	{
		id: "GHSA-qjx8-664m-686j",
		module: "js-cookie",
		reason: "Reached only through react-use's useCookie hook, which the webview does not use; the fix needs js-cookie 3, which react-use does not accept.",
		removedBy: "no plan item yet: replacing react-use is listed as an open WEB-Q candidate",
		expires: "2026-12-31",
	},
]
