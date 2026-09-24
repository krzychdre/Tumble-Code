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
		id: "GHSA-6g55-p6wh-862q",
		module: "postcss",
		reason: "Reached only through styled-components, which bundles postcss but never runs it in the webview (no postcss file in the index.js source map). styled-components >= 6.4 drops postcss but pins csstype 3.2.3, which breaks the React 18 types.",
		removedBy: "WEB-2 (styled-components leaves the webview)",
		expires: "2026-12-31",
	},
	{
		id: "GHSA-r28c-9q8g-f849",
		module: "postcss",
		reason: "Same path as GHSA-6g55-p6wh-862q: styled-components' unused postcss.",
		removedBy: "WEB-2 (styled-components leaves the webview)",
		expires: "2026-12-31",
	},
	{
		id: "GHSA-qjx8-664m-686j",
		module: "js-cookie",
		reason: "Reached only through react-use's useCookie hook, which the webview does not use; the fix needs js-cookie 3, which react-use does not accept.",
		removedBy: "no plan item yet: replacing react-use is listed as an open WEB-Q candidate",
		expires: "2026-12-31",
	},
]
