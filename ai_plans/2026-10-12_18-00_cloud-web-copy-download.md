# Cloud web panel: copy one message as Markdown, download the conversation

Status: done on `feat/cloud-web-copy-download` (stacked on `feat/cloud-web-mermaid`)

## Problem

The owner asked (2026-10-12) for a "copy Markdown" action on a single block of the task page (for
example the final answer) and for a download of the whole conversation, also as Markdown.

## Design

- `messageMarkdown(m)` in `static/render.js`: a message as Markdown. Text the model or the user wrote
  is copied as written (math and bold stay `**$x$**`); a user turn drops `<environment_details>` and
  its `<task>`/`<feedback>` wrapper (as `userContentHtml` does); commands go in a `sh` fence, output in
  a plain fence, tool diffs in a `diff` fence under their path, JSON payloads pretty-printed. A fence is
  one backtick longer than any backtick run inside, so output that contains a fence cannot close it.
  API rows (figures only), checkpoints and empty rows give "" and get no button.
- **Copy**: a quiet "Copy" button in the row header's meta block, next to the time. `patchRow` keeps
  the meta block across live updates, so the button survives; it reads the latest message for its key
  when clicked. It sits in the `<summary>`, so the click is stopped from folding the row. The clipboard
  goes through `app.js`'s `copyText` (exposed as `window.TumbleClipboard`), which falls back to
  `execCommand("copy")` on plain-http pages, where the async clipboard does not exist. The label says
  "Copied" or "Copy failed" for 1.5 s.
- **Download**: "Download .md" and "Download .json" in the conversation toolbar. The Markdown is
  `# <task title>`, then per row `## <role> · <detail> · <local time>` and its Markdown; the JSON is the
  raw messages in row order. Built at click time, so a live task's file has everything so far. Saved
  through a Blob URL and `<a download>`; the name is the task title with non-letters as `-`.
- The toolbar's right group now wraps, so the two extra buttons stay inside a 375 px phone screen
  (`test_phone_layout`).

## Tests

`tests/browser/copy_download_checks.html` (17 checks): button presence, Markdown as written, no fold,
environment details dropped, sh/diff fences, longer fence, button kept and fresh after a live update,
document headings and order, API figures left out, JSON order, file names, toolbar buttons, the saved
blob and its name. Full cloudapi suite passes.
