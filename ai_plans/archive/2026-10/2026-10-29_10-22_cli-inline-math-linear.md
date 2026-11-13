# CLI: inline `$...$` math in linear time on escaped dollars (2026-10-29)

**Status:** implemented on `fix/cli-inline-math-linear` (security audit 2026-10-28, section 38, remainder).
**Touched:** `apps/cli/src/ui/components/Markdown.tsx`, `apps/cli/src/ui/components/__tests__/Markdown.test.tsx`,
`.changeset/cli-escaped-dollar-math.md`.

## Symptom

A line of `"a\\$" * n` (the text `a\$a\$...`) in an answer held the TUI for 61 ms at 8 000 characters, 231 ms at
16 000 and 3.5 s at 64 000 per render, with Ctrl+C unanswered. The `\[` and `\(` bodies were already linear
(345b0a293).

## What was happening

The single-dollar branch of `INLINE_MATH` (`Markdown.tsx:30`),
`\$(?=[^\s$])(?:\\.|[^$\\])+?(?<=\S)\$(?!\d)`, could open at every `$`, also one escaped by a backslash. The body
reads `\$` as an escaped character, so from each `$` the scan ran to the end of the line looking for an unescaped
closing `$`: n openers, n characters each.

## Fix

A `$` preceded by an odd run of backslashes no longer opens math:
`(?<!(?<!\\)(?:\\\\)*\\)\$...`. Such a `$` lies inside the body of any earlier opener and reaches the same closing
`$`, so it was the redundant rescan; refusing it leaves each character scanned once. The lookbehind only walks the
backslash run before a `$`. The pattern itself is linear, so no line-length bound was added.

The only rendering change: an escaped dollar that started a line's math (`echo \$HOME$PATH` rendered
`$HOME$` as a formula) is now text, which is also Pandoc's rule. Over 300 000 random lines the old and the new
tokenization differ only on lines with such an escaped `$`.

After: 0.27 ms at 8 000 characters, 0.11 ms at 16 000, 0.47 ms at 64 000.

## Tests

- `renders a line of escaped dollars at once`: 90 000 characters of `a\$` under 2 s.
- `leaves "echo \\$HOME$PATH" as written`; `renders "path \\\\$x^2$ here"` (an escaped backslash still lets the dollar
  open math).
- Mutations: the old branch turns the timing and the `echo` cases red; refusing any `$` after a backslash turns the
  escaped-backslash case red.

## Not fixed

Nothing of section 38 stays open.
