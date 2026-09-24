---
"tumble-code": patch
---

The CLI no longer answers a follow-up question with an empty reply when the model offers a blank suggestion: the countdown and the print-mode default pick the first suggestion that has text, and blank suggestions are not listed. The `cost` in the CLI's JSON output is now the cost of the whole task instead of its last request. The CLI matches task history to the workspace the same way the extension does (paths are case-sensitive on macOS).
