---
"tumble-code": patch
---

The CLI now stops with `error: too many arguments` when it gets more arguments than it understands, instead of silently ignoring them. This also covers options written after the prompt: `tumble "fix the bug" -w ~/project` used to start in the current directory and ignore `-w`; write the options first, `tumble -w ~/project "fix the bug"`. Extra words after `tumble upgrade` or `tumble list modes` are reported the same way. The argument parser (commander) moves from version 12 to 15.
