---
"tumble-code": patch
---

The chat view no longer receives the whole conversation again for every new message. Each new message is now sent on its own, so long conversations stay responsive (on 1,054 real tasks the data sent to the chat view for new messages drops from about 73 GB to about 1.2 GB). The CLI keeps receiving exactly what it received before.
