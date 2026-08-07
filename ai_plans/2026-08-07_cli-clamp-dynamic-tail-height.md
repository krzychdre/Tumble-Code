# CLI: clamp dynamic-tail height to stop duplicated scrollback rows

**Date:** 2026-08-07
**Branch:** `feat/14-cli-claude-style-ui`
**Status:** implemented

## Problem

During long streaming replies (and while an ask holds a long message in the
dynamic tail), the terminal accumulates permanently duplicated rows: e.g. the
user's prompt printed twice, or a stale spinner row (`Untangling… · 0s`) above
the live one (`· 210s`).

## Root cause (proven)

Screenshot evidence: the stale spinner row shows `0s` while the live one shows
`210s` — a frame from t≈0 survived 210 seconds. ANSI erase sequences can only
touch rows inside the visible viewport, so the only place a row can survive
unerased is native scrollback.

Mechanism, from ink 6.6.0 source (`build/ink.js` `onRender`, `build/log-update.js`):

1. Ink re-renders the dynamic region by cursor-repositioning/erasing relative
   to the region's top. When a frame **grows taller than the visible screen**,
   writing it scrolls its own top rows into scrollback. Those rows are now
   unreachable — every later erase misses them → permanent duplicates.
   (The second copy of the user prompt is the _correct_ `<Static>` promotion
   print; the first is the escaped live row.)
2. Once `lastOutputHeight >= stdout.rows`, ink switches to the
   `clearTerminal + fullStaticOutput + output` path: on Linux `clearTerminal`
   is `eraseScreen + ESC[3J + home`, i.e. it **wipes scrollback** and rewrites
   the whole transcript **every frame** — massive flicker, destroyed history.

The unbounded contributor in our layout is streamed message content: tool
renderers already cap their previews (`ResultRow maxLines`, `MAX_*` constants),
but assistant/user/system message bodies render full-height in the dynamic
tail. `incrementalRendering: true` (commit 00820fd6f) fixes erase-rewrite
flicker but cannot help here — no renderer can erase rows outside the viewport.

## Fix

Keep the dynamic tail strictly shorter than the terminal: clamp the rendered
body of each dynamic-tail message to its share of a row budget derived from
`useTerminalSize().rows` minus a fixed reserve for spinner + input/footer or
dialogs. The full text still lands in scrollback exactly once — when the
message finalizes and is promoted into `<Static>`. This mirrors Claude Code's
own truncated live-preview behavior.

### Pieces

- `src/ui/utils/tailClamp.ts` — `clampTail(content, maxRows, columns)`:
  walks raw lines from the end, wrap-aware (estimates physical rows as
  `ceil(len / (columns - indent))`), returns the tail slice + hidden-line
  count. A single raw line wider than the whole budget is tail-sliced by
  characters so it can never overflow on its own.
- `src/ui/components/DynamicTailMessage.tsx` — wraps `ChatHistoryItem` for
  dynamic-tail rendering only. Clamps `assistant` / `user` / `system` bodies
  (tool renderers are already capped; `thinking` is a one-liner) and shows a
  dim `… +N lines` indicator above the clamped body.
- `App.tsx` — dynamic tail maps through `DynamicTailMessage` with
  `perMessageRows = max(3, floor((rows - RESERVE) / dynamicCount))`,
  `RESERVE = 12` (spinner + bordered input + footer + toast/dialog margin).
  `<Static>` rendering is untouched — promoted messages print full-height.

### Non-goals

- Command-ask bodies in `ApprovalDialog` (single command line, wraps but
  bounded in practice) — revisit only if it proves to overflow.
- Ink's resize handling and the `clearTerminal` fallback itself — with the
  tail clamped, that path should no longer trigger.

## Addendum (same day): per-message clamps are not enough — hard viewport

Field test on build 35abe1507 still corrupted: duplicated rows now appeared
_inside_ the visible followup dialog (option 1 ×4, option 2 ×2, option 3
missing). New mechanism, same invariant violation: in a short VSCode terminal
(~26 rows) the tail with a followup dialog (~17–20 rows) + thinking + spinner
still reaches the terminal height even with message bodies clamped. When the
height oscillates around `rows`, ink alternates between its clearTerminal
fallback and normal rendering with a stale `previousCount > rows`; the
recovery `cursorUp(previousCount − 1)` clamps at the top of the screen, so
every subsequent row lands offset — interleaving stale and fresh rows.

Per-component clamping cannot guarantee the invariant (dialogs, margins,
wraps all add up), so enforce it structurally:

- `src/ui/components/TailViewport.tsx` — wraps the entire dynamic tail.
  Outer `Box height={min(naturalHeight, maxRows)} overflowY="hidden"
justifyContent="flex-end"`, inner `Box flexShrink={0}` (with the default
  flexShrink yoga squashes children instead of overflowing — verified
  empirically: flex-end + non-shrinking inner shows exactly the last N rows).
  Natural height is re-measured via `measureElement` after each commit, so a
  short tail keeps its natural height; the cap (`rows − 2`, below ink's
  `clearTerminal` trigger at `≥ rows`) always holds, bottom-anchored so input
  and dialogs stay visible and only the oldest rows are clipped.
- The per-message clamps from the main plan stay as defense in depth (they
  keep the clipped region small and the `… +N lines` indicator meaningful).

## Verification

- Unit tests for `clampTail` (fits/no-op, tail slice, wrap estimate, giant
  single line) and a render test for the `… +N lines` indicator.
- `pnpm check-types`, `pnpm lint`, `pnpm test` in `apps/cli`.
- Manual: stream a long reply in a short terminal window; expect no duplicated
  prompt/spinner rows and intact scrollback.
