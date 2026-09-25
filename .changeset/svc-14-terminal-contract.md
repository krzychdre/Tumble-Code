---
"tumble-code": patch
---

Terminal commands now behave the same in the VS Code terminal and in the CLI: live output arrives at one steady rate (and a line printed just before a pause is no longer held back), output printed right before "Proceed while running" is kept, and a command that was stopped is reported as killed instead of as a successful exit.
