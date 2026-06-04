# Kilo Code–style context bar in collapsed TaskHeader

Date: 2026-06-03
Branch: `feature/kilocode-context-bar` (off `main`)

## Problem

The collapsed task header shows context-window usage as a small round gauge
(`CircularProgress`) + a percentage. The user prefers the original Kilo Code
style: a horizontal three-segment bar flanked by token counts
(`175.3k —bar— 262.1k`), with the cost next to it.

## Evidence / current state

- Round marker rendered in the collapsed header:
  `webview-ui/src/components/chat/TaskHeader.tsx:263-279` — uses `CircularProgress`.
- The horizontal bar component already exists and is used only in the _expanded_
  view: `webview-ui/src/components/chat/ContextWindowProgress.tsx`
  (three segments: used / reserved-for-output / available, with
  `formatLargeNumber` counts on both sides and its own tooltip).
- Kilo Code's current `ContextProgress` (SolidJS rewrite,
  `packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx`)
  is the same three-segment horizontal bar with counts flanking it — confirming
  this repo's `ContextWindowProgress` already matches the desired look.
- `CircularProgress` is only consumed by `TaskHeader.tsx` (plus its own unit
  test). It's a generic UI primitive, so we leave the component + test in place
  and simply stop using it here.

## Decision

In the collapsed header, replace the `CircularProgress` + `%` block with the
existing `ContextWindowProgress` horizontal bar, **keeping** the percentage
label (user choice: "Counts + percentage") and the cost. Layout:

```
175.3k  ▉▉▉▉▒▒░░░  262.1k   67%  ·  $0.33
```

- The bar flexes to fill available width (`ContextWindowProgress` already uses
  `flex-1`).
- Percentage uses the existing formula
  `contextTokens / (contextWindow - reservedForOutput) * 100`, so the existing
  `25%` / `0%` tests remain valid.
- `ContextWindowProgress` brings its own tooltip (used/reserved/available), so
  the previous table tooltip wrapping the percentage is dropped.

## Changes

1. `TaskHeader.tsx`
    - Remove `CircularProgress` from the `@src/components/ui` import.
    - Rewrite the collapsed block (`!isTaskExpanded && contextWindow > 0`) to
      render `<ContextWindowProgress>` + a `shrink-0` percentage span + cost.
2. Tests: `TaskHeader.spec.tsx` percentage tests (`25%`, `0%`) stay green
   because the percentage is preserved. Run the suite to confirm; adjust only
   if layout assertions break.

## Out of scope

- `CircularProgress` component + its unit test stay (generic primitive).
- No change to the expanded-view bar (already `ContextWindowProgress`).
