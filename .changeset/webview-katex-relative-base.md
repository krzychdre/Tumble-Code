---
"tumble-code": patch
---

Formulas in chat answers render again. The lazily loaded KaTeX stylesheet and fonts were requested from the root of the webview origin and never found, so every formula showed as raw TeX in a code chip. Inline code also falls back to a monospace font when the editor font is not installed.
