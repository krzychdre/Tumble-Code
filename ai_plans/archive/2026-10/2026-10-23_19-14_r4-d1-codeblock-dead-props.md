# R4 D1: CodeBlock without the props no caller passes

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item D1.

## Touched files

- `webview-ui/src/components/common/CodeBlock.tsx`
- `webview-ui/src/index.css`
- `webview-ui/src/components/common/__tests__/content-blocks.styles.spec.tsx`

## Problem

`CodeBlock` declared `rawSource`, `preStyle`, `initialWordWrap`, `initialWindowShade` and `collapsedHeight`, and
none of its seven callers passes any of them. Word wrap was therefore a constant, the scroller took three extra
props, the highlight effect listed `collapsedHeight` as a dependency and its cleanup cleared the collapse-button
timers on every source change (a streaming block could cancel the scroll that follows a collapse click), and the
mousedown handler compared `e.currentTarget` with the element it was registered on.

## Change

- `CodeBlock` takes `source` and `language`; the window shade starts collapsed at `WINDOW_SHADE_SETTINGS.collapsedHeight`.
- The highlight effect cleans up only its own mounted flag; a separate unmount effect clears the two collapse timers.
- The `data-wordwrap` attribute and its `[data-wordwrap="false"]` CSS rule are gone (the value was always true).
- Copy copies `source`.

## Tests

- `content-blocks.styles.spec.tsx`: the cases that rendered with the dead props are replaced by one case that makes
  the block tall, clicks the expand button and expects `max-height: none`. Mutation: the click handler set the
  same shade value, the case went red; restored.
- `CodeBlock.spec.tsx`, `CodeBlock.shiki-golden.spec.tsx`, `content-blocks.styles.spec.tsx` green; tsc, eslint and
  the React Compiler bailout check (6 known) pass.
