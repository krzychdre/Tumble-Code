---
"tumble-code": patch
---

Large tool results and pruned context are now saved to disk without freezing the editor, and a crash in the middle of such a save can no longer leave a truncated artifact behind. Looking up a provider's cached model list no longer reads the disk on every request.
