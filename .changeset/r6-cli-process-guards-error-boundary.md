---
"@tumble-code/cli": patch
---

The interactive CLI now handles SIGINT, SIGTERM, uncaught exceptions and unhandled rejections through one shared process-guards module, and the TUI is wrapped in an error boundary. Previously only print mode handled signals: a crash or `kill` in the interactive mode could leave the terminal in raw mode with no error message, and `--ephemeral` temp storage leaked. Both modes now run the same cleanup (terminal restore, extension host dispose, JSON output flush) before exiting, bounded by a 10s force-exit timeout.
