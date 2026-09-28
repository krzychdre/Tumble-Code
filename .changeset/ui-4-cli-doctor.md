---
"@tumble-code/cli": patch
---

New `tumble doctor` command: it checks the Node.js version, the extension bundle, the ripgrep binary, the global MCP servers file and whether the cloud API answers, prints one pass, warn or fail line per check, and exits with 1 when a check fails.
