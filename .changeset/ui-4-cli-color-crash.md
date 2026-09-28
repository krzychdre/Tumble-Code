---
"@tumble-code/cli": patch
---

The CLI now honours `NO_COLOR` (a non-empty value turns colour off, and `FORCE_COLOR` still wins when set). After a crash it prints the error on the terminal together with the path of the debug log, and suggests running again with `--debug` when the log was not being written. Before, a crash in the interactive mode, and a failed print run, could end without any message.
