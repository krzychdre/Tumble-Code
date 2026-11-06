# History search highlight: unescaped text when there are no match positions

**Status:** done on `fix/sec-webview-harden`
**Related:** security audit 2026-11-06, finding W-6 (W-7 and W-10 judged in the audit status, no code change)
**Touched:** `webview-ui/src/utils/highlight.ts`, `webview-ui/src/utils/__tests__/highlight.spec.ts`

## Problem

`highlightFzfMatch` returned the raw task text when `positions` was empty and escaped only in the mapped
branch. Its result is rendered with `dangerouslySetInnerHTML` (`components/history/TaskItem.tsx`).
Latent: `useTaskSearch` passes fzf positions, which are non-empty for every match.

## Fix

The early return is gone. With no positions the loop yields one plain part, which goes through the same
`escapeHtml` as every other part.

## Tests

`highlight.spec.ts`: escaped output with and without positions. Mutation: the early return put back makes
the no-positions case red.
