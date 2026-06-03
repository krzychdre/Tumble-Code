# Zoo PR #275 — Render GitHub-style alerts in the webview

- **Upstream commit:** `463cc18f2` (squash of #258, merged 2026-05-30), Zoo-Code.
- **Branch:** `feature/zoo-275-github-alerts` (off `main`).
- **Credit:** Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>; Co-authored-by: Elliott de Launay <edelauna@gmail.com>.

## What upstream #275 does

GitHub-style alerts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`)
were rendered as plain blockquotes in the webview, losing their semantic meaning
and visual priority. #275 adds a focused **remark transform** (no new dependency —
reuses `unist-util-visit`, already a webview dep) that detects a leading alert
marker in a blockquote, strips the marker text, and tags the node via
`data.hProperties` (`data-alert-type` + `markdown-alert*` classes). A custom
`blockquote` renderer in `MarkdownBlock` then draws a codicon + label header and
per-type accent styling using VS Code theme variables. Normal blockquotes and
unsupported markers (e.g. `[!INFO]`) render unchanged.

## Fork-vs-upstream divergence analysis

| File                                                 | Fork vs upstream parent                                                                                                                                            | Decision                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/utils/markdown.ts`                   | **== parent**                                                                                                                                                      | clean apply of the new `ALERT_TYPES`/`AlertType`/`remarkGithubAlerts` block                                                                                                           |
| `webview-ui/src/utils/__tests__/markdown.spec.ts`    | **== parent**                                                                                                                                                      | clean apply of the `remarkGithubAlerts` describe block                                                                                                                                |
| `webview-ui/src/components/common/MarkdownBlock.tsx` | diverges **only** at the `remarkGfm` line — fork has plain `remarkGfm`; upstream parent has `[remarkGfm, { singleTilde: false }]` + comment (fork never took #154) | apply the import / `ALERT_ICONS` / `ALERT_LABELS` / CSS / `blockquote`-renderer hunks verbatim; **manually** add `remarkGithubAlerts,` after `remarkMath,` in the fork's plugin array |
| `MarkdownBlock.spec.tsx`                             | missing #154's two tests above the #275 insertion point (line offset only; surrounding context lines present)                                                      | apply the #275 hunk with offset; do **not** pull in the #154 tests                                                                                                                    |

No brand strings, no `@roo-code/*` IDs, no provider/user-agent surfaces are touched.
`unist-util-visit@^5.0.0` is already in `webview-ui/package.json` and already
imported by `MarkdownBlock.tsx`, so there is **no new dependency**.

## Changes

### Product

1. `webview-ui/src/utils/markdown.ts` — add `import { visit } from "unist-util-visit"`,
   `ALERT_TYPES`, `AlertType`, `ALERT_MARKER_REGEX`, the `remarkGithubAlerts()` remark
   plugin, and the `annotateAlertBlockquote` helper. (clean apply)
2. `webview-ui/src/components/common/MarkdownBlock.tsx` —
    - import `{ type AlertType, remarkGithubAlerts }` from `@src/utils/markdown`;
    - add `ALERT_ICONS` + `ALERT_LABELS` maps (codicon glyph + label per type);
    - add `.markdown-alert*` CSS to `StyledMarkdown` (accent via `--alert-accent`, VS Code theme vars);
    - add a `blockquote` renderer to the components map that renders the codicon/label header
      for tagged alert blockquotes and falls through unchanged otherwise;
    - register `remarkGithubAlerts` in the `remarkPlugins` array (manual: after `remarkMath`).

### Tests (TDD — fork already green before; verified with `npx vitest run` from `webview-ui/`)

3. `webview-ui/src/utils/__tests__/markdown.spec.ts` — full `remarkGithubAlerts`
   describe block (annotate per type, case-insensitive, marker-only paragraph drop,
   normal blockquote untouched, unsupported marker ignored, mid-text marker ignored,
   nested blockquotes). (clean apply)
4. `webview-ui/src/components/common/__tests__/MarkdownBlock.spec.tsx` — the 5 new
   alert render tests (per-type icon/class, case-insensitive, inline markdown inside
   alert, normal blockquote unchanged, unsupported marker). (apply with offset)

## Build gate

`pnpm install:vsix -y --editor=code` must be green before commit/push.
