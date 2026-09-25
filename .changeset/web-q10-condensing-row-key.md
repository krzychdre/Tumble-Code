---
"tumble-code": patch
---

The "Condensing context" row in the chat no longer restarts on every streamed token. It was rebuilt from scratch each time the chat list updated, so its spinner kept restarting while the context was being condensed.
