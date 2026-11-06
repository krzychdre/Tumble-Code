---
"tumble-code": patch
---

Improved: **CLI: quicker small commands.** `tumble --version`, `--help`, `doctor`, `upgrade`, `list` and `auth` no longer load the interactive interface first, which takes about 90 ms off each.
