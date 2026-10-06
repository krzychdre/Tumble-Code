# MermaidBlock style spec: race between the SVG and the loading flag

Status: done on `fix/mermaid-style-test-race`

## Problem (evidence)

After #799/#800, Code QA on main (run 37442752586) failed only on Windows, in `webview-ui`:
`content-blocks.styles.spec.tsx > MermaidBlock styles > ... while loading`, inline snapshot 4 expected
`opacity: 1`, received `0.3` (the dimmed loading state).

`MermaidBlock` writes the rendered SVG straight into the container in `.then`, and clears `isLoading` in the
following `.finally`, which React then has to re-render. The spec awaited only `findByTestId("mermaid-svg")`, so
on a slow runner it read the style between the DOM write and that re-render.

## Fix

The spec also waits for the loading text to disappear before reading the final styles. The component is
unchanged: the dimmed frame between the two steps is not visible to a user.
