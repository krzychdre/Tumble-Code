# Inline markdown in CLI list items

## The report

Two defects were reported in the CLI markdown renderer
(`apps/cli/src/ui/components/Markdown.tsx`):

1. Every line containing `|` renders blank, so table rows and sentences with a
   pipe vanish and leave a lone bullet behind.
2. List items do not process bold, so the literal `**` stays on screen.

## Defect 1 is already fixed on main

`9d1d4f554 fix(cli): stop printing rows that are only a bullet (#176)` replaced
the table-separator test with a strict one (see
`2026-09-22_cli-blank-bullet-rows.md`). The report came from a build of
`feat/cli-stream-answer-into-scrollback`, which forked from main at #175, one
commit before #176, so that build still had the old test. Building from main
(which now holds both #176 and #177) is enough; this branch does not touch it.

## Defect 2: block elements printed their content raw

`renderLine` recognises headings, unordered and ordered list items and
blockquotes, and in each branch it put the captured content straight into a
`<Text>`:

```text
{"  • "}
{bulletMatch[2]}
```

Only the fall-through branch (a plain line) ran `tokenizeInline` and
`renderTokens`. So `- **Plik:** opis` printed `• **Plik:** opis`, and the same
happened to `1. **Krok**`, `> **Uwaga:**` and `## Plik \`x\``.

Evidence: four new tests in `Markdown.test.tsx` failed on main with exactly
that output (`" • **Plik:** \`Markdown.tsx\` opis"`, `"1. **Krok pierwszy**
zbuduj"`, `"▎ **Uwaga:** ostrożnie"`, `"Plik \`Markdown.tsx\`"`).

### Fix

A `renderInline(text, dimColor)` helper (tokenize + render) is now used for the
content of all four block elements and for plain lines. Heading content keeps its
outer bold/underline; blockquote content keeps its dim colour.

## Side effect found and fixed: intraword underscores

Routing list items through the tokenizer exposed a tokenizer flaw that was
already live for plain lines: `_[^_]+_` matched inside words. A probe rendered

```
"use my_var_name here"      => "use myvarname here"
"- edit src/__tests__/a.ts" => "  • edit src/_tests_/a.ts"
```

List items are where models most often write identifiers and paths, so the fix
would have spread that damage. `_emphasis_` now matches only at word boundaries
(`(?<![\w])_…_(?![\w])`), which is the CommonMark rule for underscores.
`*emphasis*` is left alone (CommonMark allows it intraword).

## Verification

- `apps/cli`: `vitest run src/ui` passes 448/448 (6 new tests), `tsc --noEmit`
  and eslint are clean.
