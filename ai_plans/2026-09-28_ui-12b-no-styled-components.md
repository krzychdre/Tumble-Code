# UI §2.12 part b: styled-components leaves the webview (2026-09-28)

Source: `ai_plans/2026-09-27_ui-modernization.md` §2.12 ("CodeBlock, MarkdownBlock, MermaidBlock and
`settings/styles.ts` moved from styled-components to Tailwind and `@layer components`, then the dependency
removed. Regenerate `ChatRow.golden.json` in the same pull request.") and roadmap item D12. Second branch of the
stack, based on `refactor/ui-12a-icons`.

## Inventory (verified with `git grep styled-components`)

Exactly the four files the plan names; no babel or Vite plugin was configured for styled-components.

| File                           | Styled parts                                         | Now                                                                                |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `common/CodeBlock.tsx`         | container, copy toolbar, toolbar button, `StyledPre` | `.code-block`, `.code-block-toolbar`, `.code-block-button`, `.code-block-scroller` |
| `common/MarkdownBlock.tsx`     | `StyledMarkdown`                                     | `.markdown-block`                                                                  |
| `common/MermaidBlock.tsx`      | container, loading text, error copy button, svg host | `.mermaid-block`, `-loading`, `-copy`, `-diagram`                                  |
| `settings/styles.ts` (deleted) | `StyledMarkdown` for `ModelDescriptionMarkdown`      | `.model-description-markdown`                                                      |

Dynamic values: the code block's `max-height` (window shade, `collapsedHeight`) and the caller's `preStyle` are an
inline style; word wrap is `data-wordwrap` on the scroller; the dimmed Mermaid host is `data-loading`.

## Deviation: unlayered, not `@layer components`

The rules sit in a marked "content blocks" section at the END of `index.css`, outside every cascade layer.
styled-components injected unlayered rules, and two unlayered style sheets compete with these rules in the real
webview:

- VS Code's webview default styles (for example `code { font-family: var(--monaco-monospace-font); padding: 1px 3px;
border-radius: 4px }`). VS Code layers them itself from 1.104 on (see the `revert-layer` note in `index.css`),
  but `src/package.json` still accepts `^1.102.0`, where they are unlayered,
- the lazily loaded `katex.min.css` (`.katex { font: normal 1.21em KaTeX_Main, ... }`, checked in node_modules).

A layered rule loses to any unlayered rule regardless of specificity, so inside `@layer components` inline code
would take VS Code's font, padding and rounded corners and formulas would grow from 1.1em to 1.21em. Keeping the
section unlayered and last reproduces the old precedence exactly. The rules are plain CSS (no nesting, `@apply`
or `theme()`), which also lets the characterization spec load them into jsdom.

Everything else follows the plan: Tailwind processes the file, the tokens stay the `--vscode-*` variables the
styled rules already used, square corners stay `border-radius: 0`.

## Tests

1. Commit 1 (green on the parent branch): `common/__tests__/content-blocks.styles.spec.tsx` reads
   `getComputedStyle` for every element the styled components styled (51 inline snapshots: container, scroller
   with window shade, `collapsedHeight`, `preStyle`, word wrap, pre and code, toolbar and buttons; markdown text,
   headings, lists by depth, inline code with `!important`, links, tables, alerts; Mermaid container, loading
   text, dimmed and loaded host, svg, error copy button; the settings description markdown). It injects the
   marked `index.css` section when it exists, so the same file pins both sides of the move.
2. Commit 2 (the move) keeps it green unchanged. jsdom cannot evaluate `:hover`, so hover rules are checked by
   review (copied verbatim) rather than by the spec.
3. Golden files regenerated with `UPDATE_GOLDEN=1`: `ChatRow.golden.json` and `MarkdownBlock.golden.json` change
   only `class="sc-styled"` to `class="markdown-block"` (word diff checked, no other token changes);
   `CodeBlock.shiki.golden.json` is unchanged (it captures Shiki's inner `<pre>`). The `sc-` masking in the three
   golden specs is removed.

## Other changes

- `CODE_BLOCK_BG_COLOR` and `WRAPPER_ALPHA` are gone (no other users). The toolbar's old
  `background: <CODE_BLOCK_BG_COLOR>cc` produced `var(...)cc`, which browsers treat as invalid at computed-value
  time (transparent), so it is dropped rather than copied; the hover background is kept.
- `scripts/audit-allowlist.mjs`: the two postcss advisories were accepted "until styled-components leaves"; the
  lockfile's only postcss is now 8.5.28 and `pnpm audit` lists no postcss advisory, so both entries are removed.
- `docs/05-webview-ui.md` no longer lists styled-components users.

## Bundle (production `vite build` in the worktree)

| Asset       | before (12a) | after (12b)           |
| ----------- | ------------ | --------------------- |
| `index.js`  | 1,994,259 B  | 1,959,282 B (-34,977) |
| `index.css` | 128,540 B    | 136,734 B (+8,194)    |
