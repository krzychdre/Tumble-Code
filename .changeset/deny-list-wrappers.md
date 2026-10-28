---
"tumble-code": patch
---

Fixed: **A denied command can no longer slip past the deny list inside another command.** Commands run through `env`, `nice`, `sudo`, `timeout`, `xargs`, `find -exec`, `sh -c`, `eval`, `npx`, `git -C` and similar wrappers are checked like the command itself, and a wrapper in your allowed list no longer approves whatever it runs: that has to be allowed too.
