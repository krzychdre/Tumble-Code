---
"tumble-code": patch
---

Keep a damaged task history file instead of overwriting it. When `api_conversation_history.json` or `ui_messages.json` cannot be parsed (for example an empty file after a power loss) or is not an array, it is now renamed to `<name>.corrupt-<timestamp>` before the task continues, so the next save no longer replaces the original bytes with an almost empty history.
