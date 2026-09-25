---
"tumble-code": patch
---

Internal cleanup of the diff view used for file edits, with no visible change: the tool result text a model receives after a file write stays byte for byte the same, and the diff view is now told whether it creates or modifies a file when it opens instead of relying on a value every edit tool had to set beforehand.
