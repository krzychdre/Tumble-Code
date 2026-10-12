# Webview: chat formulas stayed raw TeX (KaTeX never loaded)

Status: done on `fix/webview-katex-relative-base`

## Symptom

The owner's screenshot (2026-10-12): every formula in a completion result showed as an inline code
chip holding its TeX source (`\int_{-\infty}^{0} \left(3x^3 + 6x + \frac{1}{2}\right) dx`), in a serif
face. That is exactly what remark-math leaves behind when rehype-katex never runs: inline math becomes
`<code class="language-math math-inline">`.

## Root cause (evidence)

`webview-ui/vite.config.ts` set no `base`, so Vite used `"/"`. Since P4 (#544) KaTeX and its stylesheet
load lazily (`loadRehypeKatex` in `MarkdownBlock.tsx`). The built preload helper resolved the CSS
dependency as `"/" + "assets/katex-<hash>.css"`, i.e. against the origin root, while the webview serves
the build from `https://file+.vscode-resource.vscode-cdn.net/<extension dir>/webview-ui/build/assets/`.
The stylesheet 404'd, the helper rejected with `Unable to preload CSS`, `loadRehypeKatex` logged
"Failed to load KaTeX" and the plugin was never set. The KaTeX fonts inside that CSS used
`url(/assets/fonts/...)` too.

Proved in headless Chrome with both builds served under a deep path (`/deep/ext/webview-ui/build/assets`):

| build                     | CSS request                                                                                      | result                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| installed VSIX (base "/") | `/assets/katex-BUUrzxgb.css` 404                                                                 | `CSS FAILED: Unable to preload CSS` |
| this branch (base "./")   | `/deep/ext/webview-ui/build/assets/katex-DLGNtIL8.css` 200, `fonts/KaTeX_Main-Regular.woff2` 200 | CSS OK, `KaTeX_Main` loaded         |

JS chunks were unaffected: `import("./x.js")` is relative, only the awaited CSS preload was absolute.

The serif face: `font-family: var(--vscode-editor-font-family, monospace)` falls back only when the
variable is undefined. The owner's `editor.fontFamily` is "JetBrains Mono", which is not installed, so
the browser fell to its default serif.

## Fix

- `vite.config.ts`: `base: "./"`. The extension writes its own HTML with explicit URIs, so only the
  generated asset URLs change (preload helper, CSS `url()`); the dev server treats `./` as `/`.
- `index.css`: inline code in `.markdown-block` uses `var(--font-mono)`, the existing stack that ends
  in `monospace`.

## Tests

- `webview-ui/src/__tests__/vite-config.spec.ts`: `base` is `"./"` in production and nightly mode.
  Fails with `expected '/' to be './'` when the line is reverted.
- `content-blocks.styles.spec.tsx` inline snapshot updated to `var(--font-mono)`.

## Notes

The installed VSIX must be rebuilt for the owner to see formulas. Related follow-ups on their own
branches: `\(...\)` / `\[...\]` delimiters, math in the CLI.
