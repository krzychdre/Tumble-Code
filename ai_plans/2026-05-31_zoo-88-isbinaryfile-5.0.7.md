# Zoo PR #88 — fix: upgrade isbinaryfile to ^5.0.7

**Upstream:** Zoo-Code PR #88, merged 2026-05-13 (`58da38450`), author f14XuanLv
**Branch:** `feature/zoo-88-isbinaryfile-5.0.7` (off `main`)
**Type:** Chore/fix — single dependency bump.

## Why PORT (despite triage SKIP)

Triage verdict was SKIP ("our deps flow owns these"), but the report's decision line is
`[x] PORT` — a genuine user override, so it appears in the `approved` list and is the
oldest unported approved PR for 2026-05-13 (merged 11:29, before #95 at 23:54). We honor
the explicit decision. The bump is a patch-range move within the same major (5.x), low risk.

## What the upstream PR does

Bumps `isbinaryfile` in `src/package.json` from `^5.0.2` → `^5.0.7` and updates
`pnpm-lock.yaml` accordingly (resolved 5.0.4 → 5.0.7). No source changes.

| File               | Change                                     |
| ------------------ | ------------------------------------------ |
| `src/package.json` | `"isbinaryfile": "^5.0.2"` → `"^5.0.7"`    |
| `pnpm-lock.yaml`   | specifier + resolved version 5.0.4 → 5.0.7 |

## Scope in our fork

The `isbinaryfile` line in our `src/package.json` is identical to the upstream pre-image
(`^5.0.2`, resolving to 5.0.4 in our lock), so this is a clean apply. `src/package.json`
shows DIVERGED overall only because of unrelated fork differences elsewhere in the file.

Tumble naming: N/A — third-party dependency version.

## Plan

1. Edit `src/package.json`: `"isbinaryfile": "^5.0.2"` → `"^5.0.7"`.
2. Run `pnpm install` to regenerate the `pnpm-lock.yaml` entry (resolve 5.0.7) rather than
   hand-editing the lockfile — keeps the lock internally consistent with our resolver.
3. Confirm the lock now pins `isbinaryfile@5.0.7` and no unrelated lock churn.

## Verification

- `grep isbinaryfile` in src/package.json shows `^5.0.7`; lockfile shows `isbinaryfile@5.0.7`.
- `git diff pnpm-lock.yaml` limited to the isbinaryfile block (no unrelated dep churn).
- Build gate: `pnpm install:vsix -y --editor=code` — green before push.

## Credit

Co-authored-by: f14XuanLv <121799454+f14XuanLv@users.noreply.github.com>
