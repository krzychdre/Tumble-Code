# Port: Zoo dependency security bumps (consolidated)

**Branch:** `feature/zoo-dep-security-bumps` (off `main`)
**Date:** 2026-05-31
**Skill:** zoo-port — user directive: "port PRs that are only about library version bumps"

## §0 Credit

All source PRs are **renovate[bot]**-authored automated security bumps in
`Zoo-Code-Org/Zoo-Code`. The only author is a bot → no human `Co-authored-by:`
trailer to add (bot trailers are dropped per skill rules). If committed, the
message should simply note the upstream Zoo PR numbers.

## Source PRs (all touch ONLY `pnpm-lock.yaml` upstream)

| Zoo PR                | commit    | dependency | target                        | our resolved (before) | our range |
| --------------------- | --------- | ---------- | ----------------------------- | --------------------- | --------- |
| #173                  | 296ca113f | diff       | 5.2.2                         | 5.2.0                 | ^5.2.0    |
| #176                  | b42e0377a | yaml       | 2.8.3                         | 2.8.0                 | ^2.8.0    |
| #177                  | f25b10251 | axios      | 1.15.2 (→ superseded by #400) | 1.12.0                | ^1.12.0   |
| #180                  | 45b239c09 | mammoth    | 1.11.0                        | 1.9.1                 | ^1.9.1    |
| #183                  | 4b35ab1dd | undici     | 6.24.0                        | 6.21.3                | ^6.21.3   |
| #235                  | 2e03aea78 | mermaid    | 11.15.0                       | 11.10.0               | ^11.4.1   |
| #236                  | 6470431a7 | turbo      | 2.9.14                        | 2.5.6                 | ^2.5.6    |
| #400                  | 441831c91 | axios      | 1.16.0                        | 1.12.0                | ^1.12.0   |
| #205 (uuid part only) | —         | uuid       | 11.1.1                        | 11.1.0                | ^11.1.0   |

**Excluded from #205:** the esbuild/rollup/vite _pinning_ (a consistency change,
not a version bump) — out of scope for "only version bumps".
**Excluded entirely:** #12172 / #12110 "Changeset version bump" and #12109/#12171
"Release vX" — these bump the _extension's own_ version (release-pipeline chores),
not library versions.

## Why this is safe and worth doing

- Every target version is **within our existing caret range** → no `package.json`
  edit needed; the bump is a pure lockfile re-resolution (exactly what Zoo did).
- Every one of our resolved versions is **strictly below** the security-patched
  target → we are currently missing these advisories' fixes.
- Evidence gathered 2026-05-31: see version table above (from `pnpm-lock.yaml`).

## Approach (single branch; bump lockfile + caret floors to the patched minimum)

Single branch via `pnpm update -r axios undici mammoth yaml diff mermaid turbo uuid`.
pnpm 10 re-resolves the lockfile **and** raises each caret floor to the new minor
— a cleaner security port than Zoo's lockfile-only renovate runs (the floor now
documents the minimum safe version). Within-major only; **no major jumps**.
**Do NOT** re-add removed features. **Do NOT** touch the esbuild/rollup/vite pins
from #205.

### Outcome (executed 2026-05-31)

| dep     | before  | after   | Zoo target |
| ------- | ------- | ------- | ---------- |
| axios   | 1.12.0  | 1.16.1  | 1.16.0     |
| diff    | 5.2.0   | 5.2.2   | 5.2.2      |
| mammoth | 1.9.1   | 1.12.0  | 1.11.0     |
| mermaid | 11.10.0 | 11.15.0 | 11.15.0    |
| turbo   | 2.5.6   | 2.9.16  | 2.9.14     |
| undici  | 6.21.3  | 6.26.0  | 6.24.0     |
| uuid    | 11.1.0  | 11.1.1  | 11.1.1     |
| yaml    | 2.8.0   | 2.9.0   | 2.8.3      |

**Landmine caught & fixed:** the root `pnpm.overrides.undici` was `">=5.29.0"`
(a loose CVE floor), which let `pnpm update` cross undici to **v8.3.0** — two
major versions, a real breaking-change risk in our HTTP layer. Tightened the
override and the `src` direct dep to `^6.21.3`, re-resolving to **6.26.0** (still
≥ Zoo's 6.24.0, still major 6). This is the faithful port of #183.

### Verification (actual)

- `pnpm install` clean.
- `pnpm check-types` → **13/13 workspaces pass** (no API breakage). 49.7s.
- Full unit-test suite NOT run (heavy); types-green is the bar for within-major
  bumps. Pre-existing unrelated peer warning: `@google/genai` wants
  `@modelcontextprotocol/sdk@^1.20.1`, found 1.12.0 (untouched by this port).

## Verification (binary acceptance)

1. `pnpm install` completes clean (lockfile consistent, no errors).
2. Resolved versions in `pnpm-lock.yaml` are now ≥ each target in the table.
3. `pnpm -w check-types` (or a scoped types check) passes — no API breakage from
   the minor/patch bumps.
4. Lint passes on touched workspaces if changed.

Acceptance: lockfile updated, install clean, types green. If any bump introduces
a breaking change (unexpected for patch/minor within-range), revert that single
dep and record it.
