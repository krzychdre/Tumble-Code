# Condense Keep-Boundary Forward Fallback

**Date:** 2026-07-12
**Branch:** `fix/condense-keep-boundary-tool-pairs`
**Type:** Bug fix (register tech-debt, promoted — silent context loss)

## Problem

`computeCondenseKeepBoundary` in `src/core/condense/index.ts` pulls the boundary
backward from `messages.length - keepRecent` to avoid splitting a
`tool_use`/`tool_result` pair. The backward pull is capped at
`minBoundary = max(floor, messages.length - keepRecent * 2)`.

When a long interleaved tool chain has NO satisfying boundary within that backward
window, the loop exits at the cap and `Math.max(boundary, floor)` is returned — a
boundary that STILL SPLITS a pair. Downstream, the kept tail starts with orphaned
`tool_result` blocks; `getEffectiveApiHistory` drops them — silent context loss
(or a 400) precisely in long multi-tool weak-model workflows.

The function's doc comment claimed "The boundary does not split a tool_use/tool_result
pair" — a false promise in the capped case.

## Root Cause

The backward-only search has no escape hatch when the cap is exhausted. The loop
condition `boundary > minBoundary && !toolPairsSatisfiedFrom(...)` exits at
`boundary === minBoundary` regardless of whether `toolPairsSatisfiedFrom` is
satisfied, and the final `Math.max(boundary, floor)` returns that unsatisfying
boundary.

## Fix

Keep the existing backward pull (prefer keeping MORE raw messages, bounded exactly
as today). NEW: if the backward search exhausts the cap without satisfying
`toolPairsSatisfiedFrom`, fall FORWARD instead: search from
`messages.length - keepRecent` UPWARD (boundary++) for the first satisfying
boundary.

Forward search always terminates: `boundary === messages.length` trivially
satisfies (empty tail = classic fresh start, the safe degradation).

Result invariant: the returned boundary NEVER splits a pair (and still never
crosses below `floor`).

Also exported `toolPairsSatisfiedFrom` for direct unit testing.

## Tests

Added to `src/core/condense/__tests__/keep-recent-tail.spec.ts`:

1. **Capped-split case:** 20 messages, keepRecent=4. Every boundary in [12, 16]
   (backward window) has an orphan tool_result. Boundary 17 (clean text tail)
   satisfies. Pre-fix returns 12 (splits pair); post-fix returns 17 (satisfies
   invariant).

2. **Degenerate case:** Every user message in the tail region is an orphan
   tool_result, including the last message. No boundary < messages.length
   satisfies. Returns messages.length (fresh start).

3. **Regression:** Backward-satisfiable fixture (tool pair straddling default
   boundary) still returns 13 — unchanged from pre-fix behavior.

Updated existing "floor" test: with forward fallback, the all-orphan fixture
correctly returns messages.length (fresh start) instead of the floor-clamped
boundary that splits pairs.

## Verification

- `npx vitest run core/condense` — 133 passed (6 files)
- `npx vitest run core/task/__tests__` — 297 passed (32 files)
- `npx tsc --noEmit` — zero new errors (pre-existing `zai.ts:129` only)
