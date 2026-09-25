---
"tumble-code": patch
---

The chat view stays responsive while an answer streams in a long task: it no longer re-parses every tool message in the history on each streamed token (about 90 ms per token in a 400-message task with 9 MB of tool output, now well under 1 ms), and the file changes panel no longer does either.
