# A context-fill gauge in the CLI footer

## Why

The footer already knows how full the context window is, and prints it as a bare
number:

```
? for shortcuts                          code · glm-4.6 · 38% · $1.23
```

A number has to be read and compared against a remembered threshold before it
means anything. What the number is actually answering is "how much room is
left", which is a quantity, and a quantity on a one-line status bar is read far
faster as a bar than as digits. The number stays, the bar goes in front of it.

## What it looks like

```
? for shortcuts             code · glm-4.6 · ████░░░░░░ 38% · $1.23
? for shortcuts             code · glm-4.6 · ████████░░ 84% · $1.23
```

Ten cells, so one cell is ten percent. Colour follows the threshold the footer
already used for the number: `theme.secondaryText` below 80, `theme.warning`
from 80, `theme.error` from 95, with the empty cells always dim. The percentage
takes the same colour as the filled cells, so the whole gauge reads as one unit.

Rounding is deliberately not symmetric: any non-zero usage lights at least one
cell, and a bar is only full at a true 100, so "all ten cells lit" never
overstates the situation at 96%.

## Where the numbers come from

`App.tsx` already computes `contextPercent` from `tokenUsage.contextTokens` and
the model's `contextWindow` (`getContextWindow`, which falls back to 200K when
the router models do not list the model). Nothing new is fetched; this change is
presentation only.

## Implementation

- New `apps/cli/src/ui/components/input/ContextGauge.tsx`: a pure component over
  `{ percent }`, exporting `fillCells()` so the rounding rule can be tested
  without rendering.
- `InputFooter.tsx` renders `<ContextGauge>` where it used to render the bare
  `{percent}%`.

No width guard and no `useStdout` in the footer on purpose. The gauge costs
eleven columns, the footer is a flex row whose left hint already gives way, and
a width read through `useStdout` would go stale behind the `memo` on
`InputArea`/`InputFooter` after a resize (the same staleness class as the
2026-09-21 tail-viewport bug).

## Tests

`ContextGauge.test.tsx`: the rounding rule at 0, 1, 38, 50, 95, 99, 100 and out
of range; that the percentage is still printed. `InputFooter.test.tsx` keeps its
existing assertions (the `%` text is unchanged) plus one that the bar appears
next to it and is absent when the percentage is null.
