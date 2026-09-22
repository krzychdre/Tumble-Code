# CLI: transcript rows one or two columns wider than the terminal

Branch: `fix/cli-static-rows-overflow-width` (off `main` 28751cad7).

## Symptom

In the printed transcript, a long answer paragraph sometimes ends with a row
that holds a single character or a short fragment ("8,", `"`, "z") under the
paragraph, as if the paragraph were wrapped by the terminal and not by the
CLI.

## Root cause (proven)

Found in the byte captures of `2026-09-22_cli-incremental-render-ghost-rows.md`
(17x200 pseudo terminal, GLM-5.3 answer about Modbus registers): three rows of
the promoted answer measured 201 and 202 columns with `wcwidth` and with
`string-width` alike, so it is not a disagreement about character widths. Ink
really wrapped the text at 199 to 200 columns after a 2-column bullet.

A probe rendering the same answer twice in one ink tree, once inside
`<Static>` and once in the normal flow, with a 200-column fake stdout: the
`<Static>` copy had rows of 199, 200 and 201 columns plus leading 2, the
normal-flow copy never exceeded 199. Ink lays `<Static>` out as an absolutely
positioned box (`position: absolute`), which yoga does not bound by the root
width, so the markdown line (a `Text` with nested `Text` children for plain
text, code and links) is measured and wrapped against a too wide box. Giving
the `<Static>` box an explicit width made the two copies identical.

The dynamic tail never had the problem because it sits in the normal flow of
the root, which ink sizes to the terminal.

## Fix

- New `apps/cli/src/ui/components/TranscriptStatic.tsx`: the `<Static>` block
  moved out of `App.tsx` unchanged, plus `style={{ width: columns }}` on the
  `<Static>` box. `App.tsx` passes `terminalColumns` and keeps the remount key
  (`staticKey:reprintEpoch:clearEpoch`) on the new component, so ctrl+o
  reprints and `/clear` behave as before.
- On a resize, rows already printed stay as they were (ink never rewrites
  `<Static>` output); new rows use the new width.

## Tests

`apps/cli/src/ui/components/__tests__/TranscriptStatic.test.tsx`, fixture: two
paragraphs of the real answer.

- control: a bare `<Static>` prints them wider than 200 columns (guards the
  fixture, and flags the day ink bounds `<Static>` by itself);
- `TranscriptStatic` never prints a row wider than 200 columns. Verified to
  fail with `expected 201 to be less than or equal to 200` when the width is
  removed.
