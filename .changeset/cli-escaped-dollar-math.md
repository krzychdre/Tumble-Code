---
"tumble-code": patch
---

Fixed: **CLI: an answer full of escaped dollar signs no longer freezes the terminal.** A line with thousands of `\$` renders at once, and an escaped dollar such as the one in `echo \$HOME` no longer starts a formula.
