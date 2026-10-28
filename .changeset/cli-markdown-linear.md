---
"tumble-code": patch
---

Fixed: **CLI: an answer full of unclosed brackets no longer freezes the terminal.** Lines with thousands of `\[`, `\(`, `[` or `[a](` render at once, and a link whose address holds parentheses keeps its whole address.
