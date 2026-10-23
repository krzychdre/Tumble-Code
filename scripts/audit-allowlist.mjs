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
		id: "GHSA-mrhx-c7xc-m3w5",
		module: "zod",
		reason: "Only the zod 3 copy of @lmstudio/sdk is affected; it validates the replies of the user's own LM Studio server when listing and loading models (src/api/providers/fetchers/lmstudio.ts). No zod 3 release is patched and @lmstudio/sdk 2.1.0 still requires zod 3.",
		removedBy: "an @lmstudio/sdk release that accepts zod 4 (then drop the @lmstudio/sdk>zod override too)",
		expires: "2026-12-31",
	},
]
