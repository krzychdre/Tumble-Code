---
"tumble-code": patch
---

The CLI uses `@vscode/ripgrep` 1.18: it takes the `rg` binary from the package's per-platform dependency (`rgPath`), `tumble doctor` reports that binary, and the release ships it as `bin/rg`. CI no longer needs a GitHub token to install dependencies.
