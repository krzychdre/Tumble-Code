---
"tumble-code": patch
---

Long model reasoning no longer slows the editor down while it streams: the thinking block is refreshed up to ten times a second instead of once per received token, which sent the whole reasoning so far to the chat every time. The first words still appear at once, and the finished reasoning is shown and saved in full, exactly as before.
