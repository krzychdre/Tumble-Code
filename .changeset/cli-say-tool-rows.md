---
"tumble-code": patch
---

The CLI no longer prints raw JSON such as `{"tool":"readArtifact",...}` as the assistant's answer when the agent reads a saved artifact or searches the task history. These steps now show as tool rows, for example `Read Artifact(0 B - 1.0 KB of 4.0 KB)` and `Search Task History(retry budget)`, the same way the VS Code chat shows them.
