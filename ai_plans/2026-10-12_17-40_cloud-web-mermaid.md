# Cloud web panel: mermaid diagrams in task conversations

Status: done on `feat/cloud-web-mermaid`

## Problem

The owner asked (2026-10-12) for mermaid diagrams on the cloud task page; the extension and the CLI
draw them, the panel showed the ```mermaid source as a code block.

## Design

- **mermaid 12.0.0** (same as webview-ui) vendored as `static/vendor/mermaid/mermaid.min.js` (5.5 MB,
  one IIFE, no eval) + license. Not in the template: `render.js` loads it on the first diagram, from
  its own URL (`document.currentScript.src`, so the `?v=` cache token comes along).
- **An image, not inline SVG**: mermaid's SVG carries a `<style>` element, which the panel's CSP
  (`style-src 'self'`) refuses. The SVG becomes `<img src="data:image/svg+xml,...">` (img-src allows
  data:); an image is its own document, its styles apply and no script runs. `htmlLabels: false`
  keeps labels as SVG text (no foreignObject). The SVG's `width="100%"` is replaced with the viewBox
  size, which an image needs. Theme follows the page (`data-theme`, else `prefers-color-scheme`).
- **Asynchronous drawing, stable rows**: `md()` turns a sanitized `language-mermaid` block into the
  cached image when the diagram is drawn, else returns the source and queues it. The queue draws one
  diagram at a time and skips sources no longer on the page (a streaming fence queues every chunk).
  When done, the blocks with that source are swapped in place; later `md()` calls produce the same
  HTML, so `patchRow` sees no change on a live update.
- `mermaid.parse(..., { suppressErrors: true })` before `render()`: an invalid diagram keeps its
  source and leaves no "Syntax error" picture at the end of `<body>`.
- During layout the browser logs CSP refusals for mermaid's measuring styles; tested under the real
  policy, the drawing is unaffected.

## Tests

`tests/browser/mermaid_checks.html` (11 checks): flowchart and sequence diagram become images with
their labels and a size; another code block untouched; invalid source kept, no error picture; a live
update keeps the image. Also run once under the production CSP header (local server) with a screenshot.
