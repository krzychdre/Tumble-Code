---
"tumble-code": patch
---

Internal: every per-tool policy (checkpoints, context clearing, spill, slim toolset, ledger, descriptions) and the tool dispatch now come from one tool descriptor table, so adding a tool touches far fewer files. No change to tool names or to what the model sees.
