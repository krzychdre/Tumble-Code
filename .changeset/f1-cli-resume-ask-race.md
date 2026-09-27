---
"@tumble-code/cli": patch
---

Resume with `--session-id` over `--stdin-prompt-stream` no longer loses the first `message` command. The extension pushes the persisted task history (whose last message is the pre-resume ask) before the resumed task registers its resume question, so the CLI could route an early message as an answer to that stale ask; the answer was then discarded when the real resume ask was registered, and the resumed task waited forever. The CLI now waits for the live resume ask (recognised by its fresh timestamp) before the stdin command loop starts.
