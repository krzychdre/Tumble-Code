---
"tumble-code": patch
---

The webview preloads only the real `index.js.map` source map, so a fresh profile no longer logs failed loads of `index.map.json` and `index.sourcemap`. A missing `custom_modes.yaml` now counts as an empty mode list without an error in the log; unreadable and invalid files are still reported.
