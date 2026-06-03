# Zoo #249 — Re-enable the `no-regex-spaces` ESLint rule

## §0 Context & Credit

Ported from Zoo-Code PR #249, commit `ba845d66b`.
Author: **0xMink** (human contributor).

```
Co-authored-by: 0xMink <260166390+0xMink@users.noreply.github.com>
```

renovate[bot] co-author dropped (bot-only automation, not ported).

## §1 What it does

`no-regex-spaces` was disabled in `src/eslint.config.mjs` under a generic
TODO comment. The PR:

1. Removes the `"no-regex-spaces": "off"` override so `eslint:recommended`
   enforces it again.
2. Auto-fixes the 40 resulting violations in 6 tree-sitter test files —
   consecutive literal spaces inside regex literals (`/ foo bar/`) are
   replaced with an explicit `{n}` quantifier (e.g. `/ foo {3}bar/`).
   Matching behaviour is identical.
3. Rewords the disabled-rules TODO comment so it refers only to the rules
   that remain listed, removing the implication that `no-regex-spaces` is
   still pending.

## §2 Scope cuts (what we do NOT do)

- Do **not** re-enable any other disabled rule (`no-useless-escape`,
  `no-empty`, `prefer-const`, `@typescript-eslint/*`).
- Do **not** add/remove TTS, router, cloud, or Roo-branding changes.
- Do **not** touch `.claude/zoo-port/` ledger (orchestrator manages that).

## §3 Exact edit — `src/eslint.config.mjs`

Before (lines 8-9):

```
			// TODO: These should be fixed and the rules re-enabled.
			"no-regex-spaces": "off",
```

After (single line):

```
			// TODO: The rules listed below should be re-enabled once their existing violations are fixed.
```

All other rules in the block remain untouched.

## §4 Verification commands

```bash
# Fix violations automatically
cd src && npx eslint --fix services/tree-sitter/__tests__/parseSourceCodeDefinitions.*.spec.ts

# Gate 1: lint must exit 0
cd src && pnpm lint

# Gate 2: types must report 13/13 successful
pnpm check-types   # from repo root
```
