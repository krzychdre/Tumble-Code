---
"tumble-code": patch
---

New: **CLI: Code index.** The CLI indexes the workspace for `codebase_search` as VS Code does: with your VS Code code index settings, or with a `codeIndex` entry in `~/.roo/cli-settings.json` (Qdrant, embedder, model, key), which also works without VS Code. Only the embedder's and Qdrant's keys are copied from VS Code.
