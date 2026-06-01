# Zoo PR #240 — Don't strikethrough text wrapped in a single tilde

- **Upstream:** Zoo-Code #240 (squash of #154), commit `2aa944e13`, merged 2026-05-21 22:11:04Z, author Armando Vaquera.
- **Branch:** `feature/zoo-240-markdown-single-tilde` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <proyectoaura.org@gmail.com>`.

## Problem

`remark-gfm` treats a single `~` around text (e.g. `~10`, `1~3`) as strikethrough.
VS Code's markdown renderer does not — it only strikes `~~text~~`. So numeric ranges
and approximate values in assistant output render as struck-through text in the
webview, which is wrong.

## Fix (product — `webview-ui/src/components/common/MarkdownBlock.tsx`)

Pass `{ singleTilde: false }` to `remarkGfm` in the `remarkPlugins` array, changing
the bare `remarkGfm` entry to `[remarkGfm, { singleTilde: false }]`. With this option
only `~~text~~` renders as strikethrough; a single `~` is treated as literal text.

## Tests (`webview-ui/src/components/common/__tests__/MarkdownBlock.spec.tsx`)

Add two cases after the existing link test:

1. `should not strikethrough text wrapped in a single tilde (#154)` — `1. Lorem ~10
ipsum dolor sit 1~3 amet.` renders no `<del>` and the list item text keeps `~10`
   and `1~3`.
2. `should still strikethrough text wrapped in double tildes` — `This is ~~struck~~
text.` still produces a `<del>` containing `struck`.

## Scope

No aimock parts. Both files apply cleanly — our fork's `MarkdownBlock.tsx`
`remarkPlugins` array and the spec's anchor (after the existing link test at the top
of the `describe`) match the upstream pre-image.

## Verification

- `npx vitest run src/components/common/__tests__/MarkdownBlock.spec.tsx` (from `webview-ui/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
