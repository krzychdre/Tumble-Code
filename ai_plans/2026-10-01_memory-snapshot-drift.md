# The dream notes snapshot drift: what a memory names that changed since it was written

Status: done on branch `feat/memory-snapshot-drift`. Follows
`ai_plans/2026-10-01_dream-verifies-time-bound-claims.md` (time-bound clauses, keyword based) and PR #661 (memory
files are written in English).

## Problem

The time-bound claim check finds clauses by keywords ("owed", "unmerged", "jeszcze nie"). Two gaps remain:

1. Keywords tie it to the languages listed (English, and Polish for older memories).
2. A memory goes stale in other ways than an unfinished task: it names a file that was later moved, a function that
   was later removed, a dependency version that was later bumped. Nothing flagged those.

## Measurements on the real shared memory store (122 files, 2026-10-01)

- **Naive "exists now" check**: 51 of 172 repo paths and 147 of 360 code names are missing on main. Mostly noise: paths
  from other repositories (`src/vte.cc`), build output (`dist/index.js`), paths relative to a package
  (`src/ui/theme.ts` for `apps/cli/src/ui/theme.ts`), library props (`flexGrow`), examples (`mcp_foo_bar`).
- **"Then versus now"** (the check below): 8 memories, every finding verified true by hand (`git log -S`).
- **PR merged after the memory was written**: rejected. All 3 hits were upstream Zoo-Code PR numbers (#49, #53, #92)
  colliding with this repository's numbers.
- **Every dependency the memory names, version changed**: rejected as noise ("diff" is a package and a word; a rule
  about running knip does not depend on knip's version). Kept only for versions the memory states itself.

## Design

A memory is a snapshot of the repository on the day it last changed (its mtime; the dream keeps mtimes when it edits).
`checkSnapshotDrift` (`src/core/memory/snapshotDrift.ts`, no model, no keywords) rebuilds that day's default branch
(`git rev-list -1 --first-parent --before=<mtime> origin/main`) and compares it with today's:

1. **Paths** the memory names that were tracked then (exactly, or as the unique file ending in `/<path>`) and are not
   tracked now. The last commit touching the path tells whether it moved (`R` in `git show -M --name-status`) or was
   removed.
2. **Code names** (code spans of 4+ characters, bare names of 6+ in code shape: lowerCamel, PascalCase with two humps,
   SCREAMING_SNAKE, snake_case) found in non-markdown files then and nowhere now. `git log -S<name>` gives the removing
   commit.
3. **Versions** the memory states next to a dependency name ("styled-components 6.4.4", "vitest v5") that matched a
   package.json range then and match none now.

Findings go into one line at the top of the memory body, read by Tumble's recall and by Claude Code alike:

```
> Checked against main on 2026-10-01 (note from 2026-09-27): `StyledPre` is no longer in the code (removed 2026-09-28, #611).
```

The line is rewritten only when its findings change (a copy goes to `.archive/` first, the mtime is kept), removed when
none are left, and at most five findings are shown ("and N more"). `.drift-checks.json` keeps the "then" side and the
history lookups per memory, keyed by mtime and the hash of what the memory names, so later dreams only run the "now"
side. It runs first in `consolidateMemories` when the dream has a `cwd`.

Performance: one `git grep -F -w` with 594 fixed strings took 49 s on this repository; the same search as one PCRE
alternation (`git grep -P`) takes 0.6 s. Git builds without PCRE fall back to the slow form. A full first pass over the
store takes about 10 s, later passes about 2-3 s.

## Results (real store, copy, 2026-10-01)

```
(note from 2026-09-28): `TaskHistoryAccess` is no longer in the code (removed 2026-09-28, #556).
(note from 2026-08-28): `packages/evals/src/cli/index.ts` was removed (2026-09-24, #252).
(note from 2026-05-26): `RooHandler` is no longer in the code (removed 2026-05-27, #28).
(note from 2026-07-30): `_compute_metrics` is no longer in the code (removed 2026-09-26, #441).
(note from 2026-08-25): `src/core/task/searchTaskHistory.ts` moved to `src/core/tools/helpers/searchTaskHistory.ts` (2026-09-28, #556).
(note from 2026-09-03): `expandOutput` is no longer in the code (removed 2026-09-10, #163).
(note from 2026-09-27): `StyledPre` is no longer in the code (removed 2026-09-28, #611).
(note from 2026-09-27): `webview-ui/src/utils/__tests__/TelemetryClient.spec.ts` was removed (2026-09-27, #545).
```

Few findings today because the 2026-09-27 audit touched most memories (their snapshot day is recent); they grow as the
code moves on.

## Limits

- A memory that was already wrong on the day it was written (naming something removed before) is not flagged: only
  change after the snapshot is.
- A memory edited after a change gets a new snapshot day and loses the finding, even when the edit did not touch the
  stale part. Tools that rewrite memories should keep mtimes, as the dream does.
- A rename with heavy edits (git similarity under 50%) reads as "removed".
