# CLI: inline math inside bold, italic, struck and link text

Status: done on `fix/cli-math-inside-emphasis`

## Problem

The owner sent a screenshot (2026-10-12): `**ile uwagi token $i$ poświęca tokenowi $j$**` printed the
bold text with `$i$` and `$j$` raw, while math elsewhere on the line was translated.

## Root cause

`tokenizeInline` (`apps/cli/src/ui/components/Markdown.tsx`) splits a line into markers with one
regex. At the opening `**` the bold alternative matches the whole span up to the closing `**`, and its
inner text was pushed as one plain token; nothing looked for math inside it. The same held for
`*...*`, `_..._`, `~~...~~` and link text. Tables, headings, quotes and list items were fine (probed).

## Fix

- The inline math alternatives are one string, `INLINE_MATH`, used by `INLINE_MARKER_RE` and by a new
  global `NESTED_MATH_RE`.
- `mathOf(marker)` holds the old math branch (including the `\[1\]` escape rule); `withMath(text)`
  replaces every formula inside emphasis, struck and link text with its Unicode form. Code spans stay
  as written. The formula takes the style of its surrounding text (bold stays bold) instead of italic.

## Tests

`Markdown.test.tsx`: the screenshot sentence, math in `*...*` and `~~...~~`, in link text, and dollar
amounts inside bold staying text.
