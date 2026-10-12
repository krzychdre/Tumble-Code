# Webview: LaTeX bracket delimiters and one-line display math

Status: done on `feat/webview-math-bracket-delimiters`

## Problem

Models (Qwen, GLM, GPT-style prompts) often write math as `\(...\)` and `\[...\]`, or a display
formula as `$$...$$` on one line. remark-math knows only dollar delimiters, and in markdown `\[` and
`\(` are escaped punctuation: after parsing, `\(x^2\)` is the text `(x^2)` and the delimiter is gone.
`$$x$$` on one line is parsed as inline math (probed with remark-parse + remark-math: a paragraph with
one `inlineMath` node; only `$$` on lines of their own opens a `math` block), so a formula meant to stand
on its own was drawn inline and small.

## Fix

`webview-ui/src/utils/markdown.ts`:

- `normalizeMathDelimiters(markdown)` runs on the source before parsing (`MarkdownBlock`, memoized).
  `\[...\]` becomes `$$...$$`, `\(...\)` becomes `$...$` (trimmed, so Pandoc's single-dollar rule
  accepts it). Skipped: fenced code blocks (also unclosed ones while streaming) and code spans; a
  backslash that is itself escaped (`\\[2pt]` is a TeX line break); content that does not look like TeX
  (no command, `^`, `_`, `=`, `<`, `>`, `+`), so an escaped `\[1\]` stays the literal `[1]`; `\(...\)`
  across a blank line or holding a `$`.
- `remarkDisplayMathParagraphs`: a paragraph that is only one `$$...$$` formula becomes a `math` node
  with the same `data` (`pre > code.language-math.math-display`) remark-math gives a block, so
  rehype-katex renders it in display mode. Needs the source to tell `$$` from `$`
  (`file.value` at the node's start offset). A `\[...\]` on its own line takes this path.

The KaTeX lazy-load check (`markdown.includes("$")`) runs on the normalized text, so a message with
only bracket delimiters still loads KaTeX.

## Tests

- `utils/__tests__/markdown.spec.ts`: rewrites and non-rewrites of `normalizeMathDelimiters`.
- `MarkdownBlock.spec.tsx` "LaTeX bracket delimiters": `\(...\)` renders inline KaTeX, `\[...\]`
  (multi-line and one-line) and one-line `$$...$$` render `.katex-display`; escaped brackets, code spans
  and `\\[2pt]` stay as they were. With the normalization and the plugin removed, 4 of them fail.

## Notes

Depends on `fix/webview-katex-relative-base` for anything to render in the installed extension: without
it KaTeX never loads in production. The CLI gets the same delimiter handling on its own branch.
