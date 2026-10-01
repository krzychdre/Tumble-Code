---
"@tumble-code/cli": patch
"tumble-code": patch
---

The CLI no longer has the `--stdin-prompt-stream` mode (NDJSON commands on stdin) or its companion flag `--signal-only-exit`; nothing used them. Print mode (`-p`) with `--output-format text`, `json` or `stream-json` and the interactive terminal UI work as before. The `system` event that opens a `stream-json` or `json` output no longer lists the removed stdin commands in a `capabilities` field.
