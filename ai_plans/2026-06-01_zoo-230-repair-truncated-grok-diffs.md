# Zoo PR #230 — Repair truncated Grok diffs with missing markers

- **Upstream:** Zoo-Code #230 (squash of #186), commit `b5c5e2188`, merged 2026-05-23 07:49:33-0600, author Armando Vaquera.
- **Branch:** `feature/zoo-230-repair-truncated-grok-diffs` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`.

## Problem

Grok (and other models whose streamed output gets cut off mid-diff) frequently
truncate `apply_diff` payloads — a SEARCH block arrives without its `=======`
separator and/or its `>>>>>>> REPLACE` closer. `applyDiff` then fails with
`Expected '=======' was not found`, wasting a tool round and frustrating the user.
This is exactly the weak-model resilience the fork cares about.

## Fix (product — `src/core/diff/strategies/multi-search-replace.ts`)

Add a private `repairTruncatedDiff(diffContent: string): string` to
`MultiSearchReplaceDiffStrategy`, called at the top of `applyDiff` before
`validateMarkerSequencing`. It:

1. Returns input unchanged if there's no (unescaped) `<<<<<<< SEARCH` marker.
2. Splits into per-SEARCH blocks; emits complete blocks (have both `=======` and
   `>>>>>>> REPLACE`) verbatim, and passes through any prefix block (e.g. the
   filename line) untouched.
3. For an incomplete block, reinserts only the missing marker(s):
    - has `=======`, missing closer → append `\n>>>>>>> REPLACE`;
    - has closer, missing `=======` → splice `=======` in _before_ the existing
      closer (no second closer synthesized);
    - missing both → peel leading Grok header directives (`:start_line:`,
      `:end_line:`, `-------`) so the "first line is SEARCH content" heuristic sees
      real content; first content line becomes SEARCH, the rest REPLACE. A
      directive header with a single content line → that line is the SEARCH target,
      empty REPLACE. A bare single line → empty SEARCH, line as REPLACE.
4. Re-adds an inter-block `\n\n` separator when more non-empty blocks follow, so an
   appended closer never glues onto the next `<<<<<<< SEARCH`.

`applyDiff` uses a local `repairedDiff` (the `diffContent` param stays observable)
for both `validateMarkerSequencing(repairedDiff)` and the `repairedDiff.matchAll(...)`
extraction. Escaped markers (`\<<<<<<<` etc.) are preserved via negative lookbehinds.

The fork's `applyDiff` is structurally identical to upstream at the touch points
(validate call, single `matchAll`), so this is a faithful 1:1 port — no Tumble
renames needed inside this strategy.

## Tests (`src/core/diff/strategies/__tests__/multi-search-replace.spec.ts`)

Append (before the final outermost `})`):

- `describe("repairTruncatedDiff")` — 10 unit cases on the private method (accessed
  via `strategy["repairTruncatedDiff"]`): complete diff untouched; multi-complete
  untouched; missing both markers; missing only closer; first-block repair preserving
  later complete blocks; empty-search + missing closer; no double trailing newline;
  separator spliced before existing closer (exactly one closer/one separator);
  `:start_line:`/`-------` directives preserved; single content line after directive
  header → SEARCH target with empty REPLACE.
- `describe("truncated Grok diff regression (#186)")` — 3 end-to-end `applyDiff`
  fixtures: truncated closer; truncated before separator; well-formed multi-block
  unchanged.

## Scope / skip

No changeset (fork port workflow omits them). Product + tests only.

## Verification

- `npx vitest run core/diff/strategies/__tests__/multi-search-replace.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
