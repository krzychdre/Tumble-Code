# Port plan — Zoo PR #56 → `feature/zoo-56-bump-baseten-1.0.50`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #56 `Update dependency @ai-sdk/baseten to v1.0.50`
  (commit `c2d87bb9a`, merged 2026-05-16).
- **Original author:** renovate[bot]. **No `Co-authored-by:` trailer** — the only
  author is a bot, and the credit rule drops bots when no human remains.
- **Why this is portable (redo of an earlier `skip`):** I had recorded #56 as
  `skip` ("our deps flow owns these"), but the user marked the report `[x] PORT`.
  On re-examination our fork genuinely ships this dependency — `@ai-sdk/baseten`
  backs the real provider at `src/api/providers/baseten.ts` — pinned at
  `^1.0.31`. So the bump applies cleanly and is a low-risk patch-level move
  within `1.0.x`.

## §1 What it does

Bumps `@ai-sdk/baseten` from `^1.0.31` to `^1.0.50`. The upstream PR only touched
`pnpm-lock.yaml` (renovate). In our fork the manifest carries the caret range, so
the port is: raise the range in `src/package.json` and regenerate the lockfile.
The transitive `@ai-sdk/provider` (3.0.8→3.0.10) and `@ai-sdk/provider-utils`
(4.0.14→4.0.27) move with it — identical to what Zoo's lockfile pulled.

## §2 Scope cuts (YAGNI) / landmines

- Only the baseten dep + its transitive `@ai-sdk/*` entries change. No product
  code, no provider behavior change.
- Do **not** hand-edit `pnpm-lock.yaml`; let `pnpm install` resolve it.
- Removed-feature landmines: none (no TTS / router / cloud / Roo branding here).

## §3 Edits

1. `src/package.json` line 453:
    - before: `"@ai-sdk/baseten": "^1.0.31",`
    - after: `"@ai-sdk/baseten": "^1.0.50",`
2. Regenerate lockfile: `pnpm install` (resolved to `1.0.51`, the latest patch
   within `^1.0.50` — allowed and preferred over Zoo's exact `1.0.50`).

## §4 Verification (binary acceptance)

- `cd src && pnpm check-types` → exit 0 ✅
- `cd src && pnpm lint` → exit 0 ✅
- root `pnpm check-types` → 13/13 workspaces ✅
- root `pnpm bundle` → 4/4 ✅
- `src/node_modules/@ai-sdk/baseten` resolves to `1.0.51` ✅

No baseten-specific unit tests exist; the meaningful gate is that the provider
(`src/api/providers/baseten.ts`) still type-checks against the new SDK surface —
it does.
