---
"tumble-code": patch
---

Large tool calls (for example a long file write) no longer slow the editor down while they stream: their preview is refreshed up to ten times a second instead of once per received token, which re-read the whole call every time. Small tool calls are shown exactly as before.
